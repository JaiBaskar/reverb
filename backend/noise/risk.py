"""Which mapped neighbours are most likely to disturb a recording, ranked. Not sound levels.

risk = intensity(category) x proximity(distance). Intensity is an assumed relative ranking of
how loud and intrusive a kind of source typically is (an airport or rail line above a cafe);
proximity uses each category's existing distance thresholds (1 within `high_within_m`, 0.5
at `moderate_within_m`, 0.15 at the search radius). Heat points are sampled along each
source's real OSM geometry, weighted by intensity, so roads and rail lines show as bands.
"""

import itertools
import math
from typing import Literal

from pydantic import BaseModel

from noise.categories import BY_NAME, Category
from noise.models import NoiseSource

INTENSITY: dict[str, float] = {
    "airport": 1.0,
    "rail": 0.9,
    "road_major": 0.85,
    "heliport": 0.8,
    "venue": 0.75,
    "construction": 0.7,
    "emergency": 0.7,
    "industrial": 0.6,
    "road_minor": 0.45,
    "sports": 0.45,
    "transit": 0.4,
    "school": 0.4,
    "worship": 0.35,
    "food_drink": 0.35,
    "fuel": 0.25,
    "commercial": 0.25,
}

WHEN: dict[str, str] = {
    "airport": "Flight hours; check the airport's operating hours.",
    "rail": "Train timetable; freight can run at night.",
    "road_major": "All day, worst at rush hours.",
    "heliport": "Unscheduled; medical and police flights at any hour.",
    "venue": "Evenings and nights, especially weekends.",
    "construction": "Weekday working hours, for the length of the project.",
    "emergency": "Sirens at any hour, unpredictably.",
    "industrial": "Working hours; some sites run shifts.",
    "road_minor": "Daytime traffic.",
    "sports": "Evenings and weekends when games are on.",
    "transit": "Service hours: buses idling and braking, announcements.",
    "school": "School days: drop-off, breaks, pick-up.",
    "worship": "Services and bells, mostly weekends and holidays.",
    "food_drink": "Opening hours: deliveries, extraction fans, patrons.",
    "fuel": "Opening hours: engines, car washes.",
    "commercial": "Opening hours: deliveries and loading.",
}

Level = Literal["low", "moderate", "high"]
HIGH, MODERATE = 0.6, 0.35
EARTH_M_PER_DEG = 111_320.0


def proximity(cat: Category, distance_m: float) -> float:
    if distance_m <= cat.high_within_m:
        return 1.0
    if distance_m <= cat.moderate_within_m:
        f = (distance_m - cat.high_within_m) / (cat.moderate_within_m - cat.high_within_m)
        return 1.0 - 0.5 * f
    if distance_m <= cat.radius_m:
        f = (distance_m - cat.moderate_within_m) / (cat.radius_m - cat.moderate_within_m)
        return 0.5 - 0.35 * f
    return 0.15


class RankedSource(BaseModel):
    id: str
    name: str | None
    category: str
    subtype: str
    distance_m: float
    bearing_compass: str
    lat: float
    lon: float
    osm_url: str
    intensity: float
    proximity: float
    risk: float
    level: Level
    when: str
    why: str


class NoiseRisk(BaseModel):
    ranked: list[RankedSource]
    heat: dict  # GeoJSON FeatureCollection of points with properties.weight
    notes: list[str]


def _segment_points(a, b, spacing_m: float) -> list[list[float]]:
    lat0 = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * EARTH_M_PER_DEG * math.cos(lat0)
    dy = (b[1] - a[1]) * EARTH_M_PER_DEG
    n = max(1, math.ceil(math.hypot(dx, dy) / spacing_m))
    return [[a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] for k in range(n)]


def sample_geometry(geom: dict, spacing_m: float = 30.0) -> list[list[float]]:
    """Points every ~spacing_m along lines and polygon rings; points stay points."""
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Point":
        return [list(c)]
    if t == "LineString":
        lines = [c]
    elif t in ("MultiLineString", "Polygon"):
        lines = c
    elif t == "MultiPolygon":
        lines = [ring for poly in c for ring in poly]
    else:
        return []
    out = []
    for line in lines:
        for a, b in itertools.pairwise(line):
            out.extend(_segment_points(a, b, spacing_m))
        if line:
            out.append(list(line[-1]))
    return out


def assess_risk(sources: list[NoiseSource]) -> NoiseRisk:
    ranked, feats = [], []
    for s in sources:
        cat = BY_NAME.get(s.category)
        if cat is None:
            continue
        w = INTENSITY.get(s.category, 0.3)
        p = proximity(cat, s.distance_m)
        risk = round(w * p, 3)
        level: Level = "high" if risk >= HIGH else "moderate" if risk >= MODERATE else "low"
        ranked.append(
            RankedSource(
                id=s.id, name=s.name, category=s.category, subtype=s.subtype,
                distance_m=s.distance_m, bearing_compass=s.bearing_compass, lat=s.lat, lon=s.lon,
                osm_url=s.osm_url, intensity=w, proximity=round(p, 3), risk=risk, level=level,
                when=WHEN.get(s.category, ""),
                why=f"{cat.label}, {round(s.distance_m)} m {s.bearing_compass} ({s.subtype}).",
            )
        )  # fmt: skip
        pts = sample_geometry(s.geometry) if s.geometry else []
        for lon, lat in pts or [[s.lon, s.lat]]:
            feats.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {"weight": w, "category": s.category, "id": s.id},
                }
            )
    ranked.sort(key=lambda r: (-r.risk, r.distance_m))
    return NoiseRisk(
        ranked=ranked,
        heat={"type": "FeatureCollection", "features": feats},
        notes=[
            "Risk is a relative ranking (typical intrusiveness of each kind of source x how close "
            "it is), not a sound level or a measurement.",
            "Intensities per category are assumed rules of thumb; the map heat shows where the "
            "mapped sources are, weighted by that intensity.",
        ],
    )
