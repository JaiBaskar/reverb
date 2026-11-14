"""How the sound changes across a room: three modeled maps on a grid at ear height.

All deterministic, from the room's Matterport outline (metres, model space), its height,
octave-band RT60 (which already includes materials and furniture) and surface absorption.

- C50 clarity (1 kHz), Barron & Lee's revised theory: direct d = 100/r^2, early reflected
  e = (31200 T / V) e^(-0.04 r / T) (1 - e^(-0.69 / T)), late l = (31200 T / V)
  e^(-0.04 r / T) e^(-0.69 / T); C50 = 10 log10((d + e) / l). Higher = clearer.
- Early wall reflections (1 kHz): energy of first-order image sources in the real walls
  (only where the reflection point lies on the wall) that arrive within ~5 ms of the direct
  sound, relative to it, in dB. High near walls and corners: comb filtering.
- Bass unevenness: modal sum of a rigid box aligned with the room's longest wall and sized to
  the outline's extent, damped by the 125 Hz RT60; the spread (standard deviation, dB) of the
  level from 30 to 200 Hz at each point. Lower = smoother bass. Below the Schroeder frequency
  this is the dominant effect; above it, rooms behave statistically.
"""

import math

import numpy as np
from pydantic import BaseModel

from acoustics.physics import SPEED_OF_SOUND, polygon_area

EAR_HEIGHT_M = 1.2
MIN_DIST_M = 0.3
WALL_CLEARANCE_M = 0.6
SOURCE_CLEARANCE_M = 1.0
BAND_1K = 3
BAND_125 = 0
BASS_F = (30.0, 200.0)
COMB_PATH_M = 1.7  # ~5 ms extra path: reflections this early cause comb filtering
REFLECTION_FLOOR_DB = -20.0  # reported when no early wall reflection reaches a point


class RoomField(BaseModel):
    origin: tuple[float, float]  # model-space (x, y) of grid node (0, 0)
    step: float
    nx: int
    ny: int
    c50_db: list[float | None]  # row-major: index = j * nx + i; None outside the outline
    reflection_db: list[float | None]
    bass_spread_db: list[float | None]
    source: tuple[float, float]
    source_height_m: float
    listener_height_m: float
    best_spot: tuple[float, float]
    ranges: dict[str, tuple[float, float]]
    notes: list[str]


