from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
