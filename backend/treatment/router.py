"""Room understanding (Phase 1) and treatment planning (Phase 2) endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from acoustics.furniture import FurnitureItem, UnknownFurniture
from acoustics.report import UnknownMaterial
from properties.matterport import MatterportError
from properties.service import is_known
from roomintel.model import RoomModel, build_room_model
from treatment.objectives import OBJECTIVES, Objective
from treatment.service import Scenario, TreatmentPlan, make_plan

router = APIRouter(tags=["treatment"])


def _check(sid: str) -> None:
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")


@router.get("/properties/{sid}/rooms/{room_id}/model", response_model=RoomModel)
def room_model(sid: str, room_id: str, vision: bool = True) -> RoomModel:
    """Geometry, scan positions, observed or assumed materials and furniture, with provenance."""
    _check(sid)
    try:
        return build_room_model(sid, room_id, use_vision=vision)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/treatment/objectives", response_model=list[Objective])
def objectives() -> list[Objective]:
    return list(OBJECTIVES.values())


class PlanRequest(BaseModel):
    sid: str
    room_id: str
    objective: str = "mixing"
    scenario: Scenario = "as_scanned"
    materials: dict[str, str] | None = None
    furniture: list[FurnitureItem] | None = None
    avoid_walls: list[int] = []  # wall indices to keep clear (windows, doors, furniture)


@router.post("/rooms/treatment", response_model=TreatmentPlan)
def treatment_plan(req: PlanRequest) -> TreatmentPlan:
    _check(req.sid)
    if req.objective not in OBJECTIVES:
        raise HTTPException(422, f"unknown objective '{req.objective}'")
    try:
        plan, _ = make_plan(
            req.sid,
            req.room_id,
            req.objective,
            req.scenario,
            req.materials,
            req.furniture,
            avoid_walls=req.avoid_walls,
        )
        return plan
    except (StopIteration, KeyError) as e:
        raise HTTPException(404, f"room {req.room_id} not found in {req.sid}") from e
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
    except (UnknownMaterial, UnknownFurniture, ValueError) as e:
        raise HTTPException(422, str(e)) from e


@router.get("/visualize/status")
def photoreal_status():
    from treatment.photoreal import PhotorealStatus, status

    st: PhotorealStatus = status()
    return st


class PhotorealRequest(PlanRequest):
    before: str  # data URI of the original view
    render: str  # data URI of the same view with the plan drawn in


@router.post("/visualize/photoreal")
def photoreal(req: PhotorealRequest):
    from treatment.photoreal import generate, status

    if not status().available:
        raise HTTPException(503, status().reason)
    _check(req.sid)
    plan, _ = make_plan(
        req.sid, req.room_id, req.objective, req.scenario, req.materials, req.furniture,
        avoid_walls=req.avoid_walls,
    )  # fmt: skip
    try:
        return generate(plan, req.before, req.render)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e
