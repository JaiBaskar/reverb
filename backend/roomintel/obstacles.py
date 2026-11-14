"""What occupies the room besides air: the building and the furniture, from Matterport meshes.

- building: points sampled from the defurnished 50k mesh (Matterport's architectural shell:
  walls, door and window frames, beams, built-ins);
- furniture: points sampled from the MatterPak's full (furnished) mesh that are more than
  FURNITURE_GAP_M from the shell. They are grouped into objects by 3D connectivity on a
  10 cm voxel grid; each object gets its box, height and whether it hangs on a wall (art,
  shelves, TV) or stands on the floor.

Both are restricted to the room's outline (plus a small margin). The point sets stay in memory
for collision tests; the object boxes go into the room model.
"""

import logging
from functools import lru_cache
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.field import _edge_distance, _inside

log = logging.getLogger(__name__)

FURNITURE_GAP_M = 0.07
VOXEL_M = 0.1
MIN_POINTS = 40
SAMPLES_PER_M2 = 900


class FurnitureObject(BaseModel):
    id: str
    min: tuple[float, float, float]
    max: tuple[float, float, float]
    points: int
    mounting: Literal["floor", "wall", "ceiling"]
    label: str  # named by the furniture agent when one of its pieces lies inside, else generic
    named_by: Literal["furniture_agent", "geometry"]


class Obstacles:
    def __init__(
        self,
        building: np.ndarray,
        furniture_pts: np.ndarray,
        labels: np.ndarray,
        objects: list[FurnitureObject],
    ):
        self.building = building
        self.furniture_pts = furniture_pts
        self.labels = labels  # object index per furniture point
        self.objects = objects


def _sample(mesh, density: float, seed: int, bbox=None) -> np.ndarray:
    import trimesh

    if bbox is not None:
        lo, hi = bbox
        c = mesh.triangles_center
        keep = np.all((c >= lo) & (c <= hi), axis=1)
        if not keep.any():
            return np.zeros((0, 3))
        mesh = mesh.submesh([np.nonzero(keep)[0]], append=True)
    n = int(max(500, min(600_000, mesh.area * density)))
    pts, _ = trimesh.sample.sample_surface(mesh, n, seed=seed)
    return pts


def build(shell, full, polygon, floor_z: float, height: float, margin: float = 0.3) -> Obstacles:
    from scipy import ndimage
    from scipy.spatial import cKDTree

    P = np.array(polygon)
    lo = np.array([P[:, 0].min() - margin, P[:, 1].min() - margin, floor_z - 0.1])
    hi = np.array([P[:, 0].max() + margin, P[:, 1].max() + margin, floor_z + height + 0.1])
    building = _sample(shell, SAMPLES_PER_M2, 11, (lo, hi))
    near = _inside(building[:, 0], building[:, 1], polygon) | (
        _edge_distance(building[:, 0], building[:, 1], polygon) < margin
    )
    building = building[near]
    if full is None:
        return Obstacles(building, np.zeros((0, 3)), np.zeros(0, int), [])

    pts = _sample(full, SAMPLES_PER_M2, 13, (lo, hi))
    inside = _inside(pts[:, 0], pts[:, 1], polygon)
    pts = pts[inside & (pts[:, 2] > floor_z + 0.03) & (pts[:, 2] < floor_z + height - 0.03)]
    if not len(pts) or not len(building):
        return Obstacles(building, np.zeros((0, 3)), np.zeros(0, int), [])
    dist, _ = cKDTree(building).query(pts, k=1)
    fur = pts[dist > FURNITURE_GAP_M]
    if not len(fur):
        return Obstacles(building, fur, np.zeros(0, int), [])

    idx = np.floor((fur - lo) / VOXEL_M).astype(int)
    shape = idx.max(axis=0) + 1
    grid = np.zeros(shape, dtype=bool)
    grid[tuple(idx.T)] = True
    lab, n = ndimage.label(grid, structure=np.ones((3, 3, 3)))
    point_lab = lab[tuple(idx.T)] - 1
    objects, keep_ids = [], {}
    for k in range(n):
        sel = fur[point_lab == k]
        if len(sel) < MIN_POINTS:
            continue
        mn, mx = sel.min(axis=0), sel.max(axis=0)
        wall_gap = float(
            _edge_distance(
                np.array([(mn[0] + mx[0]) / 2]), np.array([(mn[1] + mx[1]) / 2]), polygon
            )[0]
        )
        if mn[2] > floor_z + 0.6 * height:  # hangs from the ceiling: pendant, fan, fixture
            mounting = "ceiling"
        elif mn[2] > floor_z + 0.4 and min(mx[0] - mn[0], mx[1] - mn[1]) < 0.35 and wall_gap < 0.4:
            mounting = "wall"
        else:
            mounting = "floor"
        keep_ids[k] = len(objects)
        objects.append(FurnitureObject(
            id=f"f{len(objects) + 1}", min=tuple(mn.round(3)), max=tuple(mx.round(3)), points=len(sel),
            mounting=mounting, label=_generic(mounting, mx[2] - floor_z), named_by="geometry",
        ))  # fmt: skip
    labels = np.array([keep_ids.get(k, -1) for k in point_lab])
    m = labels >= 0
    return Obstacles(building, fur[m], labels[m], objects)


def _generic(mounting: str, top: float) -> str:
    if mounting == "wall":
        return "something mounted on the wall (art, shelf or screen)"
    if mounting == "ceiling":
        return "a ceiling fixture"
    return "a tall piece of furniture" if top > 1.3 else "a piece of furniture"


@lru_cache(maxsize=8)
def _meshes(sid: str):
    import trimesh

    from properties import matterport

    shell = full = None
    try:
        p = matterport.mesh_path(sid)
        shell = trimesh.load(p, file_type="obj", force="mesh") if p else None
    except matterport.MatterportError as e:
        log.warning("no shell mesh for %s: %s", sid, e)
    try:
        p = matterport.furnished_mesh_path(sid)
        full = trimesh.load(p, file_type="obj", force="mesh", skip_materials=True) if p else None
    except matterport.MatterportError as e:
        log.warning("no furnished mesh for %s: %s", sid, e)
    return shell, full


def for_room(sid: str, polygon, floor_z: float, height: float) -> Obstacles | None:
    shell, full = _meshes(sid)
    if shell is None:
        return None
    return build(shell, full, polygon, floor_z, height)
