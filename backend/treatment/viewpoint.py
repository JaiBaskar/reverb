"""Pick the Matterport viewpoint for the treated-room picture.

Only real scan positions are candidates (the Showcase camera can stand only where a panorama
was taken). For each scan in the room and each heading (5 deg steps) the score counts the
treatment items whose centres fall inside the view, then how much of the room's floor is in
view, with a small bonus for standing near a corner (a corner view shows the most of a room).
"""

import math

import numpy as np
from pydantic import BaseModel

from acoustics.field import _inside
from roomintel.geometry import RoomGeometry
from roomintel.panorama import ScanPosition
from treatment.placement import PlacedItem

HFOV_DEG = 75.0
VFOV_DEG = 60.0


class Viewpoint(BaseModel):
    scan_id: str
    position: tuple[float, float, float]
    yaw_deg: float  # model frame, CCW from +x
    pitch_deg: float  # negative looks down
    hfov_deg: float
    items_in_view: list[str]
    floor_in_view: float  # share of the floor area inside the view
    corner_distance_m: float
    reason: str


def _in_view(cam, yaw, pitch, p, hfov=HFOV_DEG, vfov=VFOV_DEG) -> bool:
    dx, dy, dz = p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]
    th = math.radians(yaw)
    fwd = dx * math.cos(th) + dy * math.sin(th)
    if fwd <= 0.3:
        return False
    left = -dx * math.sin(th) + dy * math.cos(th)
    if abs(math.degrees(math.atan2(left, fwd))) > hfov / 2 - 3:
        return False
    elev = math.degrees(math.atan2(dz, fwd))
    return abs(elev - pitch) <= vfov / 2 - 3


def choose(
    geo: RoomGeometry, scans: list[ScanPosition], items: list[PlacedItem]
) -> Viewpoint | None:
    if not scans:
        return None
    xs = [p[0] for p in geo.polygon]
    ys = [p[1] for p in geo.polygon]
    gx, gy = np.meshgrid(np.arange(min(xs), max(xs), 0.25), np.arange(min(ys), max(ys), 0.25))
    inside = _inside(gx, gy, geo.polygon)
    floor_pts = [(x, y, geo.floor_z + 0.4) for x, y in zip(gx[inside], gy[inside], strict=True)]
    corners = [c.point for c in geo.corners if c.convex]
    zs = [i.center[2] for i in items] or [geo.floor_z + 1.2]
    best = None
    for s in scans:
        if not _inside(np.array([s.position[0]]), np.array([s.position[1]]), geo.polygon)[0]:
            continue
        corner_d = min((math.dist(s.position[:2], c) for c in corners), default=99.0)
        pitch = max(
            -20.0, min(10.0, math.degrees(math.atan2(float(np.mean(zs)) - s.position[2], 2.5)))
        )
        for yaw in range(0, 360, 5):
            seen = [i.key for i in items if _in_view(s.position, yaw, pitch, i.center)]
            share = sum(_in_view(s.position, yaw, pitch, p) for p in floor_pts) / max(
                1, len(floor_pts)
            )
            score = 10 * len(seen) + 10 * share - 0.5 * corner_d
            if best is None or score > best[0]:
                best = (score, s, yaw, pitch, seen, share, corner_d)
    if best is None:
        return None
    _, s, yaw, pitch, seen, share, corner_d = best
    return Viewpoint(
        scan_id=s.id,
        position=s.position,
        yaw_deg=float(yaw),
        pitch_deg=pitch,
        hfov_deg=HFOV_DEG,
        items_in_view=seen,
        floor_in_view=share,
        corner_distance_m=corner_d,
        reason=(
            f"Scan position {corner_d:.1f} m from a corner, looking at {len(seen)} of {len(items)} "
            f"treatment items with {share:.0%} of the floor in view."
        ),
    )
