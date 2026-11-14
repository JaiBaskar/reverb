"""Furniture as absorption: typical octave-band sabins (m2) per item, 125 Hz-4 kHz.

Matterport's object detection (`objectAnnotations`) is empty for the kit's scans, so a
room's furnishing is either a default for its room type (provenance "assumed") or what the
user enters ("user"). Values are typical figures for each kind of object (upholstered pieces
and soft furnishings absorb mostly mid/high frequencies; hard pieces very little), not
measurements of the objects in any scan.
"""

from typing import Literal

from pydantic import BaseModel

FURNITURE: dict[str, dict] = {
    "sofa": {"label": "Upholstered sofa (3-seat)", "sabins": [0.60, 1.10, 1.70, 2.00, 2.10, 2.10]},
    "armchair": {"label": "Upholstered armchair", "sabins": [0.20, 0.40, 0.60, 0.70, 0.70, 0.70]},
    "bed": {
        "label": "Bed with mattress and bedding",
        "sabins": [0.50, 1.00, 1.60, 1.90, 2.00, 2.00],
    },
    "rug": {
        "label": "Area rug (~4 m2) on a hard floor",
        "sabins": [0.08, 0.24, 0.56, 1.48, 2.40, 2.60],
    },
    "curtains": {
        "label": "Heavy curtains (~4 m2), drawn",
        "sabins": [0.56, 1.40, 2.20, 2.88, 2.80, 2.60],
    },
    "bookshelf": {"label": "Filled bookshelf", "sabins": [0.30, 0.40, 0.40, 0.40, 0.40, 0.40]},
    "wardrobe": {
        "label": "Wardrobe / closed cabinet",
        "sabins": [0.10, 0.10, 0.10, 0.10, 0.10, 0.10],
    },
    "table": {"label": "Table (hard)", "sabins": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05]},
    "chair": {"label": "Hard chair", "sabins": [0.02, 0.02, 0.03, 0.04, 0.05, 0.05]},
    "desk": {"label": "Desk (hard)", "sabins": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05]},
    "cabinets": {"label": "Kitchen cabinets", "sabins": [0.10, 0.10, 0.10, 0.10, 0.10, 0.10]},
    "acoustic_panel": {
        "label": "Acoustic panel 100 mm (0.72 m2)",
        "sabins": [0.18, 0.47, 0.65, 0.68, 0.68, 0.68],
    },
}

# Matched against the lowercased Matterport room label; first match wins.
DEFAULTS_BY_ROOM: list[tuple[str, list[tuple[str, int]]]] = [
    (
        "living",
        [("sofa", 1), ("armchair", 1), ("rug", 1), ("curtains", 1), ("bookshelf", 1), ("table", 1)],
    ),
    ("family", [("sofa", 1), ("armchair", 1), ("rug", 1), ("curtains", 1), ("table", 1)]),
    ("bedroom", [("bed", 1), ("wardrobe", 1), ("curtains", 1)]),
    ("dining", [("table", 1), ("chair", 4)]),
    ("kitchen", [("cabinets", 1), ("table", 1)]),
    ("office", [("desk", 1), ("chair", 1), ("bookshelf", 1)]),
    ("den", [("sofa", 1), ("rug", 1), ("bookshelf", 1)]),
]


class UnknownFurniture(ValueError):
    pass


class FurnitureItem(BaseModel):
    id: str
    count: int = 1
    provenance: Literal["assumed", "user"] = "user"


def default_furnishing(label: str) -> list[FurnitureItem]:
    """Typical furnishing for a room type; empty for hallways, bathrooms and unknown rooms."""
    low = label.lower()
    for key, items in DEFAULTS_BY_ROOM:
        if key in low:
            return [FurnitureItem(id=i, count=n, provenance="assumed") for i, n in items]
    return []


def furniture_absorption(items: list[FurnitureItem]) -> list[float]:
    total = [0.0] * 6
    for it in items:
        if it.id not in FURNITURE:
            raise UnknownFurniture(f"unknown furniture '{it.id}'")
        for b, s in enumerate(FURNITURE[it.id]["sabins"]):
            total[b] += s * max(it.count, 0)
    return total
