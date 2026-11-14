"""Where things go: the listening layout and every candidate treatment position, computed from
the room geometry (model space, metres, z up). No language model is involved.

Layout (monitoring uses): the room's long axis is the longest wall's direction; the front wall
is the short end wall with the fewest openings. Listener on the centre line at 38 % of the
room length from the front wall (a common starting point that avoids the half-length null),
speakers in an equilateral triangle with the listener, tweeters at ear height (1.2 m).
Layout (mic uses): the mic goes where the existing field model finds the smoothest bass and
fewest early reflections (acoustics/field.py best spot), the performer at its default source.

Candidates:
- first reflections: mirror each speaker across each wall; where the line from the mirror
  image to the listener crosses the wall is the reflection point (image-source method);
- ceiling: the same with the ceiling plane, for a cloud;
- front wall behind each speaker (speaker-boundary interference), rear wall behind the
  listener (absorb, or diffuse when there is >= 2 m to it);
- corners: ordinary room corners (60-120 deg) with no opening at either side: bass traps;
- coverage: further panel slots along the walls at ear height, avoiding openings and items.
"""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.field import _edge_distance, _inside
from acoustics.physics import SPEED_OF_SOUND
from acoustics.products import PRODUCTS
from roomintel.geometry import OPEN_BELOW, STRIP_M, RoomGeometry, Wall

EAR_M = 1.2
EAR_BAND = (EAR_M - 0.6, EAR_M + 0.6)  # a 1.2 m tall panel centred at ear height
LISTENER_FRACTION = 0.38
MIN_SPEAKER_FRONT_M = 0.4
SPEAKER_SPACING = (0.9, 1.8)
CLEAR_SPEAKER_M = 0.3
CLEAR_LISTENER_M = 0.5
DIFFUSER_MIN_M = 2.0
SBIR_MAX_M = 1.5
REFLECTION_WINDOW_MS = 15.0
SLOT_PITCH_M = 0.9

Group = Literal["first_reflection", "ceiling", "front_wall", "rear_wall", "corner", "coverage"]


class Layout(BaseModel):
    kind: Literal["monitoring", "mic"]
    listener: tuple[float, float, float]  # the listening seat, or the mic
    sources: list[tuple[float, float, float]]  # speakers, or the performer
    source_names: list[str]
    facing: tuple[float, float]  # direction the listener faces (towards the front wall)
    front_wall: int | None
    note: str


class Blocker(BaseModel):
    id: str
    label: str
    kind: Literal["furniture", "wall_object", "fixture"]
    min: tuple[float, float, float]
    max: tuple[float, float, float]


class PlacedItem(BaseModel):
    key: str
    product_id: str
    group: Group
    center: tuple[float, float, float]
    normal: tuple[float, float, float]  # unit vector the front face points along (into the room)
    up: tuple[float, float, float]  # the item's "height" direction
    width_m: float
    height_m: float
    depth_m: float
    wall: int | None
    where: str  # plain-language location
    reason: str
    # set by fit.py: moved / replaced to clear the building, or blocked by furniture
    status: Literal["ok", "moved", "replaced", "blocked"] = "ok"
    adjustment: str | None = None
    blocked_by: list[Blocker] = []


class ReflectionPath(BaseModel):
    source: str
    surface: str
    point: tuple[float, float, float]
    delay_ms: float
    spreading_db: float  # relative to the direct sound, distance loss only
    level_db: float  # relative to the direct sound, with the surface's absorption at 1 kHz
    wall: int | None
    along_m: float | None
    placeable: bool
    why_not: str | None = None


def _u(v) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def _walls_by_side(geo: RoomGeometry, facing: np.ndarray) -> dict[int, str]:
    left = np.array([-facing[1], facing[0]])
    out = {}
    for w in geo.walls:
        n = np.array(w.inward)
        if n @ facing < -0.7:
            out[w.index] = "front wall"  # its inward normal points back at the listener
        elif n @ facing > 0.7:
            out[w.index] = "rear wall"
        elif n @ left < -0.7:
            out[w.index] = "left wall"
        elif n @ left > 0.7:
            out[w.index] = "right wall"
        else:
            out[w.index] = "angled wall"
    return out


