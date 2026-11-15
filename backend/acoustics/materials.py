"""Typical octave-band absorption coefficients (125 Hz-4 kHz) for common finishes.

These are generic textbook-style values, not measurements of any real property. The report
marks every material choice as an assumption. The added finishes use typical published
coefficients (Everest & Pohlmann, Master Handbook of Acoustics, absorption tables), rounded.
This table is the only source of coefficients: the vision agent may only pick an id from it.
"""

MATERIALS: dict[str, dict] = {
    "painted_drywall": {
        "label": "Painted drywall / plaster",
        "alpha": [0.29, 0.10, 0.05, 0.04, 0.07, 0.09],
    },
    "painted_concrete": {
        "label": "Painted concrete / brick",
        "alpha": [0.10, 0.05, 0.06, 0.07, 0.09, 0.08],
    },
    "hardwood": {
        "label": "Hardwood floor",
        "alpha": [0.15, 0.11, 0.10, 0.07, 0.06, 0.07],
    },
    "carpet": {
        "label": "Heavy carpet on concrete",
        "alpha": [0.02, 0.06, 0.14, 0.37, 0.60, 0.65],
    },
    "tile": {
        "label": "Tile / polished concrete",
        "alpha": [0.01, 0.01, 0.015, 0.02, 0.02, 0.02],
    },
    "glass": {
        "label": "Glass / large windows",
        "alpha": [0.35, 0.25, 0.18, 0.12, 0.07, 0.04],
    },
    "carpet_underlay": {
        "label": "Carpet on foam underlay",
        "alpha": [0.08, 0.24, 0.57, 0.69, 0.71, 0.73],
    },
    "vinyl": {
        "label": "Vinyl / linoleum on concrete",
        "alpha": [0.02, 0.03, 0.03, 0.03, 0.03, 0.02],
    },
    "wood_panel": {
        "label": "Wood panelling over an air space",
        "alpha": [0.28, 0.22, 0.17, 0.09, 0.10, 0.11],
    },
    "plaster_on_masonry": {
        "label": "Plaster on brick or block",
        "alpha": [0.01, 0.02, 0.02, 0.03, 0.04, 0.05],
    },
    "concrete_block": {
        "label": "Unpainted concrete block",
        "alpha": [0.36, 0.44, 0.31, 0.29, 0.39, 0.25],
    },
    "acoustic_ceiling_tile": {
        "label": "Suspended mineral-fibre ceiling tile",
        "alpha": [0.70, 0.66, 0.72, 0.92, 0.88, 0.75],
    },
    "door_wood": {
        "label": "Wooden door (closed)",
        "alpha": [0.14, 0.10, 0.06, 0.08, 0.10, 0.10],
    },
    "brick": {
        "label": "Exposed brick",
        "alpha": [0.03, 0.03, 0.03, 0.04, 0.05, 0.07],
    },
    "mirror": {
        "label": "Mirror / glass panel on a wall",
        "alpha": [0.10, 0.06, 0.04, 0.03, 0.02, 0.02],
    },
}

# An open doorway or open-plan connection: sound that leaves the room does not come back.
OPEN_ALPHA = [1.0] * 6

# Which finishes make sense on which surface (the vision agent's vocabulary per surface).
SURFACE_MATERIALS: dict[str, list[str]] = {
    "floor": ["hardwood", "carpet", "carpet_underlay", "tile", "vinyl", "painted_concrete"],
    "walls": ["painted_drywall", "painted_concrete", "plaster_on_masonry", "concrete_block",
              "brick", "wood_panel", "glass"],
    "ceiling": ["painted_drywall", "painted_concrete", "wood_panel", "acoustic_ceiling_tile"],
}  # fmt: skip

DEFAULT_SELECTION = {"floor": "hardwood", "walls": "painted_drywall", "ceiling": "painted_drywall"}
