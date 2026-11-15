"""Turn the specialist agents' answers into room facts, deterministically.

- wall features (image rectangles in a wall view) -> metres along the wall and heights above
  the floor, using the view's camera (views.along_wall and the pinhole model);
- per-wall finishes and every glazed, door and open area -> extra absorption per octave band
  relative to the uniform wall material the report starts from (coefficients only from
  acoustics/materials.py; an open doorway absorbs everything that reaches it, alpha = 1);
- furniture pieces -> table ids chosen by kind AND covering (a leather sofa is not a fabric
  sofa), and estimated floor positions that name the mesh's furniture objects;
- hazards -> the wall they are on (ray-cast from the scan position).
"""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.furniture import FurnitureItem
from acoustics.materials import MATERIALS, OPEN_ALPHA, SURFACE_MATERIALS
from roomintel.agents import AgentRun, FurnitureReport, SurroundingsReport, WallsReport
from roomintel.geometry import RoomGeometry, Wall
from roomintel.obstacles import FurnitureObject
from roomintel.panorama import ScanPosition, floor_point, pixel_bearing
from roomintel.views import WallView, along_wall

MIN_CONFIDENCE = 0.5
BUILDING = {"window", "door", "open_doorway", "glass_door", "radiator", "built_in_shelving"}
MOVABLE = {"artwork", "wall_shelf", "tv", "mirror"}
FEATURE_ALPHA = {"window": "glass", "glass_door": "glass", "mirror": "mirror", "door": "door_wood"}


class WallFeatureFound(BaseModel):
    kind: str
    category: Literal["building", "movable", "other"]
    along: tuple[float, float]  # metres along the wall
    z: tuple[float, float]  # metres above the floor
    covering: str
    confidence: float


class WallFound(BaseModel):
    wall: int
    material_id: str | None
    finish: str | None
    confidence: float | None
    features: list[WallFeatureFound]
    view: WallView | None


class PieceFound(BaseModel):
    kind: str
    covering: str
    label: str
    count: int
    furniture_id: str | None  # table id used for absorption (None: negligible / unknown)
    position: tuple[float, float] | None  # estimated floor point (model space)
    width_m: float | None
    height_m: float | None
    confidence: float


class HazardFound(BaseModel):
    kind: str
    note: str
    wall: int | None
    bearing_deg: float | None
    confidence: float


def _scan_face(image: str, scans: dict[str, ScanPosition]):
    try:
        s, f = image.upper().lstrip("S").split("F")
        return scans[f"S{int(s)}"], int(f)
    except (KeyError, ValueError):
        return None, None


def walls_found(
    run: AgentRun, geo: RoomGeometry, views: list[WallView], scans_by_id: dict[str, ScanPosition]
) -> list[WallFound]:
    out = {
        w.index: WallFound(
            wall=w.index, material_id=None, finish=None, confidence=None, features=[], view=None
        )
        for w in geo.walls
    }
    vmap = {v.wall: v for v in views}
    for v in views:
        out[v.wall].view = v
    if run.status != "ok" or not run.answer:
        return list(out.values())
    rep = WallsReport.model_validate(run.answer)
    for a in rep.walls:
        try:
            wi = int(a.image.upper().lstrip("W"))
        except ValueError:
            continue
        if wi not in out or wi not in vmap:
            continue
        wall, view = geo.walls[wi], vmap[wi]
        scan = scans_by_id[view.scan_id]
        ok = a.material_id in SURFACE_MATERIALS["walls"] and a.confidence >= MIN_CONFIDENCE
        out[wi].material_id = a.material_id if ok else None
        out[wi].finish = a.finish
        out[wi].confidence = a.confidence
        for f in a.features:
            if f.confidence < MIN_CONFIDENCE:
                continue
            x0, x1 = sorted((f.x_start, f.x_end))
            p0, p1 = along_wall(view, scan, wall, x0), along_wall(view, scan, wall, x1)
            if p0 is None or p1 is None:
                continue
            a0, a1 = sorted((p0, p1))
            if a1 - a0 < 0.1:
                continue
            z = _heights(
                view, scan, wall, (a0 + a1) / 2, f.y_top, f.y_bottom, geo.floor_z, geo.height.value
            )
            cat = "building" if f.kind in BUILDING else "movable" if f.kind in MOVABLE else "other"
            out[wi].features.append(WallFeatureFound(kind=f.kind, category=cat, along=(a0, a1), z=z,
                                                     covering=f.covering, confidence=f.confidence))  # fmt: skip
    return list(out.values())


