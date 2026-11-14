"""Make every candidate item physically fit the real room.

Two kinds of obstruction, handled differently:

- the building (points of Matterport's defurnished shell, plus windows, doors and radiators the
  walls agent found): an item cannot go there, so it is MOVED (slid along its wall or up/down,
  within limits that keep it doing its job; a first-reflection panel must still cover its
  reflection point), else REPLACED (turned landscape, a half-size panel, a half-height bass
  trap), else dropped with the reason;
- furniture and things hung on the wall (points of the MatterPak's furnished mesh that are not
  building; art, shelves and TVs the walls agent found): these can be moved by the occupant.
  A panel first tries to sit above the furniture while still doing its job; if it cannot, it
  stays where the acoustics need it and is marked BLOCKED with the objects in the way, so the
  UI can show it through the furniture (x-ray) and say what to move.

All tests are on oriented boxes in model space (metres, z up). Deterministic.
"""

import math

import numpy as np

from acoustics.products import PRODUCTS
from roomintel.geometry import RoomGeometry
from roomintel.obstacles import Obstacles
from treatment.placement import Blocker, Candidates, PlacedItem

SURFACE_SKIN_M = 0.035  # building points this close behind an item's back are its mounting wall
BUILDING_MAX_POINTS = 6  # a few stray points are scan noise
FURNITURE_MIN_POINTS = 12
SUPPORT_MIN = 0.9  # share of the panel's back that must have wall behind it (~6 cm slack)
STEP = 0.1


def _axes(it: PlacedItem):
    z = np.array(it.normal, dtype=float)
    y = np.array(it.up, dtype=float)
    x = np.cross(y, z)
    return x, y, z


def _local(it: PlacedItem, pts: np.ndarray):
    x, y, z = _axes(it)
    d = pts - np.array(it.center)
    return d @ x, d @ y, d @ z


def building_conflict(it: PlacedItem, building: np.ndarray, geo: RoomGeometry) -> str | None:
    """Why the building is in the way of this item, or None."""
    if len(building):
        if PRODUCTS[it.product_id].mount == "corner":
            hits = _trap_hits(it, building, geo)
        else:
            lx, ly, lz = _local(it, building)
            inside = (np.abs(lx) < it.width_m / 2 - 0.02) & (np.abs(ly) < it.height_m / 2 - 0.02)
            hits = int(
                (
                    inside & (lz > -it.depth_m / 2 + SURFACE_SKIN_M) & (lz < it.depth_m / 2 + 0.02)
                ).sum()
            )
            if PRODUCTS[it.product_id].mount == "wall":
                behind = (
                    inside
                    & (lz > -it.depth_m / 2 - 0.08)
                    & (lz <= -it.depth_m / 2 + SURFACE_SKIN_M)
                )
                nx, ny = max(1, round(it.width_m / 0.1)), max(1, round(it.height_m / 0.1))
                cx = np.clip(np.floor((lx[behind] + it.width_m / 2) / it.width_m * nx), 0, nx - 1)
                cy = np.clip(np.floor((ly[behind] + it.height_m / 2) / it.height_m * ny), 0, ny - 1)
                cells = set(zip(cx.astype(int), cy.astype(int), strict=True))
                total = nx * ny
                if len(cells) / total < SUPPORT_MIN:
                    return "no solid wall behind it (a window, doorway or recess)"
        if hits > BUILDING_MAX_POINTS:
            return "it would run into part of the building (a frame, casing, beam or built-in)"
    if it.wall is not None:
        w = geo.walls[it.wall]
        along = _along(geo, it)
        z0 = it.center[2] - it.height_m / 2 - geo.floor_z
        z1 = z0 + it.height_m
        for a, b, f0, f1, what in w.no_go:
            if (
                a - 0.05 < along + it.width_m / 2
                and along - it.width_m / 2 < b + 0.05
                and f0 - 0.05 < z1
                and z0 < f1 + 0.05
            ):
                return f"it would cover the {what.replace('_', ' ')}"
        if any(a < along + it.width_m / 2 and along - it.width_m / 2 < b for a, b in w.openings):
            return "it would cover an opening in the wall"
    return None


