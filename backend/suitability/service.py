"""Rule-based studio suitability from an AcousticReport. Qualitative; no dB, no score."""

from acoustics.report import AcousticReport
from suitability import metrics
from suitability.models import Check, CheckStatus, Fit, FitLevel, SuitabilityReport
from suitability.rules import COINCIDENT_TOLERANCE, MODE_FMAX_HZ, USE_CASES, Range


def _inside(v: float, r: Range) -> bool:
    lo, hi = r
    return (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)


def _fmt_range(r: Range, unit: str) -> str:
    lo, hi = r
    if lo is None:
        return f"<= {hi:g}{unit}"
    if hi is None:
        return f">= {lo:g}{unit}"
    return f"{lo:g}-{hi:g}{unit}"


def _grade(value: float, bands: dict) -> tuple[CheckStatus, str]:
    if _inside(value, bands["good"]):
        return "pass", "good"
    if _inside(value, bands["workable"]):
        return "caution", "workable"
    return "fail", "workable"


TREATABLE = {"rt60", "bass_ratio"}


def _range_check(cid: str, label: str, value: float, bands: dict, unit: str, what: str) -> Check:
    status, ref = _grade(value, bands)
    target = bands["good"] if status == "pass" else bands[ref]
    verb = {"pass": "within", "caution": "outside the ideal", "fail": "outside the workable"}
    reason = f"{what} {value:.2f}{unit}, {verb[status]} range ({_fmt_range(target, unit)})."
    return Check(id=cid, label=label, status=status, reason=reason, treatable=cid in TREATABLE)


def _checks(rep: AcousticReport, rules: dict) -> list[Check]:
    bands, rt = rep.bands_hz, rep.rt60_s
    mid = metrics.mid_rt60(rt, bands)
    vol = rep.geometry.volume_m3
    out: list[Check] = []
    if "rt60" in rules:
        out.append(
            _range_check(
                "rt60", "Reverberation", mid, rules["rt60"], " s", "Mid RT60 (500 Hz-1 kHz)"
            )
        )
    if "rt60_vs_bs1116" in rules:
        target = metrics.bs1116_target(vol)
        dev = abs(mid - target)
        status, _ = _grade(dev, rules["rt60_vs_bs1116"])
        out.append(
            Check(
                id="rt60",
                label="Reverberation",
                status=status,
                treatable=True,
                reason=(
                    f"Mid RT60 {mid:.2f} s vs ITU-R BS.1116 reference {target:.2f} s for "
                    f"{vol:.0f} m3: off by {dev:.2f} s "
                    f"(ideal {_fmt_range(rules['rt60_vs_bs1116']['good'], ' s')})."
                ),
            )
        )
    if "volume_m3" in rules:
        out.append(_range_check("volume", "Room volume", vol, rules["volume_m3"], " m3", "Volume"))
    if "height_m" in rules and rep.geometry.height_m.value is not None:
        out.append(
            _range_check(
                "height", "Ceiling height", rep.geometry.height_m.value, rules["height_m"], " m",
                "Ceiling",
            )
        )  # fmt: skip
    if "floor_area_m2" in rules and rep.geometry.area_m2.value is not None:
        out.append(
            _range_check(
                "floor_area", "Floor area", rep.geometry.area_m2.value, rules["floor_area_m2"],
                " m2", "Floor area",
            )
        )  # fmt: skip
    if "mode_gap_hz" in rules or rules.get("coincident_modes"):
        spread = metrics.mode_spread(rep.modes, MODE_FMAX_HZ, COINCIDENT_TOLERANCE)
        if "mode_gap_hz" in rules and spread.max_gap_hz is not None:
            status, _ref = _grade(spread.max_gap_hz, rules["mode_gap_hz"])
            lo, hi = spread.max_gap_between or (0, 0)
            out.append(
                Check(
                    id="mode_gap",
                    label="Bass mode spacing",
                    status=status,
                    treatable=False,
                    reason=(
                        f"Largest gap between axial modes below {MODE_FMAX_HZ} Hz is "
                        f"{spread.max_gap_hz:.0f} Hz ({lo:.0f}-{hi:.0f} Hz); "
                        f"ideal {_fmt_range(rules['mode_gap_hz']['good'], ' Hz')}. "
                        "Big gaps mean uneven bass from note to note."
                    ),
                )
            )
        if rules.get("coincident_modes"):
            n = len(spread.coincident)
            freqs = sorted({round(f) for f, _ in spread.coincident})
            out.append(
                Check(
                    id="coincident_modes",
                    label="Coincident modes",
                    status="pass" if n == 0 else "caution",
                    treatable=False,
                    reason=(
                        "No axial modes on different axes within "
                        f"{COINCIDENT_TOLERANCE:.0%} of each other below {MODE_FMAX_HZ} Hz."
                        if n == 0
                        else f"{n} pair(s) of axial modes nearly coincide near "
                        f"{', '.join(f'{f} Hz' for f in freqs)}, which can boom on those notes."
                    ),
                )
            )
    if "hf_ratio" in rules:
        hr = metrics.hf_ratio(rt, bands)
        status, _ = _grade(hr, rules["hf_ratio"])
        out.append(
            Check(
                id="hf_ratio",
                label="High-frequency decay",
                status=status,
                treatable=True,
                reason=(
                    f"RT60 at 4 kHz is {hr:.2f}x the mid RT60 "
                    f"(ideal {_fmt_range(rules['hf_ratio']['good'], 'x')}); lower means the "
                    "room swallows string brightness. Sabine here ignores air absorption."
                ),
            )
        )
    if "reflection_gap_ms" in rules:
        gap = metrics.reflection_gap_ms(rep.early_reflections)
        if gap is not None:
            status, _ = _grade(gap, rules["reflection_gap_ms"])
            out.append(
                Check(
                    id="reflection_gap",
                    label="Early reflections",
                    status=status,
                    treatable=False,
                    reason=(
                        f"First wall or ceiling reflection arrives {gap:.1f} ms after the "
                        f"direct sound (ideal {_fmt_range(rules['reflection_gap_ms']['good'], ' ms')}"
                        "); earlier ones comb-filter the tone. Default source and mic "
                        "positions; the floor bounce is excluded."
                    ),
                )
            )
    if "bass_ratio" in rules:
        br = metrics.bass_ratio(rt, bands)
        status, _ = _grade(br, rules["bass_ratio"])
        out.append(
            Check(
                id="bass_ratio",
                label="Bass decay",
                status=status,
                treatable=True,
                reason=(
                    f"RT60 at 125 Hz is {br:.2f}x the mid RT60 "
                    f"(ideal {_fmt_range(rules['bass_ratio']['good'], 'x')}); below the "
                    "Schroeder frequency this is only indicative."
                ),
            )
        )
    return out