def wall_names(geo: RoomGeometry, layout: Layout) -> dict[int, str]:
    return _walls_by_side(geo, np.array(layout.facing))


def _clear(geo: RoomGeometry, p, margin: float) -> bool:
    x, y = np.array([p[0]]), np.array([p[1]])
    return bool(_inside(x, y, geo.polygon)[0] and _edge_distance(x, y, geo.polygon)[0] >= margin)


def _section(geo: RoomGeometry, origin, axis, across, s: float) -> tuple[float, float] | None:
    """The widest stretch of the room across `across` at distance s along `axis`."""
    pts = []
    base = np.asarray(origin) + axis * s
    for w in geo.walls:
        a, b = np.array(w.start), np.array(w.end)
        da, db = (a - base) @ axis, (b - base) @ axis
        if (da > 0) == (db > 0) or da == db:
            continue
        t = da / (da - db)
        pts.append(float(((a + t * (b - a)) - base) @ across))
    pts.sort()
    spans = [(pts[i], pts[i + 1]) for i in range(0, len(pts) - 1, 2)]
    return max(spans, key=lambda s: s[1] - s[0]) if spans else None


def monitoring_layout(geo: RoomGeometry) -> Layout | None:
    longest = max(geo.walls, key=lambda w: w.length_m)
    u = _u(np.subtract(longest.end, longest.start))
    n = np.array([-u[1], u[0]])
    P = np.array(geo.polygon)
    su = P @ u
    umin, umax = su.min(), su.max()
    length = umax - umin

    def end_walls(at: float) -> list[Wall]:
        return [w for w in geo.walls if abs(_u(np.subtract(w.end, w.start)) @ u) < 0.26
                and abs(np.array(w.start) @ u - at) < 0.35 and abs(np.array(w.end) @ u - at) < 0.35]  # fmt: skip

    def score(ws: list[Wall]) -> float:
        """Solid wall length: scanned surface minus stretches kept clear (windows, doors)."""
        return sum(
            w.length_m * (1.0 if w.coverage is None else w.coverage)
            - sum(b - a for a, b in w.openings)
            for w in ws
        )

    lo, hi = end_walls(umin), end_walls(umax)
    front_at_min = score(lo) >= score(hi)
    f = u if front_at_min else -u  # from the front wall into the room
    front_u = umin if front_at_min else umax
    front_wall = max(lo if front_at_min else hi, key=lambda w: w.length_m, default=None)
    origin = u * front_u  # a point on the front-wall line (in the u direction)
    z = geo.floor_z + EAR_M

    for spacing in np.arange(SPEAKER_SPACING[1], SPEAKER_SPACING[0] - 1e-9, -0.1):
        d_l = max(LISTENER_FRACTION * length, MIN_SPEAKER_FRONT_M + spacing * math.sqrt(3) / 2)
        sec = _section(geo, origin, f, n, d_l)
        if sec is None or sec[1] - sec[0] < spacing + 2 * CLEAR_SPEAKER_M:
            continue
        c = (sec[0] + sec[1]) / 2
        lis = origin + f * d_l + n * c
        d_s = d_l - spacing * math.sqrt(3) / 2
        spk = [origin + f * d_s + n * (c + side * spacing / 2) for side in (1, -1)]
        if _clear(geo, lis, CLEAR_LISTENER_M) and all(_clear(geo, s, CLEAR_SPEAKER_M) for s in spk):
            facing = -f
            left = np.array([-facing[1], facing[0]])
            names = ["left speaker" if (s - lis) @ left > 0 else "right speaker" for s in spk]
            return Layout(
                kind="monitoring",
                listener=(float(lis[0]), float(lis[1]), z),
                sources=[(float(s[0]), float(s[1]), z) for s in spk],
                source_names=names,
                facing=(float(facing[0]), float(facing[1])),
                front_wall=front_wall.index if front_wall else None,
                note=(
                    f"Speakers {spacing:.1f} m apart facing down the room's long axis "
                    f"({length:.1f} m), listener {d_l:.1f} m from the front wall "
                    f"({d_l / length:.0%} of the length), equilateral triangle, ear height {EAR_M} m."
                ),
            )
    return None


