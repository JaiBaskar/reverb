"""GET /properties/{sid}/facts: CoStar facts with provenance."""

from fastapi import APIRouter, HTTPException

from costar.models import PropertyFacts
from costar.service import get_facts
from properties.service import shortlist_ids

router = APIRouter(tags=["costar"])


@router.get("/properties/{sid}/facts", response_model=PropertyFacts)
def property_facts(sid: str) -> PropertyFacts:
    if sid not in shortlist_ids():
        raise HTTPException(404, f"{sid} is not in shortlist.json")
    return get_facts(sid)
