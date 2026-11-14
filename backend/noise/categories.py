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
)

BY_NAME: dict[str, Category] = {c.name: c for c in CATEGORIES}
MAX_RADIUS_M = max(c.radius_m for c in CATEGORIES)