def mic_layout(geo: RoomGeometry, best_spot, source, source_h: float, listener_h: float) -> Layout:
    lis = np.array(best_spot)
    src = np.array(source)
    facing = _u(src - lis) if np.linalg.norm(src - lis) > 0.1 else np.array([1.0, 0.0])
    return Layout(
        kind="mic",
        listener=(float(lis[0]), float(lis[1]), geo.floor_z + listener_h),
        sources=[(float(src[0]), float(src[1]), geo.floor_z + source_h)],
        source_names=["performer"],
        facing=(float(facing[0]), float(facing[1])),
        front_wall=None,
        note="Mic at the spot with the smoothest modeled bass and fewest early wall reflections; "
        "performer at the default source position.",
    )


def _wall_free(w: Wall, along: float, half: float, z: tuple[float, float] | None = None) -> bool:
    """Is [along - half, along + half] of the wall (and, if given, heights z above the floor)
    clear of openings and of no-go rectangles (windows, doors, radiators the agents saw)?"""
    if along - half < 0.05 or along + half > w.length_m - 0.05:
        return False
    if any(a < along + half and along - half < b for a, b in w.openings):
        return False
    for a, b, z0, z1, _ in w.no_go:
        if (
            a - 0.05 < along + half
            and along - half < b + 0.05
            and (z is None or (z0 - 0.05 < z[1] and z[0] < z1 + 0.05))
        ):
            return False
    if w.strips is None:
        return True
    i0, i1 = int((along - half) / STRIP_M), int((along + half) / STRIP_M)
    return all(c >= OPEN_BELOW for c in w.strips[i0 : min(i1, len(w.strips) - 1) + 1])


def wall_point(w: Wall, along: float, z: float) -> tuple[float, float, float]:
    """A point on the wall's room-side surface (the outline is its centreline)."""
    d = _u(np.subtract(w.end, w.start))
    p = np.array(w.start) + d * along + np.array(w.inward) * w.surface_offset_m
    return (float(p[0]), float(p[1]), z)


