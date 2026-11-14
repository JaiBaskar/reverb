"""Tour layout for the 3D view: which tour sweeps belong to each Reverb room, and its outline.

Everything comes from the Matterport Model API (`TOUR_QUERY`). The only derived value is the
entry sweep (the room's sweep nearest its outline centroid), which is marked `estimated`.
Rooms with no boundary or no sweeps say so; nothing is filled in.
"""

from properties.matterport import fetch_tour_geometry
from properties.models import Provenance, Room, TourFloor, TourLayout, TourRoom, TourSweep
from properties.service import get_rooms

COORDINATE_NOTE = (
    "Positions are Matterport model space in metres with z up. The Showcase SDK (three.js) "
    "uses y up: sdk (x, y, z) = model (x, z, -y). Polygons are wall centrelines, so they "
    "enclose slightly more than the Matterport floor area."
)

Point = tuple[float, float]


def chain_polygon(edges: list[dict]) -> list[Point] | None:
    """Walk boundary edges into one closed loop. Dead-end edges are pruned first.

    Returns None if the edges do not form exactly one simple closed loop.
    """
    adj: dict[str, set[str]] = {}
    pos: dict[str, Point] = {}
    for e in edges:
        verts = e.get("vertices") or []
        if len(verts) != 2:
            continue
        a, b = verts
        for v in verts:
            p = v.get("position") or {}
            pos[v["id"]] = (float(p.get("x", 0.0)), float(p.get("y", 0.0)))
        if a["id"] == b["id"]:
            continue
        adj.setdefault(a["id"], set()).add(b["id"])
        adj.setdefault(b["id"], set()).add(a["id"])

    leaves = [k for k, v in adj.items() if len(v) <= 1]
    while leaves:
        k = leaves.pop()
        for n in adj.pop(k, set()):
            adj[n].discard(k)
            if len(adj[n]) <= 1:
                leaves.append(n)

    if len(adj) < 3 or any(len(v) != 2 for v in adj.values()):
        return None
    start = next(iter(adj))
    loop, prev, cur = [start], None, start
    while True:
        nxt = next(n for n in adj[cur] if n != prev) if prev else min(adj[cur])
        prev, cur = cur, nxt
        if cur == start:
            break
        loop.append(cur)
    if len(loop) != len(adj):  # more than one loop
        return None
    return [pos[k] for k in loop]


def polygon_area(poly: list[Point] | list[list[float]]) -> float:
    n = len(poly)
    return abs(sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(n))) / 2


def _centroid(poly: list[Point]) -> Point:
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def build_tour(sid: str, geom: dict, rooms: list[Room]) -> TourLayout:
    floors = [
        TourFloor(id=f["id"], label=f.get("label"), index=int(f.get("sequence", 0)))
        for f in geom.get("floors") or []
    ]
    sweeps: list[TourSweep] = []
    for loc in geom.get("locations") or []:
        p = loc.get("position")
        if not p:
            continue  # a sweep without a position cannot be placed or navigated to reliably
        sweeps.append(
            TourSweep(
                id=loc["id"],
                room_id=(loc.get("room") or {}).get("id"),
                floor_index=(loc.get("floor") or {}).get("sequence"),
                position=[float(p["x"]), float(p["y"]), float(p.get("z", 0.0))],
            )
        )
    by_room: dict[str, list[TourSweep]] = {}
    for s in sweeps:
        if s.room_id:
            by_room.setdefault(s.room_id, []).append(s)
    raw_rooms = {r["id"]: r for r in geom.get("rooms") or []}

    out: list[TourRoom] = []
    for room in rooms:
        raw = raw_rooms.get(room.id, {})
        issues: list[str] = []
        edges = (raw.get("boundary") or {}).get("edges") or []
        poly = chain_polygon(edges) if edges else None
        if not edges:
            issues.append("no wall boundary from Matterport")
        elif poly is None:
            issues.append("Matterport wall edges do not form a closed outline")
        poly_prov: Provenance = "verified" if poly else "missing"

        room_sweeps = by_room.get(room.id, [])
        entry, entry_prov = None, "missing"
        if room_sweeps:
            if poly:
                cx, cy = _centroid(poly)
                entry = min(
                    room_sweeps, key=lambda s: (s.position[0] - cx) ** 2 + (s.position[1] - cy) ** 2
                ).id
            else:
                entry = room_sweeps[0].id
            entry_prov = "estimated"
        else:
            issues.append("no tour sweep inside this room; select it to inspect, not to walk to")

        floor_index = next((s.floor_index for s in room_sweeps), None)
        out.append(
            TourRoom(
                room_id=room.id,
                label=room.label,
                usable=room.usable,
                floor_index=floor_index if floor_index is not None else (0 if floors else None),
                polygon=[list(p) for p in poly] if poly else None,
                polygon_provenance=poly_prov,
                sweep_ids=[s.id for s in room_sweeps],
                entry_sweep_id=entry,
                entry_sweep_provenance=entry_prov,
                navigable=entry is not None,
                issues=issues,
            )
        )
    return TourLayout(
        sid=sid, coordinate_note=COORDINATE_NOTE, floors=floors, rooms=out, sweeps=sweeps
    )


def get_tour(sid: str) -> TourLayout:
    return build_tour(sid, fetch_tour_geometry(sid), get_rooms(sid))
