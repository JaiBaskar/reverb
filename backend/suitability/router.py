"""POST /suitability: fit per use case for an AcousticReport the client already has."""

from fastapi import APIRouter

from acoustics.report import AcousticReport
from suitability.models import SuitabilityReport
from suitability.service import assess

router = APIRouter(tags=["suitability"])


@router.post("/suitability", response_model=SuitabilityReport)
def suitability(report: AcousticReport) -> SuitabilityReport:
    return assess(report)
