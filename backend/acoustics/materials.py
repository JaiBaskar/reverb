"""Typical octave-band absorption coefficients (125 Hz-4 kHz) for common finishes.

These are generic textbook-style values, not measurements of any real property. The report
marks every material choice as an assumption.
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
}

DEFAULT_SELECTION = {"floor": "hardwood", "walls": "painted_drywall", "ceiling": "painted_drywall"}
