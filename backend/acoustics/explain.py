"""Deterministic, template-based explanation of why two modeled rooms differ.

Every number is computed from the two AcousticReports; no language model is involved.
"""

import math

from pydantic import BaseModel

from acoustics.physics import SABINE_CONSTANT
from acoustics.report import AcousticReport

SIMILAR_RATIO = 1.15  # mid-band RT60 within 15% is described as similar


class MaterialDifference(BaseModel):
    surface: str
    a: str
    b: str


class Comparison(BaseModel):
    mid_rt60_s: list[float]
    livelier: str | None  # "A", "B", or None when similar
    rt60_ratio: float  # longer / shorter
    volume_factor: float  # V_a / V_b
    absorption_factor: float  # A_eff_b / A_eff_a, so volume_factor * absorption_factor = T_a / T_b
    material_differences: list[MaterialDifference]
    schroeder_hz: list[float]
    lowest_mode_hz: list[float | None]
    first_reflection_ms: list[float]
    bass_ratio: list[float]
    statements: list[str]


def _mid_rt60(r: AcousticReport) -> float:
    return (r.rt60_s[2] + r.rt60_s[3]) / 2  # 500 Hz and 1 kHz


def _bass_ratio(r: AcousticReport) -> float:
    return (r.rt60_s[0] + r.rt60_s[1]) / (r.rt60_s[2] + r.rt60_s[3])


def compare(a: AcousticReport, b: AcousticReport) -> Comparison:
    ta, tb = _mid_rt60(a), _mid_rt60(b)
    va, vb = a.geometry.volume_m3, b.geometry.volume_m3
    # Effective mid-band absorption (sabins) implied by each RT60: A = 0.161 V / T
    ea, eb = SABINE_CONSTANT * va / ta, SABINE_CONSTANT * vb / tb
    vol_factor = va / vb
    abs_factor = eb / ea

    ratio = max(ta, tb) / min(ta, tb)
    livelier = None if ratio < SIMILAR_RATIO else ("A" if ta > tb else "B")

    mats_a = {m.surface: m.id for m in a.materials}
    mats_b = {m.surface: m.id for m in b.materials}
    labels = {m.id: m.label for r in (a, b) for m in r.materials}
    diffs = [
        MaterialDifference(surface=s, a=mats_a[s], b=mats_b[s])
        for s in ("floor", "walls", "ceiling")
        if mats_a[s] != mats_b[s]
    ]
    lowest = [r.modes[0].freq_hz if r.modes else None for r in (a, b)]
    first_refl = [min(e.delay_ms for e in r.early_reflections) for r in (a, b)]
    bass = [_bass_ratio(a), _bass_ratio(b)]

    s: list[str] = []
    if livelier is None:
        s.append(
            f"Mid-band reverberation is similar: RT60 at 500 Hz-1 kHz is {ta:.2f} s in Room A "
            f"and {tb:.2f} s in Room B."
        )
    else:
        lo, hi = ("B", "A") if livelier == "A" else ("A", "B")
        t_hi, t_lo = (ta, tb) if livelier == "A" else (tb, ta)
        v_hi, v_lo = (va, vb) if livelier == "A" else (vb, va)
        e_hi, e_lo = (ea, eb) if livelier == "A" else (eb, ea)
        s.append(
            f"Room {hi} is more reverberant: mid-band (500 Hz-1 kHz) RT60 is {t_hi:.2f} s vs "
            f"{t_lo:.2f} s in Room {lo}, {ratio:.1f}x longer."
        )
        s.append(
            f"Volume: Room {hi} holds {v_hi / v_lo:.2f}x the air of Room {lo} "
            f"({v_hi:.1f} vs {v_lo:.1f} m3), which on its own scales RT60 by "
            f"{v_hi / v_lo:.2f}x. Absorption: Room {hi} absorbs {e_hi / e_lo:.2f}x as much as "
            f"Room {lo} at mid frequencies ({e_hi:.1f} vs {e_lo:.1f} sabins), scaling RT60 by "
            f"{e_lo / e_hi:.2f}x. Together: {v_hi / v_lo * e_lo / e_hi:.2f}x."
        )
    if diffs:
        s.append(
            "Assumed materials differ: "
            + "; ".join(
                f"{d.surface}: {labels[d.a].lower()} in A, {labels[d.b].lower()} in B"
                for d in diffs
            )
            + "."
        )
    else:
        s.append(
            "Both rooms use the same material assumptions, so the difference is geometry only."
        )

    fs_a, fs_b = a.schroeder_hz, b.schroeder_hz
    low_txt = ", ".join(
        f"{f:.1f} Hz in {n}" if f is not None else f"none below 300 Hz in {n}"
        for f, n in zip(lowest, "AB", strict=True)
    )
    s.append(
        f"Low end: the Schroeder frequency is {fs_a:.0f} Hz in A and {fs_b:.0f} Hz in B; below "
        f"it, individual room modes dominate. Lowest axial mode: {low_txt}."
    )
    s.append(
        f"Early reflections: the first one arrives {first_refl[0]:.1f} ms after the direct "
        f"sound in A and {first_refl[1]:.1f} ms in B; nearer boundaries return reflections "
        "sooner, which colours the sound (comb filtering)."
    )
    if all(math.isfinite(x) for x in bass):
        s.append(
            f"Bass balance (RT60 at 125-250 Hz relative to 500 Hz-1 kHz): {bass[0]:.2f} in A, "
            f"{bass[1]:.2f} in B; above 1 means the low end rings longer than the mids."
        )
    s.append("All values are modeled from room geometry and assumed materials, not measured.")

    return Comparison(
        mid_rt60_s=[ta, tb],
        livelier=livelier,
        rt60_ratio=ratio,
        volume_factor=vol_factor,
        absorption_factor=abs_factor,
        material_differences=diffs,
        schroeder_hz=[fs_a, fs_b],
        lowest_mode_hz=lowest,
        first_reflection_ms=first_refl,
        bass_ratio=bass,
        statements=s,
    )
