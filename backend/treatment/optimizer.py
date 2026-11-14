"""Deterministic treatment optimisation.

Every configuration is a choice of: panel thickness for the first-reflection points (50 or
100 mm), corner bass traps (0, 2 or 4), a ceiling cloud (yes/no), the rear wall (nothing,
absorb, or diffuse when there is room), panels behind the speakers (yes/no) and N extra
coverage panels. Each is scored with the same arithmetic as the room report:

    A'(band) = A(band) + sum over items of (alpha_item - alpha_surface_behind) * area
    RT60'(band) = Eyring with air absorption (acoustics.physics.eyring_rt60) of A' over the
                  room's boundary area S

score = sum over bands of the squared distance outside the target (in units of 0.05 s)
      + 4 for every early reflection still too loud (reflection-free-zone uses)
      + 0.03 per item (do not over-treat; also stands in for cost and wall space)

The lowest score wins; ties go to fewer items. Nothing here is random.
"""

import itertools
import math

import numpy as np
from pydantic import BaseModel

from acoustics.physics import BANDS_HZ, eyring_rt60
from acoustics.products import PRODUCTS
from treatment.objectives import Objective
from treatment.placement import REFLECTION_WINDOW_MS, Candidates, PlacedItem

ITEM_COST = 0.03
BLOCKED_COST = 0.05  # prefer spots furniture does not block, when there is a choice
RFZ_MISS = 4.0
TOL_UNIT_S = 0.05
MAX_COVERAGE = 30
CORNER_SPLAY_M = 0.42  # wall area hidden behind a corner trap, per metre height, per side


class Config(BaseModel):
    reflection_panels: str | None  # product id or None
    traps: int
    cloud: bool
    rear: str  # none | absorb | diffuse
    front: bool
    coverage: int


class Scored(BaseModel):
    config: Config
    items: list[PlacedItem]
    rt60_s: list[float]
    score: float
    rfz_misses: int
    summary: str


def delta_absorption(item: PlacedItem, wall_alpha: list[float]) -> list[float]:
    p = PRODUCTS[item.product_id]
    if p.mount == "ceiling":
        area = item.width_m * item.height_m
        return [a * area for a in p.alpha]  # hangs free: the ceiling behind still reflects
    if p.mount == "corner":
        face = p.width_m * item.height_m
        hidden = 2 * CORNER_SPLAY_M * item.height_m
        return [a * face - w * hidden for a, w in zip(p.alpha, wall_alpha, strict=True)]
    area = item.width_m * item.height_m
    return [(a - w) * area for a, w in zip(p.alpha, wall_alpha, strict=True)]


def predict(
    base_absorption: list[float],
    volume: float,
    items: list[PlacedItem],
    wall_alpha: list[float],
    surface: float,
    bands: list[int] = BANDS_HZ,
) -> list[float]:
    a = list(base_absorption)
    for it in items:
        for b, d in enumerate(delta_absorption(it, wall_alpha)):
            a[b] += d
    return [eyring_rt60(volume, max(x, 1e-6), surface, f) for x, f in zip(a, bands, strict=True)]


def _with_product(item: PlacedItem, product: str) -> PlacedItem:
    p = PRODUCTS[product]
    n = item.normal
    back = (item.center[0] - n[0] * item.depth_m / 2, item.center[1] - n[1] * item.depth_m / 2)
    return item.model_copy(update={
        "product_id": product, "depth_m": p.depth_m,
        "center": (back[0] + n[0] * p.depth_m / 2, back[1] + n[1] * p.depth_m / 2, item.center[2]),
    })  # fmt: skip


WALL_ABSORBERS = ("first_reflection", "front_wall", "rear_wall", "coverage")


def _on_face(point, item: PlacedItem) -> bool:
    """Does a reflection point land on the item's front face (within its width and height,
    and on its plane to within its depth)?"""
    z = np.array(item.normal, dtype=float)
    y = np.array(item.up, dtype=float)
    x = np.cross(y, z)
    d = np.array(point, dtype=float) - np.array(item.center, dtype=float)
    return (
        abs(d @ x) <= item.width_m / 2
        and abs(d @ y) <= item.height_m / 2
        and abs(d @ z) <= item.depth_m / 2 + 0.25
    )


