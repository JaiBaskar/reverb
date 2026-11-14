import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator

from acoustics.explain import Comparison, compare
from acoustics.furniture import FURNITURE, FurnitureItem, UnknownFurniture, default_furnishing
from acoustics.materials import DEFAULT_SELECTION, MATERIALS
from acoustics.report import AcousticReport, UnknownMaterial, analyze_room
from acoustics.router import router as acoustics_router
from catalog.router import router as catalog_router
from costar.router import router as costar_router
from ir.service import IrResponse, build_ir
from noise.router import router as noise_router
from noise_scout.router import router as noise_scout_router
from properties.custom import CustomRoom, custom_room_to_room
from properties.matterport import ROOT, MatterportError
from properties.models import Property, Room, TourLayout
from properties.router import router as viewer_router
from properties.service import get_property, get_rooms, is_known, list_properties
from properties.tour import get_tour
from suitability.router import router as suitability_router

app = FastAPI(title="REVERB")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(noise_router)
app.include_router(noise_scout_router)
app.include_router(suitability_router)
app.include_router(costar_router)
app.include_router(catalog_router)
app.include_router(viewer_router)
app.include_router(acoustics_router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/properties", response_model=list[Property])
def properties() -> list[Property]:
    try:
        return list_properties()
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e


def _require_shortlisted(sid: str) -> None:
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")


@app.get("/properties/{sid}", response_model=Property)
def property_(sid: str) -> Property:
    _require_shortlisted(sid)
    try:
        return get_property(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/properties/{sid}/rooms", response_model=list[Room])
def rooms(sid: str) -> list[Room]:
    _require_shortlisted(sid)
    try:
        return get_rooms(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/properties/{sid}/tour", response_model=TourLayout)
def tour(sid: str) -> TourLayout:
    _require_shortlisted(sid)
    try:
        return get_tour(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/demo")
def demo_pair() -> dict:
    """A house with good acoustics and one with bad, for the one-click demo (shortlist.json)."""
    pair = json.loads((ROOT / "shortlist.json").read_text()).get("demo_pair", {})
    return {k: v for k, v in pair.items() if not k.startswith("_")}


@app.get("/materials")
def materials() -> dict:
    return {
        "materials": {k: {"label": v["label"], "alpha": v["alpha"]} for k, v in MATERIALS.items()},
        "defaults": DEFAULT_SELECTION,
    }


class AnalyzeRequest(BaseModel):
    sid: str
    room_id: str | None = None  # a Matterport room of this property
    custom_room: CustomRoom | None = None  # or dimensions entered by the user
    materials: dict[str, str] | None = None  # surface (floor|walls|ceiling) -> material id
    # None = default furnishing for the room type (assumed); [] = empty room.
    furniture: list[FurnitureItem] | None = None
    furnished: bool = False  # False keeps the room empty unless furniture is given
    use_outline: bool = False  # wall area from the Matterport outline when available

    @model_validator(mode="after")
    def _one_room_source(self) -> "AnalyzeRequest":
        if (self.room_id is None) == (self.custom_room is None):
            raise ValueError("give exactly one of room_id or custom_room")
        return self


@app.post("/rooms/analyze", response_model=AcousticReport)
def analyze(req: AnalyzeRequest) -> AcousticReport:
    _require_shortlisted(req.sid)
    if req.custom_room is not None:
        room = custom_room_to_room(req.custom_room)
    else:
        try:
            room = next((r for r in get_rooms(req.sid) if r.id == req.room_id), None)
        except MatterportError as e:
            raise HTTPException(502, str(e)) from e
    if room is None:
        raise HTTPException(404, f"room {req.room_id} not found in {req.sid}")
    try:
        return analyze_room(
            req.sid,
            room,
            req.materials,
            furniture=furnishing(req, room),
            outline=outline_for(req, room),
        )
    except (UnknownMaterial, UnknownFurniture) as e:
        raise HTTPException(422, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def furnishing(req: AnalyzeRequest, room: Room) -> list[FurnitureItem] | None:
    if req.furniture is not None:
        return req.furniture
    return default_furnishing(room.label) if req.furnished else None


def outline_for(req: AnalyzeRequest, room: Room) -> list | None:
    """The room's Matterport outline, if asked for and available (custom rooms have none)."""
    if not req.use_outline or req.room_id is None:
        return None
    try:
        tour = get_tour(req.sid)
    except MatterportError:
        return None
    return next((r.polygon for r in tour.rooms if r.room_id == room.id and r.polygon), None)


@app.get("/furniture")
def furniture_catalog() -> dict:
    return {k: {"label": v["label"], "sabins": v["sabins"]} for k, v in FURNITURE.items()}


@app.post("/rooms/ir", response_model=IrResponse)
def room_ir(req: AnalyzeRequest) -> IrResponse:
    return build_ir(analyze(req))


class CompareRequest(BaseModel):
    a: AnalyzeRequest
    b: AnalyzeRequest


@app.post("/rooms/compare", response_model=Comparison)
def compare_rooms(req: CompareRequest) -> Comparison:
    return compare(analyze(req.a), analyze(req.b))
