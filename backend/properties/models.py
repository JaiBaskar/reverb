from typing import Literal

from pydantic import BaseModel

Provenance = Literal["verified", "estimated", "assumed", "missing"]


class Field(BaseModel):
    value: float | None
    provenance: Provenance
    note: str | None = None


class Room(BaseModel):
    id: str
    label: str
    label_confidence: float | None
    area_m2: Field
    width_m: Field
    depth_m: Field
    height_m: Field
    usable: bool
    issues: list[str]


class Property(BaseModel):
    sid: str
    name: str
    address: str | None
    city: str | None
    state: str | None
    lat: float | None
    lon: float | None
    usable_room_count: int
    room_count: int
