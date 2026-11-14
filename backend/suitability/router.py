"""POST /suitability: fit per use case for an AcousticReport the client already has."""

from fastapi import APIRouter
from pydantic import BaseModel

from acoustics.report import AcousticReport
from suitability.compare import UseCaseVerdict, compare_fits
from suitability.models import SuitabilityReport
from suitability.service import assess

router = APIRouter(tags=["suitability"])


@router.post("/suitability", response_model=SuitabilityReport)
def suitability(report: AcousticReport) -> SuitabilityReport:
    return assess(report)


class CompareSuitability(BaseModel):
    a: AcousticReport
    b: AcousticReport


class SuitabilityComparison(BaseModel):
    a: SuitabilityReport
    b: SuitabilityReport
    verdicts: list[UseCaseVerdict]


@router.post("/suitability/compare", response_model=SuitabilityComparison)
def suitability_compare(req: CompareSuitability) -> SuitabilityComparison:
    sa, sb = assess(req.a), assess(req.b)
    return SuitabilityComparison(a=sa, b=sb, verdicts=compare_fits(sa, sb))