def _heights(view: WallView, scan: ScanPosition, wall: Wall, along: float, y_top: float, y_bot: float,
             floor_z: float, h: float) -> tuple[float, float]:  # fmt: skip
    """Image rows -> heights above the floor at that point of the wall (pinhole camera)."""
    p = np.array(wall.start) + (np.array(wall.end) - np.array(wall.start)) / wall.length_m * along
    th = math.radians(view.yaw_deg)
    fwd = (p[0] - scan.position[0]) * math.cos(th) + (p[1] - scan.position[1]) * math.sin(th)
    f_px = (view.width / 2) / math.tan(math.radians(view.hfov_deg) / 2)

    def z(y):
        return scan.position[2] + (view.height / 2 - y * view.height) / f_px * fwd - floor_z

    lo, hi = sorted((z(y_bot), z(y_top)))
    return (max(0.0, lo), min(h, hi))


def surfaces_found(run: AgentRun) -> dict[str, tuple[str, float, str]]:
    """floor / ceiling -> (material id, confidence, description), when confident and valid."""
    if run.status != "ok" or not run.answer:
        return {}
    out = {}
    for s in WallsReport.model_validate(run.answer).surfaces:
        if s.material_id in SURFACE_MATERIALS[s.surface] and s.confidence >= MIN_CONFIDENCE:
            out[s.surface] = (s.material_id, s.confidence, s.finish)
    return out


def wall_absorption(
    geo: RoomGeometry, walls: list[WallFound], base_wall: str
) -> tuple[list[float], list[str]]:
    """Extra sabins per band versus every wall being `base_wall` from floor to ceiling."""
    base = MATERIALS[base_wall]["alpha"]
    h = geo.height.value
    extra = [0.0] * 6
    notes = []
    for wf in walls:
        w = geo.walls[wf.wall]
        mat = MATERIALS[wf.material_id]["alpha"] if wf.material_id else base
        special = 0.0
        for f in wf.features:
            mid = FEATURE_ALPHA.get(f.kind)
            alpha = (
                OPEN_ALPHA if f.kind == "open_doorway" else MATERIALS[mid]["alpha"] if mid else None
            )
            if alpha is None:
                continue
            area = (f.along[1] - f.along[0]) * (f.z[1] - f.z[0])
            special += area
            for b in range(6):
                extra[b] += area * (alpha[b] - base[b])
            notes.append(f"{f.kind.replace('_', ' ')} on wall {w.index}: {area:.1f} m2")
        # openings the mesh found that no feature explains: doorway-sized = closed door, wider = open plan
        for a, b_ in w.openings:
            if any(
                f.along[0] < b_ and a < f.along[1] for f in wf.features if f.category == "building"
            ):
                continue
            width = b_ - a
            alpha = OPEN_ALPHA if width > 1.2 else MATERIALS["door_wood"]["alpha"]
            area = width * (h if width > 1.2 else min(h, 2.05))
            special += area
            for k in range(6):
                extra[k] += area * (alpha[k] - base[k])
            notes.append(
                f"{'open plan' if width > 1.2 else 'doorway (assumed closed door)'} on wall {w.index}: {area:.1f} m2 (from the scan mesh)"
            )
        solid = max(0.0, w.length_m * h - special)
        for b in range(6):
            extra[b] += solid * (mat[b] - base[b])
    return extra, notes