def wall_reflections(geo: RoomGeometry, layout: Layout, alpha_1k: float) -> list[ReflectionPath]:
    """First-order wall and ceiling reflections from each source to the listener."""
    names = wall_names(geo, layout)
    L = np.array(layout.listener)
    h_ceiling = geo.floor_z + geo.height.value
    half = PRODUCTS["panel_50"].width_m / 2
    out = []
    for name, S in zip(layout.source_names, layout.sources, strict=True):
        S = np.array(S)
        direct = np.linalg.norm(S - L)
        for w in geo.walls:
            n = np.array([*w.inward, 0.0])
            a = np.array([*w.start, 0.0]) + n * w.surface_offset_m  # reflect off the real surface
            dist = (S - a) @ n
            Sm = S - 2 * dist * n
            den = (L - Sm) @ n
            if abs(den) < 1e-9:
                continue
            t = ((a - Sm) @ n) / den
            if not 0 < t < 1:
                continue
            P = Sm + t * (L - Sm)
            along = float((P[:2] - np.array(w.start)) @ _u(np.subtract(w.end, w.start)))
            if not 0 <= along <= w.length_m:
                continue  # the mirror path misses this wall segment
            path = np.linalg.norm(L - Sm)
            delay = (path - direct) / SPEED_OF_SOUND * 1000
            spread = 20 * math.log10(direct / path)
            level = spread + 10 * math.log10(1 - alpha_1k)
            zc = float(P[2]) - geo.floor_z
            free = _wall_free(w, along, half, (zc - 0.6, zc + 0.6))
            out.append(
                ReflectionPath(
                    source=name,
                    surface=names[w.index],
                    point=(float(P[0]), float(P[1]), float(P[2])),
                    delay_ms=delay,
                    spreading_db=spread,
                    level_db=level,
                    wall=w.index,
                    along_m=along,
                    placeable=free,
                    why_not=None
                    if free
                    else "the reflection point is on an opening (door, window "
                    "or open plan) or too close to a corner",
                )
            )
        Sm = S.copy()
        Sm[2] = 2 * h_ceiling - S[2]
        t = (h_ceiling - Sm[2]) / (L[2] - Sm[2])
        P = Sm + t * (L - Sm)
        path = np.linalg.norm(L - Sm)
        out.append(
            ReflectionPath(
                source=name,
                surface="ceiling",
                point=(float(P[0]), float(P[1]), float(P[2])),
                delay_ms=(path - direct) / SPEED_OF_SOUND * 1000,
                spreading_db=20 * math.log10(direct / path),
                level_db=20 * math.log10(direct / path) + 10 * math.log10(1 - alpha_1k),
                wall=None,
                along_m=None,
                placeable=True,
            )
        )
    return out


def _panel(
    product: str, group: Group, w: Wall, along: float, z: float, where: str, reason: str, key: str
) -> PlacedItem:
    p = PRODUCTS[product]
    c = wall_point(w, along, z)
    n = w.inward
    return PlacedItem(
        key=key, product_id=product, group=group,
        center=(c[0] + n[0] * p.depth_m / 2, c[1] + n[1] * p.depth_m / 2, c[2]),
        normal=(n[0], n[1], 0.0), up=(0.0, 0.0, 1.0),
        width_m=p.width_m, height_m=p.height_m, depth_m=p.depth_m,
        wall=w.index, where=where, reason=reason,
    )  # fmt: skip


class Candidates(BaseModel):
    first_reflection: list[PlacedItem]
    ceiling: list[PlacedItem]
    front_wall: list[PlacedItem]
    rear_wall_absorb: list[PlacedItem]
    rear_wall_diffuse: list[PlacedItem]
    corners: list[PlacedItem]
    slots: list[PlacedItem]
    reflections: list[ReflectionPath]
    rear_distance_m: float | None
    notes: list[str]


def _ray_to_wall(geo: RoomGeometry, origin, direction) -> tuple[Wall, float, float] | None:
    """First wall hit by a horizontal ray: (wall, distance, along)."""
    o, d = np.array(origin[:2]), _u(direction)
    best = None
    for w in geo.walls:
        a, b = np.array(w.start), np.array(w.end)
        e = b - a
        den = d[0] * (-e[1]) + d[1] * e[0]
        if abs(den) < 1e-9:
            continue
        rel = a - o
        t = (rel[0] * (-e[1]) + rel[1] * e[0]) / den
        s = (d[0] * rel[1] - d[1] * rel[0]) / den
        if t > 1e-6 and 0 <= s <= 1 and (best is None or t < best[1]):
            best = (w, float(t), float(s * w.length_m))
    return best