def _inside(px: np.ndarray, py: np.ndarray, poly) -> np.ndarray:
    """Even-odd ray casting, vectorised."""
    inside = np.zeros(px.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        crosses = (y0 > py) != (y1 > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (x1 - x0) * (py - y0) / (y1 - y0) + x0
        inside ^= crosses & (px < xint)
    return inside


def _edge_distance(px: np.ndarray, py: np.ndarray, poly) -> np.ndarray:
    d = np.full(px.shape, np.inf)
    for i in range(len(poly)):
        ax, ay = poly[i - 1]
        bx, by = poly[i]
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy or 1e-12
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
        d = np.minimum(d, np.hypot(px - (ax + t * vx), py - (ay + t * vy)))
    return d


def grid_inside(poly, step: float):
    xs_ = [p[0] for p in poly]
    ys_ = [p[1] for p in poly]
    x0, y0 = min(xs_), min(ys_)
    nx = math.floor((max(xs_) - x0) / step + 1e-9) + 1
    ny = math.floor((max(ys_) - y0) / step + 1e-9) + 1
    xs, ys = np.meshgrid(x0 + step * np.arange(nx), y0 + step * np.arange(ny))
    inside = _inside(xs, ys, poly) | (_edge_distance(xs, ys, poly) < 1e-6)
    return xs, ys, inside


def barron_c50(r, T: float, V: float):
    r = np.maximum(r, MIN_DIST_M)
    fac = 31200.0 * T / V * np.exp(-0.04 * r / T)
    d = 100.0 / r**2
    e = fac * (1 - math.exp(-0.69 / T))
    late = fac * math.exp(-0.69 / T)
    return 10 * np.log10((d + e) / late)


def _longest_edge(poly):
    i = max(range(len(poly)), key=lambda k: math.dist(poly[k - 1], poly[k]))
    return poly[i - 1], poly[i]


def default_source(poly) -> tuple[float, float]:
    """A loudspeaker/performer spot: 1 m into the room from the middle of the longest wall."""
    (ax, ay), (bx, by) = _longest_edge(poly)
    mx, my = (ax + bx) / 2, (ay + by) / 2
    L = math.dist((ax, ay), (bx, by))
    nx_, ny_ = -(by - ay) / L, (bx - ax) / L
    for sgn in (1, -1):
        x, y = mx + sgn * nx_ * SOURCE_CLEARANCE_M, my + sgn * ny_ * SOURCE_CLEARANCE_M
        if _inside(np.array([x]), np.array([y]), poly)[0]:
            return (x, y)
    return tuple(np.mean(np.array(poly, dtype=float), axis=0))


def _reflections(px, py, poly, src, zs, zr, alpha):
    """Wall reflections arriving within COMB_PATH_M of the direct sound (about 5 ms), as
    energy relative to the direct sound in dB at 1 kHz (first-order image sources in the real
    outline; a reflection counts only where its reflection point lies on the wall). Floor and
    ceiling bounces are everywhere, so they are left out of this placement map."""
    sx, sy = src
    a_wall = alpha["walls"][BAND_1K]
    dz = zs - zr
    rd = np.maximum(np.hypot(np.hypot(px - sx, py - sy), dz), MIN_DIST_M)
    total = np.zeros(px.shape)
    for i in range(len(poly)):
        ax, ay = poly[i - 1]
        bx, by = poly[i]
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        if L2 < 1e-9:
            continue
        t = ((sx - ax) * vx + (sy - ay) * vy) / L2
        fx, fy = ax + t * vx, ay + t * vy
        ix, iy = 2 * fx - sx, 2 * fy - sy  # image of the source in the wall line
        # where the path image->receiver crosses the wall line, as a fraction along the wall
        dx, dy = px - ix, py - iy
        den = dx * vy - dy * vx
        with np.errstate(divide="ignore", invalid="ignore"):
            u = ((ax - ix) * dy - (ay - iy) * dx) / den
            s = ((ax - ix) * vy - (ay - iy) * vx) / den
        ri = np.maximum(np.sqrt(dx**2 + dy**2 + dz**2), MIN_DIST_M)
        valid = (np.abs(den) > 1e-12) & (u >= 0) & (u <= 1) & (s > 0) & (s < 1)
        valid &= ri - rd <= COMB_PATH_M
        total = total + np.where(valid, (1 - a_wall) / ri**2, 0.0)
    rel = total * rd**2
    return np.where(rel > 0, 10 * np.log10(np.maximum(rel, 1e-12)), REFLECTION_FLOOR_DB).clip(
        REFLECTION_FLOOR_DB
    )


def _bass_spread(px, py, poly, src, zs, zr, h, t125):
    (ax, ay), (bx, by) = _longest_edge(poly)
    th = math.atan2(by - ay, bx - ax)
    c, s = math.cos(th), math.sin(th)
    P = np.array(poly, dtype=float)
    pu, pv = P[:, 0] * c + P[:, 1] * s, -P[:, 0] * s + P[:, 1] * c
    u0, v0 = pu.min(), pv.min()
    Lx, Ly, Lz = pu.max() - u0, pv.max() - v0, h
    to_uv = lambda x, y: (x * c + y * s - u0, -x * s + y * c - v0)
    ru, rv = to_uv(px, py)
    su, sv = to_uv(*src)

    fmax = 1.5 * BASS_F[1]
    nmax = [int(2 * fmax * L / SPEED_OF_SOUND) + 1 for L in (Lx, Ly, Lz)]
    idx = np.array(
        [
            (i, j, k)
            for i in range(nmax[0] + 1)
            for j in range(nmax[1] + 1)
            for k in range(nmax[2] + 1)
        ]
    )[1:]  # skip (0, 0, 0)
    fn = (
        SPEED_OF_SOUND
        / 2
        * np.sqrt((idx[:, 0] / Lx) ** 2 + (idx[:, 1] / Ly) ** 2 + (idx[:, 2] / Lz) ** 2)
    )
    keep = fn <= fmax
    idx, fn = idx[keep], fn[keep]
    eps = np.prod(np.where(idx == 0, 1.0, 2.0), axis=1)
    psi_s = (
        np.cos(idx[:, 0] * np.pi * su / Lx)
        * np.cos(idx[:, 1] * np.pi * sv / Ly)
        * np.cos(idx[:, 2] * np.pi * zs / Lz)
    )
    flat_u, flat_v = ru.ravel(), rv.ravel()
    psi_r = (
        np.cos(np.outer(flat_u, idx[:, 0] * np.pi / Lx))
        * np.cos(np.outer(flat_v, idx[:, 1] * np.pi / Ly))
        * np.cos(idx[:, 2] * np.pi * zr / Lz)[None, :]
    )
    freqs = BASS_F[0] * 2 ** (np.arange(0, math.log2(BASS_F[1] / BASS_F[0]) + 1e-9, 1 / 24))
    w = 2 * np.pi * freqs
    wn = 2 * np.pi * fn
    delta = 6.91 / t125
    denom = wn[None, :] ** 2 - w[:, None] ** 2 + 2j * delta * w[:, None]  # (F, N)
    coef = (eps * psi_s)[None, :] / denom  # (F, N)
    p = psi_r @ coef.T  # (points, F)
    level = 20 * np.log10(np.abs(p) + 1e-12)
    return level.std(axis=1).reshape(px.shape)


def _round(a: np.ndarray, mask: np.ndarray) -> list[float | None]:
    return [round(float(v), 2) if ok else None for v, ok in zip(a.ravel(), mask.ravel())]


def room_field(
    poly,
    height: float,
    rt60: list[float],
    alpha: dict[str, list[float]],
    source: tuple[float, float] | None = None,
    step: float = 0.25,
) -> RoomField:
    poly = [(float(x), float(y)) for x, y in poly]
    xs, ys, inside = grid_inside(poly, step)
    V = polygon_area(poly) * height
    src = tuple(source) if source is not None else default_source(poly)
    zs = zr = min(EAR_HEIGHT_M, 0.45 * height)
    r = np.hypot(np.hypot(xs - src[0], ys - src[1]), zs - zr)

    c50 = barron_c50(r, rt60[BAND_1K], V)
    refl = _reflections(xs, ys, poly, src, zs, zr, alpha)
    bass = _bass_spread(xs, ys, poly, src, zs, zr, height, rt60[BAND_125])

    clear = _edge_distance(xs, ys, poly)
    cand = (
        inside
        & (clear >= WALL_CLEARANCE_M - 1e-9)
        & (np.hypot(xs - src[0], ys - src[1]) >= SOURCE_CLEARANCE_M)
    )
    if not cand.any():
        cand = inside & (clear >= clear[inside].max() - 1e-9)

    def z(a):
        v = a[cand]
        sd = v.std()
        return (a - v.mean()) / (sd if sd > 1e-9 else 1.0)

    score = np.where(cand, z(bass) + z(refl) - z(c50), np.inf)
    j, i = np.unravel_index(int(np.argmin(score)), score.shape)
    best = (round(float(xs[j, i]), 3), round(float(ys[j, i]), 3))

    rng = lambda a: (round(float(a[inside].min()), 2), round(float(a[inside].max()), 2))
    return RoomField(
        origin=(float(xs[0, 0]), float(ys[0, 0])),
        step=step,
        nx=xs.shape[1],
        ny=xs.shape[0],
        c50_db=_round(c50, inside),
        reflection_db=_round(refl, inside),
        bass_spread_db=_round(bass, inside),
        source=(round(src[0], 3), round(src[1], 3)),
        source_height_m=zs,
        listener_height_m=zr,
        best_spot=best,
        ranges={"c50_db": rng(c50), "reflection_db": rng(refl), "bass_spread_db": rng(bass)},
        notes=[
            "Modeled maps at ear height from the room outline, RT60 (materials and furniture) "
            "and a single sound source; not measured.",
            "Clarity C50 at 1 kHz from Barron's revised theory; early wall reflections (within "
            "~5 ms of the direct sound) from first-order image sources in the real walls.",
            "Bass unevenness: modal model of a rigid box aligned with the longest wall and sized "
            "to the outline's extent (30-200 Hz). Irregular shapes and leaky walls differ.",
            "Best spot balances smooth bass, weak early reflections and high clarity, at least "
            f"{WALL_CLEARANCE_M:g} m from walls and {SOURCE_CLEARANCE_M:g} m from the source.",
        ],
    )
