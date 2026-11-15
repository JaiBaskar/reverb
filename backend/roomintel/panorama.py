"""Matterport skybox geometry: which way each face looks, and pixel <-> model-space rays.

Verified on zvKHR9DHNjJ (den, pano sa0ccfc88azxsste162hiipwd) by projecting the room's floor
and ceiling corners onto the 2k faces: they land on the visible corners. Conventions:
- faces: 0 = up, 1-4 = sides, 5 = down; each side face is a 90 deg pinhole view;
- face 1 looks along the panorama's heading (yaw of its rotation quaternion about z, CCW from
  model +x); faces 2, 3, 4 turn clockwise by 90 deg each;
- x_frac grows to the right, y_frac grows downwards, both 0..1.
"""

import math

from pydantic import BaseModel


class ScanPosition(BaseModel):
    id: str
    position: tuple[float, float, float]  # model space, metres, z up (camera centre)
    yaw_deg: float  # heading of skybox face 1, CCW from +x
    room_id: str | None


def yaw_from_quaternion(q: dict) -> float:
    """Heading about z (degrees). Matterport pano rotations are near-pure yaw."""
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    return math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))


def face_heading(yaw_deg: float, face: int) -> float:
    if face not in (1, 2, 3, 4):
        raise ValueError("only side faces (1-4) have a heading")
    return yaw_deg - 90.0 * (face - 1)


def pixel_bearing(yaw_deg: float, face: int, x_frac: float) -> float:
    """Model-space bearing (degrees, CCW from +x) of a pixel column on a side face."""
    return face_heading(yaw_deg, face) + math.degrees(math.atan((0.5 - x_frac) * 2))


def floor_point(
    scan: ScanPosition, face: int, x_frac: float, y_frac: float, floor_z: float
) -> tuple[float, float] | None:
    """Where a pixel below the horizon meets the floor (model x, y), or None above it."""
    below = (y_frac - 0.5) * 2  # tan of the depression angle along the face's axis
    drop = scan.position[2] - floor_z
    if below <= 0.02 or drop <= 0:
        return None
    fwd = drop / below
    left = fwd * (0.5 - x_frac) * 2
    th = math.radians(face_heading(scan.yaw_deg, face))
    x = scan.position[0] + fwd * math.cos(th) - left * math.sin(th)
    y = scan.position[1] + fwd * math.sin(th) + left * math.cos(th)
    return (x, y)


def project(
    scan: ScanPosition, face: int, p: tuple[float, float, float]
) -> tuple[float, float] | None:
    """Model-space point -> (x_frac, y_frac) on a side face, or None if not in front of it."""
    th = math.radians(face_heading(scan.yaw_deg, face))
    dx, dy, dz = p[0] - scan.position[0], p[1] - scan.position[1], p[2] - scan.position[2]
    fwd = dx * math.cos(th) + dy * math.sin(th)
    left = -dx * math.sin(th) + dy * math.cos(th)
    if fwd <= 0.05:
        return None
    return (0.5 - left / fwd / 2, 0.5 - dz / fwd / 2)


def scan_positions(assets: dict) -> list[ScanPosition]:
    out = []
    for p in assets.get("panoLocations") or []:
        pos, rot = p.get("position"), p.get("rotation")
        if not pos or not rot:
            continue
        out.append(
            ScanPosition(
                id=p["id"],
                position=(pos["x"], pos["y"], pos["z"]),
                yaw_deg=yaw_from_quaternion(rot),
                room_id=((p.get("anchor") or {}).get("room") or {}).get("id"),
            )
        )
    return out
