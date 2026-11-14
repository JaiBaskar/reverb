"""GET /properties/{sid}/facts: CoStar facts with provenance."""

from fastapi import APIRouter, HTTPException

from costar.models import PropertyFacts
from costar.service import get_facts
from properties.service import is_known

router = APIRouter(tags=["costar"])


@router.get("/properties/{sid}/facts", response_model=PropertyFacts)
def property_facts(sid: str) -> PropertyFacts:
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")
    return get_facts(sid)
