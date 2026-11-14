"""Use-case thresholds. Edit here; every number is a rule of thumb for modeled rooms, not a standard.

Ranges are (low, high) in the metric's unit; None means unbounded. A value inside `good`
passes, inside `workable` is a caution, outside both fails. Bounds are inclusive.
"""

Range = tuple[float | None, float | None]

USE_CASES: dict[str, dict] = {
    "vocal": {
        "label": "Vocal recording",
        "rt60": {"good": (None, 0.40), "workable": (None, 0.60)},
        "volume_m3": {"good": (15, None), "workable": (8, None)},
        "height_m": {"good": (2.2, None), "workable": (2.0, None)},
    },
    "instrument": {
        "label": "Instrument tracking",
        "rt60": {"good": (0.30, 0.60), "workable": (0.20, 0.80)},
        "volume_m3": {"good": (40, None), "workable": (25, None)},
    },
    "production": {
        "label": "Production / writing",
        "rt60": {"good": (None, 0.50), "workable": (None, 0.70)},
        "volume_m3": {"good": (20, None), "workable": (12, None)},
    },
    "mixing": {
        "label": "Mixing",
        "rt60": {"good": (0.20, 0.40), "workable": (0.15, 0.50)},
        "mode_gap_hz": {"good": (None, 25), "workable": (None, 40)},
        "bass_ratio": {"good": (None, 1.5), "workable": (None, 2.0)},
        "coincident_modes": True,
    },
    "critical_listening": {
        "label": "Critical listening",
        # Deviation from the ITU-R BS.1116 reference RT60 for the room's volume, in seconds.
        "rt60_vs_bs1116": {"good": (None, 0.10), "workable": (None, 0.20)},
        "floor_area_m2": {"good": (20, 60), "workable": (15, 80)},
        "mode_gap_hz": {"good": (None, 25), "workable": (None, 40)},
        "bass_ratio": {"good": (None, 1.5), "workable": (None, 2.0)},
        "coincident_modes": True,
    },
    "podcasting": {
        "label": "Podcasting / voice-over",
        "rt60": {"good": (None, 0.30), "workable": (None, 0.50)},
    },
}

MODE_FMAX_HZ = 200
COINCIDENT_TOLERANCE = 0.05
