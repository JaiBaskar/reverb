"""Room understanding (Phase 1) and treatment planning (Phase 2) endpoints."""

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from acoustics.furniture import FurnitureItem, UnknownFurniture
from acoustics.report import UnknownMaterial
from properties.matterport import MatterportError
from properties.service import is_known
from roomintel.model import RoomModel, build_room_model, inspected
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


class InspectStatus(BaseModel):
    state: Literal["idle", "running", "done", "error"]
    elapsed_s: float | None = None
    error: str | None = None
    model: RoomModel | None = None


_JOBS: dict[tuple[str, str], dict] = {}
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inspect")


def _status(sid: str, room_id: str) -> InspectStatus:
    job = _JOBS.get((sid, room_id))
    if job is None:
        if inspected(sid, room_id):
            return InspectStatus(
                state="done", model=build_room_model(sid, room_id, cache_only=True)
            )
        return InspectStatus(state="idle")
    fut, t0 = job["future"], job["started"]
    if not fut.done():
        return InspectStatus(state="running", elapsed_s=round(time.time() - t0, 1))
    if fut.exception():
        return InspectStatus(
            state="error", error=f"{type(fut.exception()).__name__}: {fut.exception()}"[:400]
        )
    return InspectStatus(state="done", elapsed_s=job.get("seconds"), model=fut.result())


@router.get("/properties/{sid}/rooms/{room_id}/inspect", response_model=InspectStatus)
def inspect_status(sid: str, room_id: str) -> InspectStatus:
    """Whether the vision inspection of this room has run, is running, or failed."""
    _check(sid)
    return _status(sid, room_id)


@router.post("/properties/{sid}/rooms/{room_id}/inspect", response_model=InspectStatus)
def inspect_room(sid: str, room_id: str, fresh: bool = False) -> InspectStatus:
    """Start the Deep Agents vision inspection (coordinator + walls / furniture / surroundings
    specialists) in the background; poll GET for the result."""
    _check(sid)
    key = (sid, room_id)
    job = _JOBS.get(key)
    if job and not job["future"].done():
        return _status(sid, room_id)
    if not fresh and job is None and inspected(sid, room_id):
        return _status(sid, room_id)

    def run():
        t0 = time.time()
        rm = build_room_model(sid, room_id, use_vision=True, fresh=True)
        _JOBS[key]["seconds"] = round(time.time() - t0, 1)
        return rm

    _JOBS[key] = {"started": time.time(), "future": _POOL.submit(run)}
    return _status(sid, room_id)


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
            cache_only=True,  # vision runs only via POST .../inspect (minutes on free models)
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
        avoid_walls=req.avoid_walls, cache_only=True,
    )  # fmt: skip
    try:
        return generate(plan, req.before, req.render)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e


@router.get("/properties/{sid}/treatment")
def whole_house(sid: str, objective: str = "mixing", scenario: str = "as_scanned"):
    """A treatment plan for every room with a wall outline (parallel; first call can take a while)."""
    from treatment.house import HouseTreatment, house_plan

    _check(sid)
    if objective not in OBJECTIVES:
        raise HTTPException(422, f"unknown objective '{objective}'")
    if scenario not in ("as_scanned", "empty"):
        raise HTTPException(422, f"unknown scenario '{scenario}'")
    try:
        out: HouseTreatment = house_plan(sid, objective, scenario)  # type: ignore[arg-type]
        return out
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