def _level(checks: list[Check]) -> FitLevel:
    statuses = {c.status for c in checks}
    return "poor" if "fail" in statuses else "workable" if "caution" in statuses else "good"


def _assumptions(rep: AcousticReport) -> list[str]:
    mats = ", ".join(f"{m.surface}: {m.label}" for m in rep.materials)
    out = [
        f"Surface materials are assumed presets ({mats}); results change with real finishes.",
        "Room is assumed empty; furniture, rugs and treatment would lower RT60.",
        "Rooms are treated as an equivalent rectangular box.",
    ]
    g = rep.geometry
    for name, f in (("width", g.width_m), ("depth", g.depth_m), ("height", g.height_m),
                    ("area", g.area_m2)):  # fmt: skip
        if f.provenance in ("estimated", "assumed"):
            out.append(f"Room {name} is {f.provenance}" + (f": {f.note}." if f.note else "."))
    return out


MISSING = [
    "Outside noise and sound isolation are not assessed here; see the nearby noise sources panel.",
    "HVAC, plumbing and neighbour noise are unknown.",
    "Door, window and opening positions are unknown.",
]


def assess(rep: AcousticReport) -> SuitabilityReport:
    fits = []
    for key, rules in USE_CASES.items():
        checks = _checks(rep, rules)
        fixed = [c for c in checks if not c.treatable]
        fits.append(
            Fit(
                use_case=key,
                label=rules["label"],
                level=_level(checks),
                shape_level=_level(fixed) if fixed else None,
                checks=checks,
            )
        )
    return SuitabilityReport(
        sid=rep.sid,
        room_id=rep.room_id,
        label=rep.label,
        fits=fits,
        assumptions=_assumptions(rep),
        missing=MISSING,
        method=(
            "Rule-based fit from the modeled acoustic report: each use case checks mid RT60, "
            "size and bass-mode spacing against editable thresholds. Qualitative, not a "
            "measurement or a score."
        ),
    )
