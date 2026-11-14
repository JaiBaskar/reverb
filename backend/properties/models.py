from typing import Literal

from pydantic import BaseModel

Provenance = Literal["verified", "estimated", "assumed", "user", "missing"]


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


class TourFloor(BaseModel):
    id: str
    label: str | None
    index: int


class TourSweep(BaseModel):
    id: str  # Matterport location id == Showcase SDK sweep sid
    room_id: str | None
    floor_index: int | None
    position: list[float]  # model space [x, y, z], metres, z up


class TourRoom(BaseModel):
    room_id: str  # same id as Room.id and the SDK's Room.current ids
    label: str
    usable: bool
    floor_index: int | None
    polygon: list[list[float]] | None  # [[x, y], ...] wall centrelines, model space
    polygon_provenance: Provenance
    sweep_ids: list[str]
    entry_sweep_id: str | None
    entry_sweep_provenance: Provenance
    navigable: bool
    issues: list[str]


class TourLayout(BaseModel):
    sid: str
    coordinate_note: str
    floors: list[TourFloor]
    rooms: list[TourRoom]
    sweeps: list[TourSweep]


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