def candidates(
    geo: RoomGeometry, layout: Layout, wall_alpha_1k: float, allow_diffusion: bool
) -> Candidates:
    names = wall_names(geo, layout)
    h = geo.height.value
    z_ear = geo.floor_z + EAR_M
    notes: list[str] = []
    refl = wall_reflections(geo, layout, wall_alpha_1k)
    fac = np.array(layout.facing)

    front = []
    if layout.kind == "monitoring":
        for name, s in zip(layout.source_names, layout.sources, strict=True):
            hit = _ray_to_wall(geo, s, layout.facing)
            if hit and hit[1] <= SBIR_MAX_M and _wall_free(hit[0], hit[2], 0.3, EAR_BAND):
                front.append(_panel("panel_100", "front_wall", hit[0], hit[2], z_ear,
                                    f"{names[hit[0].index]}, directly behind the {name} ({hit[1]:.2f} m behind it)",
                                    f"The wall {hit[1]:.2f} m behind the {name} reflects bass back in and out of phase (speaker-boundary interference, a dip near {SPEED_OF_SOUND / (4 * hit[1]):.0f} Hz).",
                                    f"fw{len(front) + 1}"))  # fmt: skip

    rear_abs: list[PlacedItem] = []
    rear_dif: list[PlacedItem] = []
    rear_d = None
    hit = _ray_to_wall(geo, layout.listener, -fac)
    if hit:
        w, rear_d, along = hit
        where = f"{names[w.index]}, behind the {'listener' if layout.kind == 'monitoring' else 'mic'} ({rear_d:.2f} m away)"
        if _wall_free(w, along - 0.3, 0.3, EAR_BAND) and _wall_free(w, along + 0.3, 0.3, EAR_BAND):
            for k, off in enumerate((-0.3, 0.3)):
                rear_abs.append(_panel("panel_100", "rear_wall", w, along + off, z_ear, where,
                                       f"The wall {rear_d:.2f} m behind sends a strong late reflection back to the {'listener' if layout.kind == 'monitoring' else 'mic'}.",
                                       f"rw{k + 1}"))  # fmt: skip
            if allow_diffusion and rear_d >= DIFFUSER_MIN_M:
                for k, (off, dz) in enumerate([(-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)]):
                    rear_dif.append(_panel("diffuser_qrd", "rear_wall", w, along + off, z_ear + dz, where,
                                           f"{rear_d:.2f} m behind is far enough to diffuse instead of absorb: keeps the room lively without a discrete echo.",
                                           f"df{k + 1}"))  # fmt: skip
        else:
            notes.append(
                "The wall behind the listening position has an opening there; no rear treatment."
            )

    fr: list[PlacedItem] = []
    for r in sorted(refl, key=lambda r: -r.level_db):  # loudest first: panels centre on them
        if r.wall is None or r.delay_ms > REFLECTION_WINDOW_MS:
            continue
        w = geo.walls[r.wall]
        if not r.placeable:
            notes.append(
                f"The {r.source}'s reflection off the {r.surface} lands on an opening; it cannot take a panel (a heavy curtain helps if it is a window)."
            )
            continue
        if any(i.wall == r.wall and abs(_along(w, i) - r.along_m) < 0.45 for i in fr):
            continue  # both speakers reflect near the same spot: one panel covers it
        if any(
            i.wall == r.wall and abs(_along(w, i) - r.along_m) < 0.6 for i in [*front, *rear_abs]
        ):
            continue  # the panels behind the speakers / the listener already cover it
        fr.append(_panel("panel_50", "first_reflection", w, r.along_m, max(r.point[2], geo.floor_z + 0.65),
                         f"{names[w.index]}, {r.along_m:.2f} m along it, centred {r.point[2] - geo.floor_z:.2f} m up",
                         f"First reflection of the {r.source}: arrives {r.delay_ms:.1f} ms after the direct sound at {r.level_db:+.1f} dB.",
                         f"fr{len(fr) + 1}"))  # fmt: skip

    ceil_pts = [r.point for r in refl if r.surface == "ceiling"]
    cloud = PRODUCTS["cloud_100"]
    cz = geo.floor_z + h - 0.15 - cloud.depth_m / 2
    cx = float(np.mean([p[0] for p in ceil_pts]))
    cy = float(np.mean([p[1] for p in ceil_pts]))
    ceiling = []
    if _clear(geo, (cx, cy), 0.7):
        ceiling.append(PlacedItem(
            key="cloud", product_id="cloud_100", group="ceiling", center=(cx, cy, cz),
            normal=(0.0, 0.0, -1.0), up=(float(fac[0]), float(fac[1]), 0.0),
            width_m=cloud.width_m, height_m=cloud.height_m, depth_m=cloud.depth_m, wall=None,
            where="Ceiling, centred over the reflection points between the "
            + ("speakers and the listener" if layout.kind == "monitoring" else "performer and the mic")
            + ", hung 150 mm down",
            reason="Ceiling reflection: " + ", ".join(f"{r.source} {r.delay_ms:.1f} ms at {r.level_db:+.1f} dB" for r in refl if r.surface == "ceiling") + ".",
        ))  # fmt: skip
    else:
        notes.append("No room for a ceiling cloud over the reflection point.")

    corners = []
    trap = PRODUCTS["bass_trap"]
    for c in geo.corners:
        if not (60 <= c.interior_angle_deg <= 120):
            continue
        wa, wb = geo.walls[c.walls[0]], geo.walls[c.walls[1]]
        # Something in the corner for part of its height is fine: fit.py may fit a shorter trap.
        low_free = _wall_free(wa, wa.length_m - 0.4, 0.3, (0.0, 1.2)) and _wall_free(
            wb, 0.4, 0.3, (0.0, 1.2)
        )
        if not low_free:
            continue
        bis = _u(np.add(wa.inward, wb.inward))
        off = trap.depth_m / 2
        apex = (
            np.array(c.point)
            + np.array(wa.inward) * wa.surface_offset_m
            + np.array(wb.inward) * wb.surface_offset_m
        )
        center = (float(apex[0] + bis[0] * off), float(apex[1] + bis[1] * off), geo.floor_z + h / 2)
        corners.append(PlacedItem(
            key=f"trap{c.index}", product_id="bass_trap", group="corner", center=center,
            normal=(float(bis[0]), float(bis[1]), 0.0), up=(0.0, 0.0, 1.0),
            width_m=trap.width_m, height_m=h, depth_m=trap.depth_m, wall=None,
            where=f"Corner between the {names[wa.index]} and the {names[wb.index]}, floor to ceiling",
            reason="Every room mode has a pressure maximum in the corners, so a trap there damps all of them at once.",
        ))  # fmt: skip
    # front corners first (nearest the speakers), then by distance
    ref = (
        np.array(layout.sources[0][:2])
        if layout.kind == "monitoring"
        else np.array(layout.listener[:2])
    )
    corners.sort(key=lambda i: np.linalg.norm(np.array(i.center[:2]) - ref))

    taken = [*fr, *front, *rear_abs]
    slots = []
    order = sorted(
        geo.walls,
        key=lambda w: (
            names[w.index] not in ("left wall", "right wall"),
            names[w.index] != "rear wall",
            -w.length_m,
        ),
    )
    for w in order:
        along = 0.6
        while along + 0.3 <= w.length_m - 0.45:
            clash = any(i.wall == w.index and abs(_along(w, i) - along) < 0.75 for i in taken)
            if not clash and _wall_free(w, along, 0.3, EAR_BAND):
                p = _panel("panel_50", "coverage", w, along, z_ear,
                           f"{names[w.index]}, {along:.2f} m along it, centred {EAR_M:.1f} m up",
                           "Adds broadband absorption to bring the overall reverberation time to the target.",
                           f"cv{len(slots) + 1}")  # fmt: skip
                slots.append(p)
                taken.append(p)
            along += SLOT_PITCH_M
    return Candidates(first_reflection=fr, ceiling=ceiling, front_wall=front, rear_wall_absorb=rear_abs,
                      rear_wall_diffuse=rear_dif, corners=corners, slots=slots, reflections=refl,
                      rear_distance_m=rear_d, notes=notes)  # fmt: skip


def _along(w: Wall, item: PlacedItem) -> float:
    return float((np.array(item.center[:2]) - np.array(w.start)) @ _u(np.subtract(w.end, w.start)))
