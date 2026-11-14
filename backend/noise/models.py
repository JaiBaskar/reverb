"""NoiseReport shape. Proposed for contract/ once the scaffold lands."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Provenance = Literal["verified", "estimated", "assumed", "missing"]
ExposureLevel = Literal["none", "low", "moderate", "high"]


class NoiseSource(BaseModel):
    id: str = Field(description="OSM id of the nearest element, e.g. 'way/123'")
    category: str
    subtype: str = Field(description="Matching OSM tag, e.g. 'highway=primary'")
    name: str | None
    lat: float = Field(description="Nearest point of the feature to the property")
    lon: float
    distance_m: float
    bearing_deg: float
    bearing_compass: str
    osm_url: str
    osm_ids: list[str] = Field(
        description="All OSM elements merged into this source (e.g. road segments)"
    )
    provenance: Provenance = "verified"
    geometry: dict | None = Field(
        default=None, description="GeoJSON geometry of the feature, [lon, lat] coordinates"
    )


class CategoryExposure(BaseModel):
    category: str
    label: str
    radius_m: int
    count: int
    nearest_m: float | None
    level: ExposureLevel
    reason: str


class NoiseReport(BaseModel):
    sid: str | None
    lat: float
    lon: float
    location_provenance: Provenance
    radius_m: int
    generated_at: datetime
    sources: list[NoiseSource]
    exposure: list[CategoryExposure]
    notes: list[str]
    data_source: str = "OpenStreetMap contributors, via the Overpass API (ODbL)"
    status: Literal["ok", "error"] = "ok"
    schema_version: int = 1  # 2 adds geometry and the extra categories
    categories_queried: list[str] = []
