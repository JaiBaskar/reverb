"""Spherical-earth helpers: distance, bearing, compass, nearest point on a polyline."""

import itertools
import math

EARTH_RADIUS_M = 6_371_008.8
COMPASS_16 = (
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
)  # fmt: skip


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, 0-360 clockwise from north."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(x, y)) % 360


def compass(deg: float) -> str:
    return COMPASS_16[int((deg % 360) / 22.5 + 0.5) % 16]


def nearest_point(
    lat: float, lon: float, line: list[tuple[float, float]]
) -> tuple[float, float]:
    """Closest point to (lat, lon) on a polyline, using a local flat projection.

    Accurate to well under a metre at the few-km scales we query.
    """
    if len(line) == 1:
        return line[0]
    kx = math.cos(math.radians(lat))
    best, best_d2 = line[0], math.inf
    for (alat, alon), (blat, blon) in itertools.pairwise(line):
        ax, ay = (alon - lon) * kx, alat - lat
        bx, by = (blon - lon) * kx, blat - lat
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
        px, py = ax + t * dx, ay + t * dy
        d2 = px * px + py * py
        if d2 < best_d2:
            best_d2 = d2
            best = (lat + py, lon + px / kx)
    return best
