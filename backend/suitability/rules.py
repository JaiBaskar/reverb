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
    # Acoustic guitar picked up by a mic 30-60 cm away hears a lot of the room. Rules of thumb:
    # - some decay but not a wash: same RT60 window as instrument tracking;
    # - enough air that the body resonances are not boxed in (>= 30 m3 good, >= 15 workable);
    # - highs that last about as long as the mids (4 kHz / mid RT60 >= 0.7) so the strings keep
    #   their sparkle; below 0.5 the room sounds dull;
    # - looser bass-mode spacing than mixing (guitar's lowest note is 82 Hz);
    # - the first wall/ceiling reflection >= 3 ms after the direct sound (about 1 m extra path):
    #   earlier ones comb-filter the guitar's presence region rather than sounding like room.
    "acoustic_guitar": {
        "label": "Acoustic guitar recording",
        "rt60": {"good": (0.30, 0.60), "workable": (0.20, 0.80)},
        "volume_m3": {"good": (30, None), "workable": (15, None)},
        "hf_ratio": {"good": (0.70, None), "workable": (0.50, None)},
        "mode_gap_hz": {"good": (None, 30), "workable": (None, 45)},
        "reflection_gap_ms": {"good": (3.0, None), "workable": (1.5, None)},
    },
    # Electric guitar through an amp, close-miked: the mic hears mostly the speaker, so a short
    # RT60 and a small room are fine. The risk is the cabinet's strong 80-250 Hz output exciting
    # room modes, so bass-mode spacing, coincident modes and bass decay are checked like mixing.
    "electric_guitar": {
        "label": "Electric guitar amp recording",
        "rt60": {"good": (None, 0.60), "workable": (None, 0.90)},
        "volume_m3": {"good": (12, None), "workable": (8, None)},
        "mode_gap_hz": {"good": (None, 25), "workable": (None, 40)},
        "bass_ratio": {"good": (None, 1.5), "workable": (None, 2.0)},
        "coincident_modes": True,
    },
}

MODE_FMAX_HZ = 200
COINCIDENT_TOLERANCE = 0.05
