"""Spatial acoustics: a room's field maps and recommendations, per room or for the whole house."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from acoustics.advice import Advice, advise
from acoustics.field import RoomField, room_field
from acoustics.furniture import FurnitureItem, UnknownFurniture, default_furnishing
from acoustics.report import AcousticReport, UnknownMaterial, analyze_room
from properties.matterport import MatterportError
from properties.service import get_rooms, is_known
from properties.tour import get_tour

router = APIRouter(tags=["acoustics"])


class InsightRequest(BaseModel):
    sid: str
    room_id: str
    materials: dict[str, str] | None = None
    furniture: list[FurnitureItem] | None = None  # None = default for the room type (assumed)
    source: tuple[float, float] | None = None  # model-space x, y; default near the longest wall


class RoomInsight(BaseModel):
    room_id: str
    label: str
    polygon: list[list[float]]
    report: AcousticReport
    field: RoomField
    advice: list[Advice]
    default_furniture: list[FurnitureItem]


def _insight(sid, room, polygon, materials=None, furniture=None, source=None) -> RoomInsight:
    items = default_furnishing(room.label) if furniture is None else furniture
    rep = analyze_room(sid, room, materials, furniture=items, outline=polygon)
    alpha = {m.surface: m.alpha for m in rep.materials}
    fld = room_field(polygon, rep.geometry.height_m.value, rep.rt60_s, alpha, source=source)
    return RoomInsight(
        room_id=room.id,
        label=room.label,
        polygon=polygon,
        report=rep,
        field=fld,
        advice=advise(rep, fld, polygon),
        default_furniture=default_furnishing(room.label),
    )


def _load(sid: str):
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")
    try:
        return get_rooms(sid), get_tour(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e


@router.post("/rooms/insight", response_model=RoomInsight)
def room_insight(req: InsightRequest) -> RoomInsight:
    rooms, tour = _load(req.sid)
    room = next((r for r in rooms if r.id == req.room_id), None)
    tr = next((t for t in tour.rooms if t.room_id == req.room_id), None)
    if room is None or tr is None:
        raise HTTPException(404, f"room {req.room_id} not found in {req.sid}")
    if not room.usable:
        raise HTTPException(422, f"room {room.label} has no usable geometry")
    if not tr.polygon:
        raise HTTPException(422, f"Matterport gives no closed outline for {room.label}")
    try:
        return _insight(req.sid, room, tr.polygon, req.materials, req.furniture, req.source)
    except (UnknownMaterial, UnknownFurniture) as e:
        raise HTTPException(422, str(e)) from e


class HouseInsights(BaseModel):
    sid: str
    rooms: list[RoomInsight]
    skipped: list[dict[str, str]]


@router.get("/properties/{sid}/insights", response_model=HouseInsights)
def house_insights(sid: str, furnished: bool = True) -> HouseInsights:
    """Every usable room with an outline: default materials, default furnishing (or empty)."""
    rooms, tour = _load(sid)
    by_id = {r.id: r for r in rooms}
    out, skipped = [], []
    for tr in tour.rooms:
        room = by_id.get(tr.room_id)
        if room is None or not room.usable:
            continue
        if not tr.polygon:
            skipped.append({"room_id": tr.room_id, "label": tr.label, "reason": "no outline"})
            continue
        out.append(_insight(sid, room, tr.polygon, furniture=None if furnished else []))
    return HouseInsights(sid=sid, rooms=out, skipped=skipped)
