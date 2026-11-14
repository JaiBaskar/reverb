"""Room geometry from Matterport: the room's outline (Model API) checked and enriched with the
model's 50k OBJ mesh (Matterport's defurnished architectural shell, z up, same frame).

From the mesh, inside the outline:
- floor and ceiling heights: the dominant up- and down-facing surface levels (area-weighted);
- per wall: how much of it is actually scanned surface, in 0.25 m strips along its length.
  Strips with little surface are openings: doorways, open plan, or glass the scanner saw
  through. Treatment is never placed on them.

Without a mesh the outline is used as is (no opening data); without an outline, a rectangle
from the Model API width x depth (estimated, user-correctable). Nothing is filled in silently:
every value carries its provenance and the notes say what is missing.
"""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.field import _inside
from properties.models import Field, Room

STRIP_M = 0.25
WALL_BAND_M = 0.2  # mesh within this distance of the wall line belongs to the wall
OPEN_BELOW = 0.55  # strips with less scanned surface than this share are openings
LEVEL_BIN_M = 0.05
HEIGHT_AGREE_M = 0.10


class Wall(BaseModel):
    index: int
    start: tuple[float, float]
    end: tuple[float, float]
    length_m: float
    area_m2: float
    inward: tuple[float, float]  # unit normal pointing into the room
    coverage: float | None  # share of the wall that is scanned surface (None: no mesh)
    strips: list[float] | None  # coverage per STRIP_M strip, start to end
    openings: list[tuple[float, float]]  # [from, to] metres along the wall
    # The outline is the wall centreline; the room-side surface is this far in (from the mesh).
    surface_offset_m: float = 0.0
    # Rectangles no treatment may cover: (from, to along the wall, bottom, top above the floor, what)
    no_go: list[tuple[float, float, float, float, str]] = []


class Corner(BaseModel):
    index: int
    point: tuple[float, float]
    interior_angle_deg: float
    convex: bool  # True for an ordinary room corner (interior angle < 180)
    walls: tuple[int, int]  # wall indices meeting here


class RoomGeometry(BaseModel):
    polygon: list[tuple[float, float]]
    polygon_provenance: Literal["verified", "estimated"]
    floor_z: float
    height: Field
    area_m2: float
    volume_m3: float
    walls: list[Wall]
    corners: list[Corner]
    source: Literal["mesh+outline", "outline", "box"]
    notes: list[str]


def _ccw(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))
    return poly if a > 0 else poly[::-1]


def _walls_and_corners(poly, height: float):
    n = len(poly)
    walls = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.dist(a, b)
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        walls.append(
            Wall(
                index=i,
                start=a,
                end=b,
                length_m=L,
                area_m2=L * height,
                inward=(-uy, ux),  # left of the direction of travel on a CCW polygon
                coverage=None,
                strips=None,
                openings=[],
            )
        )
    corners = []
    for i in range(n):
        prev, here, nxt = poly[i - 1], poly[i], poly[(i + 1) % n]
        v1 = (prev[0] - here[0], prev[1] - here[1])
        v2 = (nxt[0] - here[0], nxt[1] - here[1])
        # CCW polygon: the interior angle turns counter-clockwise from the next edge to the previous.
        ang = math.degrees(math.atan2(v2[0] * v1[1] - v2[1] * v1[0], v1[0] * v2[0] + v1[1] * v2[1]))
        interior = ang % 360
        corners.append(
            Corner(
                index=i,
                point=here,
                interior_angle_deg=interior,
                convex=interior < 180,
                walls=((i - 1) % n, i),
            )
        )
    return walls, corners


def _dominant_level(z: np.ndarray, area: np.ndarray) -> float | None:
    if not len(z):
        return None
    lo, hi = float(z.min()), float(z.max())
    edges = np.arange(lo, hi + LEVEL_BIN_M * 2, LEVEL_BIN_M)
    hist, edges = np.histogram(z, bins=edges, weights=area)
    k = int(np.argmax(hist))
    sel = (z >= edges[k]) & (z <= edges[k + 1])
    return float(np.average(z[sel], weights=area[sel]))


def _wall_coverage(mesh, wall: Wall, z0: float, z1: float, seed: int) -> list[float]:
    """Share of each strip of the wall covered by vertical mesh surface (point sampling)."""
    import trimesh

    a = np.array(wall.start)
    u = (np.array(wall.end) - a) / wall.length_m
    n = np.array(wall.inward)
    c = mesh.triangles_center
    rel = c[:, :2] - a
    t = rel @ u
    d = np.abs(rel @ n)
    vertical = np.abs(mesh.face_normals[:, 2]) < 0.3
    near = vertical & (d < WALL_BAND_M + 0.5) & (t > -0.5) & (t < wall.length_m + 0.5)
    nstrips = max(1, math.ceil(wall.length_m / STRIP_M))
    covered = np.zeros(nstrips)
    if near.any():
        sub = mesh.submesh([np.nonzero(near)[0]], append=True)
        count = int(max(200, sub.area * 600))
        pts, _ = trimesh.sample.sample_surface(sub, count, seed=seed)
        per = sub.area / count
        rel = pts[:, :2] - a
        t, d = rel @ u, np.abs(rel @ n)
        z = pts[:, 2]
        keep = (d < WALL_BAND_M) & (t >= 0) & (t < wall.length_m) & (z > z0) & (z < z1)
        idx = np.minimum((t[keep] / STRIP_M).astype(int), nstrips - 1)
        np.add.at(covered, idx, per)
    strip_len = np.full(nstrips, STRIP_M)
    strip_len[-1] = wall.length_m - STRIP_M * (nstrips - 1)
    return list(np.clip(covered / (strip_len * (z1 - z0)), 0, 1).round(3))


