"""Virtual cameras rendered from Matterport skyboxes, aimed at one wall at a time.

A wall view is a perspective image (horizon level) from a real scan position, rendered by
sampling the four side faces of the cube map (panorama.py conventions). Because the camera is
known, any column of the view maps back to a point along the wall: the walls agent reports
windows and doors as image columns and `along_wall` turns them into metres along that wall.
"""

import math

import numpy as np
from PIL import Image
from pydantic import BaseModel

from roomintel.geometry import RoomGeometry, Wall
from roomintel.panorama import ScanPosition, face_heading

VIEW_W, VIEW_H = 1024, 640
MAX_HFOV = 120.0
MIN_WALL_M = 0.9


class WallView(BaseModel):
    wall: int
    scan_id: str
    yaw_deg: float  # view centre, model frame CCW from +x
    hfov_deg: float
    width: int
    height: int


def render(scan: ScanPosition, faces: dict[int, np.ndarray], yaw: float, hfov: float,
           w: int = VIEW_W, h: int = VIEW_H) -> np.ndarray:  # fmt: skip
    """Perspective view at the horizon; pixels whose ray misses the side faces stay black."""
    f = (w / 2) / math.tan(math.radians(hfov) / 2)
    xs = (np.arange(w) + 0.5 - w / 2) / f  # right is +
    ys = (np.arange(h) + 0.5 - h / 2) / f  # down is +
    X, Y = np.meshgrid(xs, ys)
    th = math.radians(yaw)
    # model-space ray: forward (cos, sin), left (-sin, cos); right = -left; up = +z
    dx = math.cos(th) + X * math.sin(th)
    dy = math.sin(th) - X * math.cos(th)
    dz = -Y
    out = np.zeros((h, w, 3), dtype=np.uint8)
    for k in (1, 2, 3, 4):
        img = faces.get(k)
        if img is None:
            continue
        fh = math.radians(face_heading(scan.yaw_deg, k))
        fwd = dx * math.cos(fh) + dy * math.sin(fh)
        left = -dx * math.sin(fh) + dy * math.cos(fh)
        with np.errstate(divide="ignore", invalid="ignore"):
            u = 0.5 - left / fwd / 2
            v = 0.5 - dz / fwd / 2
        m = (fwd > 0) & (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
        H, W = img.shape[:2]
        out[m] = img[(v[m] * H).astype(int), (u[m] * W).astype(int)]
    return out


def _angles(scan: ScanPosition, w: Wall) -> tuple[float, float] | None:
    a = math.degrees(math.atan2(w.start[1] - scan.position[1], w.start[0] - scan.position[0]))
    b = math.degrees(math.atan2(w.end[1] - scan.position[1], w.end[0] - scan.position[0]))
    span = (a - b + 540) % 360 - 180  # seen from inside, a wall runs right-to-left... any order
    return (b + span / 2, abs(span))


def plan_views(geo: RoomGeometry, scans: list[ScanPosition]) -> list[WallView]:
    """For each wall worth inspecting, the scan that sees it widest (up to MAX_HFOV) and in front."""
    out = []
    for w in geo.walls:
        if w.length_m < MIN_WALL_M:
            continue
        best = None
        for s in scans:
            # the scan must be on the room side of the wall
            if (s.position[0] - w.start[0]) * w.inward[0] + (s.position[1] - w.start[1]) * w.inward[
                1
            ] < 0.3:
                continue
            centre, span = _angles(s, w)
            if span + 10 > MAX_HFOV + 30:  # too close: the wall would be badly stretched
                continue
            if best is None or abs(min(span, MAX_HFOV) - 80) < abs(min(best[2], MAX_HFOV) - 80):
                best = (s, centre, span)
        if best:
            s, centre, span = best
            out.append(WallView(wall=w.index, scan_id=s.id, yaw_deg=centre, hfov_deg=min(MAX_HFOV, span + 10),
                                width=VIEW_W, height=VIEW_H))  # fmt: skip
    return out


def along_wall(view: WallView, scan: ScanPosition, wall: Wall, x_frac: float) -> float | None:
    """Image column of a wall view -> metres along the wall from its start (None if it misses)."""
    t = math.tan(math.radians(view.hfov_deg) / 2)
    bearing = math.radians(view.yaw_deg) + math.atan((0.5 - x_frac) * 2 * t)
    o = np.array(scan.position[:2])
    d = np.array([math.cos(bearing), math.sin(bearing)])
    a, b = np.array(wall.start), np.array(wall.end)
    e = b - a
    den = d[0] * (-e[1]) + d[1] * e[0]
    if abs(den) < 1e-9:
        return None
    rel = a - o
    tt = (rel[0] * (-e[1]) + rel[1] * e[0]) / den
    s = (d[0] * rel[1] - d[1] * rel[0]) / den
    if tt <= 0 or not -0.05 <= s <= 1.05:
        return None
    return float(min(max(s, 0.0), 1.0) * wall.length_m)


def save(arr: np.ndarray, path) -> None:
    Image.fromarray(arr).save(path, "JPEG", quality=88)
