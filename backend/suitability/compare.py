"""Which of two rooms suits each use better, and why. Deterministic and explainable."""

from typing import Literal

from pydantic import BaseModel

from suitability.models import Fit, SuitabilityReport

RANK = {"good": 2, "workable": 1, "poor": 0}
PANEL_MARGIN = 2  # fewer than this many panels' difference is a tie


class UseCaseVerdict(BaseModel):
    use_case: str
    label: str
    better: Literal["A", "B"] | None
    reason: str


def _panels(f: Fit) -> int | None:
    t = f.treatment
    if t is None or t.verdict in ("too_dead", "impractical"):
        return None
    return t.panels


def _verdict(fa: Fit, fb: Fit) -> UseCaseVerdict:
    pa, pb = RANK[fa.potential_level], RANK[fb.potential_level]
    if pa != pb:
        win = "A" if pa > pb else "B"
        w, lo = (fa, fb) if win == "A" else (fb, fa)
        reason = (
            f"Room {win} has the better potential ({w.potential_level} vs {lo.potential_level}) "
            "once practical treatment is considered; its size, height or bass modes suit this use better."
        )
        return UseCaseVerdict(use_case=fa.use_case, label=fa.label, better=win, reason=reason)
    na, nb = _panels(fa), _panels(fb)
    if na is not None and nb is not None and abs(na - nb) >= PANEL_MARGIN:
        win = "A" if na < nb else "B"
        few, many = sorted((na, nb))
        reason = (
            f"Same potential ({fa.potential_level}); Room {win} needs about {few} panel(s) "
            f"vs {many} to reach the target reverberation."
        )
        return UseCaseVerdict(use_case=fa.use_case, label=fa.label, better=win, reason=reason)
    if (na is None) != (nb is None):
        win = "A" if na is not None else "B"
        return UseCaseVerdict(
            use_case=fa.use_case, label=fa.label, better=win,
            reason=f"Same potential; only Room {win} can reach the target with practical treatment.",
        )  # fmt: skip
    return UseCaseVerdict(
        use_case=fa.use_case,
        label=fa.label,
        better=None,
        reason=f"Too close to call: both are {fa.potential_level} with similar treatment needs.",
    )


def compare_fits(a: SuitabilityReport, b: SuitabilityReport) -> list[UseCaseVerdict]:
    by_b = {f.use_case: f for f in b.fits}
    return [_verdict(fa, by_b[fa.use_case]) for fa in a.fits if fa.use_case in by_b]
