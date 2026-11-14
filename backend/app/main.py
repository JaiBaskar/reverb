from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from acoustics.explain import Comparison, compare
from acoustics.materials import DEFAULT_SELECTION, MATERIALS
from acoustics.report import AcousticReport, UnknownMaterial, analyze_room
from ir.service import IrResponse, build_ir
from properties.matterport import MatterportError
from properties.models import Property, Room
from properties.service import get_property, get_rooms, list_properties, shortlist_ids

app = FastAPI(title="REVERB")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    if sid not in shortlist_ids():
        raise HTTPException(404, f"{sid} is not in shortlist.json")


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


@app.get("/materials")
def materials() -> dict:
    return {
        "materials": {k: {"label": v["label"], "alpha": v["alpha"]} for k, v in MATERIALS.items()},
        "defaults": DEFAULT_SELECTION,
    }


class AnalyzeRequest(BaseModel):
    sid: str
    room_id: str
    materials: dict[str, str] | None = None  # surface (floor|walls|ceiling) -> material id


@app.post("/rooms/analyze", response_model=AcousticReport)
def analyze(req: AnalyzeRequest) -> AcousticReport:
    _require_shortlisted(req.sid)
    try:
        room = next((r for r in get_rooms(req.sid) if r.id == req.room_id), None)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
    if room is None:
        raise HTTPException(404, f"room {req.room_id} not found in {req.sid}")
    try:
        return analyze_room(req.sid, room, req.materials)
    except UnknownMaterial as e:
        raise HTTPException(422, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/rooms/ir", response_model=IrResponse)
def room_ir(req: AnalyzeRequest) -> IrResponse:
    return build_ir(analyze(req))


class CompareRequest(BaseModel):
    a: AnalyzeRequest
    b: AnalyzeRequest


@app.post("/rooms/compare", response_model=Comparison)
def compare_rooms(req: CompareRequest) -> Comparison:
    return compare(analyze(req.a), analyze(req.b))
