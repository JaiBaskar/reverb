"""Rooms entered by hand: the geometry fallback when Matterport has no usable scan."""

from pydantic import BaseModel, Field

from properties.models import Field as PField
from properties.models import Room


class CustomRoom(BaseModel):
    label: str = Field("Custom room", max_length=60)
    width_m: float = Field(ge=1.0, le=60.0)
    depth_m: float = Field(ge=1.0, le=60.0)
    height_m: float = Field(ge=1.8, le=15.0)


def custom_room_to_room(c: CustomRoom) -> Room:
    note = "entered by the user"
    user = lambda v: PField(value=v, provenance="user", note=note)
    return Room(
        id=f"custom:{c.width_m:g}x{c.depth_m:g}x{c.height_m:g}",
        label=c.label,
        label_confidence=None,
        area_m2=PField(
            value=c.width_m * c.depth_m, provenance="user", note="width x depth entered by the user"
        ),
        width_m=user(c.width_m),
        depth_m=user(c.depth_m),
        height_m=user(c.height_m),
        usable=True,
        issues=[],
    )