def reflection_after(r, items: list[PlacedItem]) -> tuple[float, str | None]:
    """A reflection's level once the items are installed, and the item that treats it. Only an
    item whose face the reflection point actually lands on counts."""
    for i in items:
        if (i.group == "ceiling") != (r.wall is None):
            continue
        if r.wall is not None and (i.wall != r.wall or i.group not in WALL_ABSORBERS):
            continue
        if _on_face(r.point, i):
            return treated_level(r.spreading_db, PRODUCTS[i.product_id].alpha[3]), i.key
    return r.level_db, None


def residual_reflections(cands: Candidates, items: list[PlacedItem], rfz_db: float) -> int:
    """Early reflections (within 15 ms) still louder than -rfz_db after treatment."""
    return sum(
        1
        for r in cands.reflections
        if r.delay_ms <= REFLECTION_WINDOW_MS and reflection_after(r, items)[0] > -rfz_db
    )


def treated_level(spreading_db: float, alpha: float) -> float:
    """Reflection level off a panel (alpha capped at 0.95: no panel is perfect at 1 kHz)."""
    return spreading_db + 10 * math.log10(1 - min(alpha, 0.95))


def optimise(
    cands: Candidates,
    objective: Objective,
    targets: list[tuple[float, float]],
    base_absorption: list[float],
    volume: float,
    wall_alpha: list[float],
    surface: float,
) -> tuple[Scored, list[Scored]]:
    refl_opts: list[str | None] = ["panel_50", "panel_100"] if cands.first_reflection else [None]
    if not objective.needs_rfz and cands.first_reflection:
        refl_opts.append(None)
    trap_opts = sorted({0, min(2, len(cands.corners)), min(4, len(cands.corners))})
    cloud_opts = [False, True] if cands.ceiling else [False]
    rear_opts = (
        ["none"]
        + (["absorb"] if cands.rear_wall_absorb else [])
        + (["diffuse"] if cands.rear_wall_diffuse and objective.allow_diffusion else [])
    )
    front_opts = [False, True] if cands.front_wall else [False]
    n_cov = min(MAX_COVERAGE, len(cands.slots))

    results: list[Scored] = []
    for rp, tr, cl, rr, fw in itertools.product(
        refl_opts, trap_opts, cloud_opts, rear_opts, front_opts
    ):
        fixed: list[PlacedItem] = []
        if rp:
            fixed += [_with_product(i, rp) for i in cands.first_reflection]
        fixed += cands.corners[:tr]
        if cl:
            fixed += cands.ceiling
        if rr == "absorb":
            fixed += cands.rear_wall_absorb
        elif rr == "diffuse":
            fixed += cands.rear_wall_diffuse
        if fw:
            fixed += cands.front_wall
        misses = residual_reflections(cands, fixed, objective.rfz_db) if objective.needs_rfz else 0
        for n in range(n_cov + 1):
            items = fixed + cands.slots[:n]
            rt = predict(base_absorption, volume, items, wall_alpha, surface)
            dev = sum(
                (max(0.0, lo - t) / TOL_UNIT_S) ** 2 + (max(0.0, t - hi) / TOL_UNIT_S) ** 2
                for t, (lo, hi) in zip(rt, targets, strict=True)
            )
            score = dev + RFZ_MISS * misses + ITEM_COST * len(items)
            score += BLOCKED_COST * sum(i.status == "blocked" for i in items)
            results.append(Scored(
                config=Config(reflection_panels=rp, traps=tr, cloud=cl, rear=rr, front=fw, coverage=n),
                items=items, rt60_s=rt, score=score, rfz_misses=misses,
                summary=_summary(rp, tr, cl, rr, fw, n),
            ))  # fmt: skip
            if all(t < lo for t, (lo, _) in zip(rt, targets, strict=True)):
                break  # more panels only make it deader
    results.sort(key=lambda s: (round(s.score, 6), len(s.items)))
    return results[0], results


def _summary(rp, tr, cl, rr, fw, n) -> str:
    parts = []
    if rp:
        parts.append(f"first-reflection panels ({rp.split('_')[1]} mm)")
    if tr:
        parts.append(f"{tr} corner bass traps")
    if cl:
        parts.append("ceiling cloud")
    if rr != "none":
        parts.append(f"rear wall {'diffusers' if rr == 'diffuse' else 'absorbers'}")
    if fw:
        parts.append("panels behind the speakers")
    if n:
        parts.append(f"{n} extra wall panels")
    return ", ".join(parts) or "no treatment"
