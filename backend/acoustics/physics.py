"""Deterministic room-acoustics equations. Pure functions, no I/O.

Equations: Sabine RT60 T = 0.161 V / A; Schroeder frequency fs = 2000 sqrt(T / V);
axial modes f = n c / (2 L); first-order reflections by the image-source method.
"""

import math

SPEED_OF_SOUND = 343.0  # m/s, ~20 C
SABINE_CONSTANT = 0.161
BANDS_HZ = [125, 250, 500, 1000, 2000, 4000]


def volume(area_m2: float, height_m: float) -> float:
    return area_m2 * height_m


def surface_areas(width: float, depth: float, height: float) -> dict[str, float]:
    return {
        "floor": width * depth,
        "ceiling": width * depth,
        "walls": 2 * (width + depth) * height,
    }


def total_absorption(surfaces: list[tuple[float, float]]) -> float:
    """Total absorption in sabins from (area_m2, alpha) pairs."""
    return sum(area * alpha for area, alpha in surfaces)


def sabine_rt60(volume_m3: float, absorption_sabins: float) -> float:
    if absorption_sabins <= 0:
        return math.inf
    return SABINE_CONSTANT * volume_m3 / absorption_sabins


def schroeder_frequency(rt60_s: float, volume_m3: float) -> float:
    return 2000.0 * math.sqrt(rt60_s / volume_m3)


def axial_modes(lengths: dict[str, float], fmax_hz: float) -> list[dict]:
    """Axial room modes per axis up to fmax, sorted by frequency."""
    modes = []
    for axis, length in lengths.items():
        n = 1
        while (f := n * SPEED_OF_SOUND / (2 * length)) <= fmax_hz:
            modes.append({"axis": axis, "order": n, "freq_hz": f})
            n += 1
    return sorted(modes, key=lambda m: m["freq_hz"])


def equivalent_box(area: float, width: float, depth: float) -> tuple[float, float]:
    """Rectangle with the room's true floor area and its bounding-box aspect ratio."""
    ratio = width / depth
    d = math.sqrt(area / ratio)
    return ratio * d, d


def first_order_reflections(
    box: tuple[float, float, float],
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
) -> list[dict]:
    """Delay of each first-order reflection relative to the direct sound (image sources)."""
    w, d, h = box
    sx, sy, sz = source
    direct = math.dist(source, listener)
    images = {
        "left wall": (-sx, sy, sz),
        "right wall": (2 * w - sx, sy, sz),
        "front wall": (sx, -sy, sz),
        "back wall": (sx, 2 * d - sy, sz),
        "floor": (sx, sy, -sz),
        "ceiling": (sx, sy, 2 * h - sz),
    }
    out = []
    for surface, img in images.items():
        path = math.dist(img, listener)
        out.append(
            {
                "surface": surface,
                "path_m": path,
                "delay_ms": (path - direct) / SPEED_OF_SOUND * 1000,
            }
        )
    return out


def bass_ratio(rt60: list[float], bands: list[int]) -> float:
    """Beranek bass ratio (RT125 + RT250) / (RT500 + RT1k); above 1 the low end rings longer."""
    t = dict(zip(bands, rt60, strict=True))
    return (t[125] + t[250]) / (t[500] + t[1000])


def polygon_area(poly: list[tuple[float, float]] | list[list[float]]) -> float:
    n = len(poly)
    return abs(sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(n))) / 2


def polygon_perimeter(poly: list[tuple[float, float]] | list[list[float]]) -> float:
    return sum(math.dist(poly[i - 1], poly[i]) for i in range(len(poly)))


def outline_wall_length(poly, true_area: float) -> float:
    """Perimeter of a room outline scaled to the room's true floor area (Matterport outlines
    are wall centrelines, so they enclose slightly more than the floor)."""
    a = polygon_area(poly)
    return polygon_perimeter(poly) * math.sqrt(true_area / a) if a > 0 else 0.0
