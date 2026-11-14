"""Noise-source categories: OSM tag rules, search radii and relative exposure thresholds.

Thresholds are distances to the nearest source in metres. They give a relative,
qualitative exposure level only; they are not decibels and not measurements.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Selector:
    key: str
    pattern: str  # Overpass/Python regex, anchored with ^...$
    elements: tuple[str, ...] = ("node", "way", "relation")


@dataclass(frozen=True)
class Category:
    name: str
    label: str
    radius_m: int
    high_within_m: int
    moderate_within_m: int
    selectors: tuple[Selector, ...]


ROAD_MAJOR = "^(motorway|trunk|primary)(_link)?$"
ROAD_MINOR = "^(secondary|tertiary)(_link)?$"

# Order matters: an element is assigned to the first category it matches.
CATEGORIES: tuple[Category, ...] = (
    Category(
        "airport",
        "Airports and airfields",
        5000,
        2000,
        4000,
        (Selector("aeroway", "^aerodrome$"),),
    ),
    Category(
        "heliport",
        "Heliports and helipads",
        1000,
        200,
        500,
        (Selector("aeroway", "^(helipad|heliport)$"),),
    ),
    Category(
        "rail",
        "Rail and transit lines",
        500,
        150,
        300,
        (Selector("railway", "^(rail|light_rail|subway|tram)$", ("way",)),),
    ),
    Category(
        "road_major",
        "Major roads (motorway, trunk, primary)",
        500,
        100,
        250,
        (Selector("highway", ROAD_MAJOR, ("way",)),),
    ),
    Category(
        "road_minor",
        "Secondary and tertiary roads",
        200,
        30,
        100,
        (Selector("highway", ROAD_MINOR, ("way",)),),
    ),
    Category(
        "construction",
        "Construction sites",
        300,
        50,
        150,
        (
            Selector("landuse", "^construction$"),
            Selector("highway", "^construction$", ("way",)),
        ),
    ),
    Category(
        "venue",
        "Bars, clubs and venues",
        300,
        50,
        150,
        (
            Selector("amenity", "^(bar|pub|nightclub|music_venue|events_venue)$"),
            Selector("leisure", "^stadium$"),
        ),
    ),
    Category(
        "industrial",
        "Industrial land and works",
        500,
        100,
        250,
        (
            Selector("landuse", "^industrial$"),
            Selector("man_made", "^works$"),
        ),
    ),
    # Added for the unified map. Thresholds are relative rules of thumb, like those above.
    Category(
        "emergency",
        "Fire, ambulance and police stations (sirens)",
        1500,
        300,
        800,
        (Selector("amenity", "^(fire_station|hospital|police)$"),),
    ),
    Category(
        "transit",
        "Bus stops and rail or tram stations",
        500,
        50,
        150,
        (
            Selector("highway", "^bus_stop$", ("node",)),
            Selector("railway", "^(station|halt|tram_stop)$"),
        ),
    ),
    Category(
        "school",
        "Schools and colleges",
        400,
        100,
        250,
        (Selector("amenity", "^(school|kindergarten|college|university)$"),),
    ),
    Category(
        "worship",
        "Places of worship (bells, gatherings)",
        400,
        75,
        200,
        (Selector("amenity", "^place_of_worship$"),),
    ),
    Category(
        "food_drink",
        "Restaurants and cafes",
        200,
        30,
        80,
        (Selector("amenity", "^(restaurant|fast_food|cafe|food_court)$"),),
    ),
    Category(
        "sports",
        "Sports pitches and playgrounds",
        400,
        75,
        200,
        (Selector("leisure", "^(pitch|sports_centre|playground)$"),),
    ),
    Category(
        "fuel",
        "Fuel stations",
        300,
        50,
        150,
        (Selector("amenity", "^fuel$"),),
    ),
    Category(
        "commercial",
        "Commercial and retail land",
        300,
        30,
        100,
        (Selector("landuse", "^(commercial|retail)$"),),
    ),
)

# Categories whose closed ways are areas (drawn as polygons); others are lines.
AREA_CATEGORIES = frozenset(
    {"airport", "industrial", "construction", "commercial", "school", "sports", "worship",
     "emergency", "venue", "fuel", "food_drink", "heliport", "transit"}
)  # fmt: skip

BY_NAME: dict[str, Category] = {c.name: c for c in CATEGORIES}
_EXTRA = {"emergency", "transit", "school", "worship", "food_drink", "sports", "fuel", "commercial"}
# Fetched separately as points so the original query stays light; see noise.service.
BASE_CATEGORIES = tuple(c for c in CATEGORIES if c.name not in _EXTRA)
EXTRA_CATEGORIES = tuple(c for c in CATEGORIES if c.name in _EXTRA)
MAX_RADIUS_M = max(c.radius_m for c in CATEGORIES)
