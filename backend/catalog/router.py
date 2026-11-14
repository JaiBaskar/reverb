"""GET /catalog/search and /catalog/points: property discovery over the CoStar kit."""

from typing import Literal

from fastapi import APIRouter, Query

from catalog.models import SearchResult
from catalog.search import search
from catalog.service import load_index
from properties.service import shortlist_ids

router = APIRouter(tags=["catalog"])


@router.get("/catalog/search", response_model=SearchResult)
def catalog_search(
    q: str = "",
    city: str | None = None,
    kind: Literal["commercial", "residential"] | None = None,
    limit: int = Query(50, ge=1, le=500),
) -> SearchResult:
    return search(list(load_index()), q, city, kind, set(shortlist_ids()), limit)


@router.get("/catalog/points")
def catalog_points() -> dict:
    """Every located property as compact GeoJSON for a clustered map layer."""
    demo = set(shortlist_ids())
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [e.lon, e.lat]},
                "properties": {
                    "sid": e.sid,
                    "kind": e.kind,
                    "label": e.address,
                    "type": e.type_label or "",
                    "demo": bool(demo & set(e.model_ids)),
                },
            }
            for e in load_index()
            if e.lat is not None and e.lon is not None
        ],
    }
