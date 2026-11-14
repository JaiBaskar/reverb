from typing import Literal

from pydantic import BaseModel


class CatalogEntry(BaseModel):
    """One property in the CoStar kit that has at least one Matterport scan."""

    key: str  # "commercial-<PropertyId>" or "residential-<ListingId>"
    kind: Literal["commercial", "residential"]
    costar_id: int
    sid: str  # primary Matterport model id
    model_ids: list[str]
    address: str
    city: str | None
    state: str | None
    postcode: str | None
    lat: float | None
    lon: float | None
    coords_provenance: Literal["verified", "missing"]
    type_label: str | None
    name: str | None = None
    demo_pick: bool = False


class SearchResult(BaseModel):
    total: int
    results: list[CatalogEntry]
