import json
from pathlib import Path

import pytest

from acoustics.report import AcousticReport

FIXTURE = (
    Path(__file__).parents[3]
    / "contract"
    / "fixtures"
    / "acoustic_report_zvKHR9DHNjJ_living_room.json"
)


@pytest.fixture
def living_room() -> AcousticReport:
    return AcousticReport.model_validate(json.loads(FIXTURE.read_text()))


def with_rt60(report: AcousticReport, mid: float, low: float | None = None) -> AcousticReport:
    """Same room with a flat RT60 of `mid` s (125 and 250 Hz set to `low` if given)."""
    rt = [mid] * len(report.bands_hz)
    if low is not None:
        rt[0] = rt[1] = low
    return report.model_copy(update={"rt60_s": rt})