def _trap_hits(it: PlacedItem, pts: np.ndarray, geo: RoomGeometry) -> int:
    """Building points inside the corner prism, ignoring the two walls it leans on."""
    n = np.array(it.normal[:2])
    apex = np.array(it.center[:2]) - n * it.depth_m / 2
    leg = it.width_m / math.sqrt(2)
    rot = lambda a: np.array(
        [n[0] * math.cos(a) - n[1] * math.sin(a), n[0] * math.sin(a) + n[1] * math.cos(a)]
    )
    ea, eb = rot(math.pi / 4), rot(-math.pi / 4)
    rel = pts[:, :2] - apex
    sa, sb = rel @ ea, rel @ eb  # coordinates along the two wall faces (90 deg corner)
    z0 = it.center[2] - it.height_m / 2
    m = (sa > SURFACE_SKIN_M) & (sb > SURFACE_SKIN_M) & (sa + sb < leg - 0.02)
    m &= (pts[:, 2] > z0 + 0.03) & (pts[:, 2] < z0 + it.height_m - 0.03)
    return int(m.sum())


def blockers(it: PlacedItem, obs: Obstacles | None, wall_objects: list[Blocker]) -> list[Blocker]:
    out: list[Blocker] = []
    if obs is not None and len(obs.furniture_pts):
        lx, ly, lz = _local(it, obs.furniture_pts)
        m = (np.abs(lx) < it.width_m / 2 + 0.03) & (np.abs(ly) < it.height_m / 2 + 0.03)
        m &= (lz > -it.depth_m / 2 - 0.02) & (lz < it.depth_m / 2 + 0.05)
        ids, counts = np.unique(obs.labels[m], return_counts=True)
        for k, c in zip(ids, counts, strict=True):
            if c >= FURNITURE_MIN_POINTS:
                o = obs.objects[k]
                out.append(
                    Blocker(
                        id=o.id,
                        label=o.label,
                        kind="fixture"
                        if o.mounting == "ceiling"
                        else "furniture"
                        if o.mounting == "floor"
                        else "wall_object",
                        min=o.min,
                        max=o.max,
                    )
                )
    for b in wall_objects:
        lo, hi = np.array(b.min), np.array(b.max)
        corners = np.array(
            [[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        )
        lx, ly, lz = _local(it, corners)
        if (lx.min() < it.width_m / 2 and lx.max() > -it.width_m / 2 and ly.min() < it.height_m / 2
                and ly.max() > -it.height_m / 2 and lz.min() < it.depth_m / 2 + 0.05 and lz.max() > -it.depth_m / 2 - 0.05):  # fmt: skip
            out.append(b)
    return out


def _along(geo: RoomGeometry, it: PlacedItem) -> float:
    w = geo.walls[it.wall]
    u = (np.array(w.end) - np.array(w.start)) / w.length_m
    return float((np.array(it.center[:2]) - np.array(w.start)) @ u)


def _shift(it: PlacedItem, geo: RoomGeometry, along: float, dz: float) -> PlacedItem:
    """The same item slid `along` metres along its wall and `dz` up."""
    w = geo.walls[it.wall]
    u = (np.array(w.end) - np.array(w.start)) / w.length_m
    c = np.array(it.center[:2]) + u * along
    return it.model_copy(update={"center": (float(c[0]), float(c[1]), it.center[2] + dz)})


def _overlaps(it: PlacedItem, placed: list[PlacedItem], geo: RoomGeometry) -> bool:
    for p in placed:
        if p.wall is None or p.wall != it.wall:
            continue
        if (
            abs(_along(geo, p) - _along(geo, it)) < (p.width_m + it.width_m) / 2 + 0.03
            and abs(p.center[2] - it.center[2]) < (p.height_m + it.height_m) / 2
        ):
            return True
    return False


def _fits(it, geo, obs, placed) -> bool:
    from treatment.optimizer import _on_face

    if it.covers and not all(_on_face(p, it) for p in it.covers):
        return False  # it would no longer absorb the reflection it is there for
    if it.wall is not None:
        a = _along(geo, it)
        w = geo.walls[it.wall]
        if a - it.width_m / 2 < 0.03 or a + it.width_m / 2 > w.length_m - 0.03:
            return False
        z0 = it.center[2] - it.height_m / 2 - geo.floor_z
        if z0 < 0.05 or z0 + it.height_m > geo.height.value - 0.05:
            return False
    return building_conflict(
        it, obs.building if obs else np.zeros((0, 3)), geo
    ) is None and not _overlaps(it, placed, geo)


def _variants(it: PlacedItem, geo: RoomGeometry):
    """Positions and replacements to try, nearest first: (item, how)."""
    p = PRODUCTS[it.product_id]
    if p.mount == "wall":
        # a first-reflection panel must keep covering its reflection point
        # first-reflection panels: _fits rejects any position that uncovers a reflection point
        reach = it.width_m / 2 if it.group == "first_reflection" else 0.9
        vreach = it.height_m / 2 if it.group == "first_reflection" else 0.4
        shifts = sorted(((a, z) for a in np.arange(-reach, reach + 1e-9, STEP) for z in np.arange(-vreach, vreach + 1e-9, STEP)),
                        key=lambda s: (abs(s[0]) + abs(s[1]), abs(s[1])))  # fmt: skip
        for a, z in shifts:
            if a or z:
                yield _shift(it, geo, float(a), float(z)), _moved(float(a), float(z))
        if p.kind == "panel" and it.height_m > it.width_m:  # turn it landscape
            land = it.model_copy(update={"width_m": it.height_m, "height_m": it.width_m})
            yield land, "turned on its side to fit"
            for a in np.arange(-0.3, 0.31, STEP):
                if a:
                    yield (
                        _shift(land, geo, float(a), 0.0),
                        f"turned on its side and {_moved(float(a), 0)}",
                    )
        if p.kind == "panel":
            sq = it.model_copy(
                update={
                    "product_id": "panel_50_square",
                    "width_m": 0.6,
                    "height_m": 0.6,
                    "depth_m": 0.05,
                }
            )
            for a, z in [(0, 0), (0, 0.3), (0, -0.3), (-0.3, 0), (0.3, 0), (-0.3, 0.3), (0.3, 0.3)]:
                yield (
                    _shift(sq, geo, a, z),
                    "replaced by a half-size panel" + (f" {_moved(a, z)}" if a or z else ""),
                )
    elif p.mount == "corner":
        h = it.height_m
        z_floor = it.center[2] - h / 2
        for part, zc in (("lower", z_floor + 0.6), ("upper", z_floor + h - 0.6)):
            yield (
                it.model_copy(update={"height_m": 1.2, "center": (it.center[0], it.center[1], zc)}),
                f"replaced by a 1.2 m {part} trap",
            )
    elif p.mount == "ceiling":
        n = np.array(it.up[:2])
        side = np.array([-n[1], n[0]])
        for a in np.arange(-0.6, 0.61, STEP):
            for b in np.arange(-0.4, 0.41, STEP):
                if a or b:
                    c = np.array(it.center[:2]) + n * a + side * b
                    yield (
                        it.model_copy(update={"center": (float(c[0]), float(c[1]), it.center[2])}),
                        f"moved {math.hypot(a, b):.1f} m",
                    )


def _moved(a: float, z: float) -> str:
    parts = []
    if abs(a) > 1e-6:
        parts.append(f"{abs(a):.1f} m {'along the wall' if a > 0 else 'back along the wall'}")
    if abs(z) > 1e-6:
        parts.append(f"{abs(z):.1f} m {'higher' if z > 0 else 'lower'}")
    return "moved " + " and ".join(parts)


def fit_item(it: PlacedItem, geo: RoomGeometry, obs: Obstacles | None, wall_objects: list[Blocker],
             placed: list[PlacedItem]) -> tuple[PlacedItem | None, str | None]:  # fmt: skip
    """The item where it physically fits, or (None, why not)."""
    building = obs.building if obs else np.zeros((0, 3))
    why = building_conflict(it, building, geo)
    chosen, how = (it, None) if why is None and not _overlaps(it, placed, geo) else (None, None)
    if chosen is None:
        for cand, h in _variants(it, geo):
            if _fits(cand, geo, obs, placed):
                chosen, how = cand, h
                break
    if chosen is None:
        return None, why or "it overlaps another item"
    status = (
        "ok" if how is None else "replaced" if ("replaced" in how or "turned" in how) else "moved"
    )
    if how:
        chosen = chosen.model_copy(
            update={"status": status, "adjustment": f"{how}: {why}" if why else how}
        )
    blocking = blockers(chosen, obs, wall_objects)
    if blocking:
        # another spot or form that still does the job and is clear of furniture and wall objects
        for cand, h in _variants(it, geo):
            if _fits(cand, geo, obs, placed) and not blockers(cand, obs, wall_objects):
                st = "replaced" if ("replaced" in h or "turned" in h) else "moved"
                return cand.model_copy(
                    update={"status": st, "adjustment": f"{h} to clear {blocking[0].label}"}
                ), None
    if blocking and PRODUCTS[chosen.product_id].mount == "wall":
        # try lifting it clear of the furniture while it still does its job
        top = max(b.max[2] for b in blocking)
        lift = top + 0.03 - (chosen.center[2] - chosen.height_m / 2)
        limit = chosen.height_m / 2 if chosen.group == "first_reflection" else 0.6
        if 0 < lift <= limit:
            up = _shift(chosen, geo, 0.0, lift)
            if _fits(up, geo, obs, placed) and not blockers(up, obs, wall_objects):
                return up.model_copy(
                    update={
                        "status": "moved",
                        "adjustment": f"raised {lift:.2f} m to clear {blocking[0].label}",
                    }
                ), None
    if blocking:
        chosen = chosen.model_copy(update={"status": "blocked", "blocked_by": blocking})
    return chosen, None


def fit_candidates(
    c: Candidates, geo: RoomGeometry, obs: Obstacles | None, wall_objects: list[Blocker]
) -> Candidates:
    notes = list(c.notes)

    def run(items: list[PlacedItem], against: list[PlacedItem]) -> list[PlacedItem]:
        out: list[PlacedItem] = []
        for it in items:
            got, why = fit_item(it, geo, obs, wall_objects, [*against, *out])
            if got is None:
                notes.append(
                    f"{it.where}: no {PRODUCTS[it.product_id].label.split(',')[0].lower()} fits ({why})."
                )
                continue
            out.append(got)
        return out

    fr = run(c.first_reflection, [])
    front = run(c.front_wall, fr)
    rear_abs = run(c.rear_wall_absorb, [*fr, *front])
    rear_dif = run(c.rear_wall_diffuse, [*fr, *front])  # an alternative to rear_abs, never both
    corners = run(c.corners, [])
    ceiling = run(c.ceiling, [])
    # coverage slots are interchangeable: the ones furniture does not block go first
    slots = run(c.slots, [*fr, *front, *rear_abs, *rear_dif])
    slots.sort(key=lambda i: i.status == "blocked")
    return c.model_copy(update={
        "first_reflection": fr, "front_wall": front, "rear_wall_absorb": rear_abs,
        "rear_wall_diffuse": rear_dif, "corners": corners, "ceiling": ceiling, "slots": slots, "notes": notes,
    })  # fmt: skip
