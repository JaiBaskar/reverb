"""How much acoustic treatment would bring a room's mid-band RT60 into a target range.

Deterministic Sabine arithmetic: added absorption = 0.161 V (1/T_target - 1/T_now).
Panels are assumed broadband absorbers; they replace the surface they cover, so each m2
adds (PANEL_ALPHA - mean surface absorption). Mid frequencies only: bass needs bass traps.
"""

import math
from typing import Literal

from pydantic import BaseModel

from acoustics.physics import SABINE_CONSTANT
from acoustics.report import AcousticReport
from suitability import metrics

PANEL_ALPHA = 0.9  # typical 100 mm mineral-wool panel at 500 Hz-1 kHz (assumed)
PANEL_AREA_M2 = 0.72  # 0.6 x 1.2 m panel
MAX_PRACTICAL_COVERAGE = 0.4  # beyond 40% of all surfaces the room is effectively rebuilt

Verdict = Literal["none_needed", "add_absorption", "too_dead", "impractical"]


class Treatment(BaseModel):
    verdict: Verdict
    target_s: tuple[float | None, float | None]
    current_mid_s: float
    added_sabins: float
    panel_area_m2: float
    panels: int
    coverage: float  # share of all room surfaces the panels would cover
    reason: str
    assumptions: list[str]


def treatment(rep: AcousticReport, target: tuple[float | None, float | None]) -> Treatment:
    lo, hi = target
    t_now = metrics.mid_rt60(rep.rt60_s, rep.bands_hz)
    v = rep.geometry.volume_m3
    s_total = rep.surfaces.floor_m2 + rep.surfaces.ceiling_m2 + rep.surfaces.walls_m2
    a_now = SABINE_CONSTANT * v / t_now
    assumptions = [
        f"Panels absorb {PANEL_ALPHA:g} at 500 Hz-1 kHz and are {PANEL_AREA_M2:g} m2 each "
        "(0.6 x 1.2 m); typical values, not a specific product.",
        "Panels mainly control mid and high frequencies; low-frequency decay needs bass traps.",
    ]
    base = {"target_s": target, "current_mid_s": t_now, "assumptions": assumptions}

    if lo is not None and t_now < lo:
        return Treatment(
            verdict="too_dead", added_sabins=0, panel_area_m2=0, panels=0, coverage=0,
            reason=f"Mid RT60 {t_now:.2f} s is below {lo:.2f} s: the room is too dead; it "
            "would need reflective surfaces, not absorption.",
            **base,
        )  # fmt: skip
    if hi is None or t_now <= hi:
        return Treatment(
            verdict="none_needed", added_sabins=0, panel_area_m2=0, panels=0, coverage=0,
            reason=f"Mid RT60 {t_now:.2f} s is already within the target.",
            **base,
        )  # fmt: skip

    added = SABINE_CONSTANT * v / hi - a_now
    gain = PANEL_ALPHA - a_now / s_total
    area = added / gain
    panels = math.ceil(area / PANEL_AREA_M2)
    coverage = area / s_total
    practical = coverage <= MAX_PRACTICAL_COVERAGE
    reason = (
        f"To bring mid RT60 from {t_now:.2f} s to {hi:.2f} s, add about {added:.1f} m2 of "
        f"absorption: roughly {area:.1f} m2 of panels ({panels} panels), covering "
        f"{coverage:.0%} of the room's surfaces."
    )
    if not practical:
        reason += " That is more than is practical without rebuilding the room."
    return Treatment(
        verdict="add_absorption" if practical else "impractical",
        added_sabins=added,
        panel_area_m2=area,
        panels=panels,
        coverage=coverage,
        reason=reason,
        **base,
    )