def piece_id(kind: str, covering: str) -> str | None:
    soft = covering in ("fabric", "mixed", "unknown")
    table = {
        "sofa": "sofa" if soft else "sofa_leather",
        "armchair": "armchair" if soft else "armchair_leather",
        "office_chair": "office_chair",
        "chair": "office_chair" if covering == "fabric" else "chair",
        "bed": "bed", "table": "table", "desk": "desk", "bookshelf": "bookshelf",
        "wardrobe": "wardrobe", "cabinets": "cabinets", "rug": "rug",
        # blinds and shutters are not drapes: only fabric curtains get curtain absorption
        "curtains": "curtains" if covering == "fabric" else None,
        "piano": "piano", "cushions": "cushions",
    }  # fmt: skip
    return table.get(kind)


def pieces_found(
    run: AgentRun, scans: dict[str, ScanPosition], floor_z: float, inside
) -> list[PieceFound]:
    if run.status != "ok" or not run.answer:
        return []
    out = []
    for p in FurnitureReport.model_validate(run.answer).pieces:
        scan, face = _scan_face(p.image, scans)
        pos = width = height = None
        if scan and face in (1, 2, 3, 4) and p.floor_y is not None:
            xc = (p.x_start + p.x_end) / 2
            pos = floor_point(scan, face, xc, p.floor_y, floor_z)
            ends = [floor_point(scan, face, x, p.floor_y, floor_z) for x in (p.x_start, p.x_end)]
            if all(ends):
                width = math.dist(ends[0], ends[1])
            if pos and p.top_y is not None:
                fwd = math.dist(pos, scan.position[:2])
                height = max(0.0, scan.position[2] - floor_z + (0.5 - p.top_y) * 2 * fwd)
            if pos and not inside(*pos):
                pos = None
        out.append(PieceFound(kind=p.kind, covering=p.covering, label=p.label, count=p.count,
                              furniture_id=piece_id(p.kind, p.covering), position=pos, width_m=width,
                              height_m=height, confidence=p.confidence))  # fmt: skip
    return out


def furniture_items(pieces: list[PieceFound]) -> list[FurnitureItem]:
    counts: dict[str, int] = {}
    for p in pieces:
        if p.furniture_id and p.confidence >= MIN_CONFIDENCE:
            counts[p.furniture_id] = counts.get(p.furniture_id, 0) + p.count
    return [FurnitureItem(id=k, count=n, provenance="observed") for k, n in counts.items()]


def name_objects(objects: list[FurnitureObject], pieces: list[PieceFound]) -> None:
    """Give each mesh object the label of the agent's piece whose floor point falls inside it."""
    for o in objects:
        if o.mounting == "ceiling":
            continue  # floor positions cannot name a hanging fixture
        best = None
        for p in pieces:
            if p.position is None or p.confidence < MIN_CONFIDENCE:
                continue
            dx = max(o.min[0] - p.position[0], 0, p.position[0] - o.max[0])
            dy = max(o.min[1] - p.position[1], 0, p.position[1] - o.max[1])
            d = math.hypot(dx, dy)
            if d < 0.5 and (best is None or d < best[0]):
                best = (d, p)
        if best:
            o.label = best[1].label
            o.named_by = "furniture_agent"


def hazards_found(
    run: AgentRun, scans: dict[str, ScanPosition], geo: RoomGeometry
) -> list[HazardFound]:
    from treatment.placement import _ray_to_wall

    if run.status != "ok" or not run.answer:
        return []
    out = []
    for h in SurroundingsReport.model_validate(run.answer).hazards:
        if h.confidence < MIN_CONFIDENCE:
            continue
        scan, face = _scan_face(h.image, scans)
        bearing = wall = None
        if scan and face in (1, 2, 3, 4):
            bearing = pixel_bearing(scan.yaw_deg, face, h.x)
            hit = _ray_to_wall(
                geo,
                scan.position,
                (math.cos(math.radians(bearing)), math.sin(math.radians(bearing))),
            )
            wall = hit[0].index if hit else None
        out.append(
            HazardFound(
                kind=h.kind, note=h.note, wall=wall, bearing_deg=bearing, confidence=h.confidence
            )
        )
    return out