def _surface_offset(mesh, wall: Wall, floor_z: float, h: float) -> float:
    """How far into the room the scanned wall surface sits from the outline (centreline)."""
    a = np.array(wall.start)
    u = (np.array(wall.end) - a) / wall.length_m
    n = np.array(wall.inward)
    c = mesh.triangles_center
    rel = c[:, :2] - a
    t, d = rel @ u, rel @ n
    vert = np.abs(mesh.face_normals[:, 2]) < 0.2
    # faces facing into the room, near the line, away from the corners, mid-height
    facing = mesh.face_normals[:, :2] @ n > 0.8
    m = vert & facing & (np.abs(d) < 0.25) & (t > 0.2) & (t < wall.length_m - 0.2)
    m &= (c[:, 2] > floor_z + 0.3) & (c[:, 2] < floor_z + h - 0.3)
    if m.sum() < 3:
        return 0.0
    return float(np.clip(np.average(d[m], weights=mesh.area_faces[m]), -0.1, 0.2))


def _openings(strips: list[float], length: float) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    start = None
    for i, c in enumerate([*strips, 1.0]):
        if c < OPEN_BELOW and start is None:
            start = i
        elif c >= OPEN_BELOW and start is not None:
            out.append((start * STRIP_M, min(i * STRIP_M, length)))
            start = None
    return [o for o in out if o[1] - o[0] >= 0.5]  # ignore single-strip gaps (scan noise)


def room_geometry(room: Room, polygon: list | None, mesh=None, seed: int = 7) -> RoomGeometry:
    notes: list[str] = []
    api_h = room.height_m
    if polygon and len(polygon) >= 3:
        poly = _ccw([(float(x), float(y)) for x, y in polygon])
        poly_prov: Literal["verified", "estimated"] = "verified"
        source: Literal["mesh+outline", "outline", "box"] = "outline"
    elif room.width_m.value and room.depth_m.value:
        w, d = room.width_m.value, room.depth_m.value
        poly = [(0.0, 0.0), (w, 0.0), (w, d), (0.0, d)]
        poly_prov, source = "estimated", "box"
        notes.append(
            f"Matterport gives no wall outline: the room is modeled as a {w:.2f} x {d:.2f} m "
            "rectangle (its bounding dimensions) in its own frame; correct the size if needed."
        )
    else:
        raise ValueError(f"room {room.id} has neither an outline nor width and depth")

    xs, ys = np.array([p[0] for p in poly]), np.array([p[1] for p in poly])
    area = 0.5 * abs(float(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1))))
    floor_z = 0.0
    height = api_h
    if mesh is not None and source == "outline":
        c = mesh.triangles_center
        inside = _inside(c[:, 0], c[:, 1], poly)
        nz = mesh.face_normals[:, 2]
        fa = mesh.area_faces
        # Floor: the dominant upward surface in the lowest metre inside the outline. Ceiling: the
        # dominant downward surface at least 1.8 m above it (ignores slab undersides and the
        # floor below on multi-storey scans).
        up, down = inside & (nz > 0.9), inside & (nz < -0.9)
        f_lvl = None
        if up.any():
            low = up & (c[:, 2] < c[up, 2].min() + 1.0)
            f_lvl = _dominant_level(c[low, 2], fa[low])
        c_lvl = None
        if f_lvl is not None:
            high = down & (c[:, 2] > f_lvl + 1.8)
            c_lvl = _dominant_level(c[high, 2], fa[high])
        if f_lvl is not None and c_lvl is not None and c_lvl > f_lvl + 1.8:
            source = "mesh+outline"
            floor_z = f_lvl
            mesh_h = c_lvl - f_lvl
            if api_h.value is None:
                height = Field(value=mesh_h, provenance="estimated", note="from the scan mesh")
            elif abs(mesh_h - api_h.value) <= HEIGHT_AGREE_M:
                height = Field(
                    value=api_h.value,
                    provenance="verified",
                    note=f"Matterport height; the scan mesh agrees ({mesh_h:.2f} m)",
                )
            else:
                notes.append(
                    f"Matterport lists the ceiling at {api_h.value:.2f} m but the scan mesh puts "
                    f"it at {mesh_h:.2f} m (sloped or stepped ceiling?); using the mesh value."
                )
                height = Field(value=mesh_h, provenance="estimated", note="from the scan mesh")
        else:
            notes.append("The scan mesh has no clear floor and ceiling inside this outline.")
    elif mesh is None and source == "outline":
        notes.append("No scan mesh: walls come from the outline without opening detection.")
    if height.value is None:
        raise ValueError(f"room {room.id} has no ceiling height")
    h = height.value

    walls, corners = _walls_and_corners(poly, h)
    if source == "mesh+outline":
        for w in walls:
            strips = _wall_coverage(mesh, w, floor_z + 0.1, floor_z + h - 0.1, seed + w.index)
            w.strips = strips
            w.coverage = float(np.mean(strips))
            w.openings = _openings(strips, w.length_m)
            w.surface_offset_m = _surface_offset(mesh, w, floor_z, h)
        if any(w.openings for w in walls):
            notes.append(
                "Openings are wall stretches with little scanned surface: doorways, open plan, "
                "or glass the scanner saw through. No treatment is placed on them."
            )
    return RoomGeometry(
        polygon=poly,
        polygon_provenance=poly_prov,
        floor_z=floor_z,
        height=height,
        area_m2=area,
        volume_m3=area * h,
        walls=walls,
        corners=corners,
        source=source,
        notes=notes,
    )
