"""Treatment plans for every room of a property at once (the whole house in the 3D tour).

Each room with a Matterport wall outline gets its own full plan (make_plan): its own layout,
targets, candidates, fitting and optimisation. Rooms run in parallel. Vision: only rooms that
were already inspected reuse their agents' answers (cache_only); the others use typical
materials and furniture (assumed) plus everything the scan meshes give (geometry, openings,
real wall surfaces, furniture objects), and say so.
"""

import logging
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel

from properties.service import get_rooms
from properties.tour import get_tour
from treatment.placement import PlacedItem
from treatment.service import Scenario, make_plan

log = logging.getLogger(__name__)

WORKERS = 4
MIN_AREA_M2 = 4.0  # closets, short hallways and bathrooms under this are not music rooms


class RoomPlanSummary(BaseModel):
    room_id: str
    label: str
    status: str  # "ok" | "skipped" | "error"
    reason: str | None = None
    area_m2: float | None = None
    mid_before_s: float | None = None
    mid_after_s: float | None = None
    target_mid: tuple[float, float] | None = None
    items: list[PlacedItem] = []
    item_count: int = 0
    blocked: int = 0
    moved: int = 0
    vision_status: str | None = None


class HouseTreatment(BaseModel):
    sid: str
    objective: str
    scenario: Scenario
    rooms: list[RoomPlanSummary]
    total_items: int
    notes: list[str]


_CACHE: dict[tuple[str, str, str], HouseTreatment] = {}


def house_plan(sid: str, objective: str, scenario: Scenario = "as_scanned") -> HouseTreatment:
    key = (sid, objective, scenario)
    if key in _CACHE:
        return _CACHE[key]
    rooms = {r.id: r for r in get_rooms(sid)}
    out: list[RoomPlanSummary] = []
    todo = []
    for tr in get_tour(sid).rooms:
        room = rooms.get(tr.room_id)
        if room is None:
            continue
        label = room.label
        if not room.usable:
            out.append(RoomPlanSummary(room_id=room.id, label=label, status="skipped",
                                       reason="; ".join(room.issues) or "not enough geometry"))  # fmt: skip
        elif not tr.polygon:
            out.append(RoomPlanSummary(room_id=room.id, label=label, status="skipped",
                                       reason="no wall outline from Matterport, so its position in the scan is unknown"))  # fmt: skip
        elif (room.area_m2.value or 0) < MIN_AREA_M2 or label.lower() in ("void", "closet"):
            out.append(RoomPlanSummary(room_id=room.id, label=label, status="skipped", area_m2=room.area_m2.value,
                                       reason="too small to use as a music room"))  # fmt: skip
        else:
            todo.append(room)

    def one(room) -> RoomPlanSummary:
        try:
            plan, _ = make_plan(sid, room.id, objective, scenario, room=room, cache_only=True)
        except Exception as e:  # one room failing must not sink the house
            log.exception("house plan failed for %s/%s", sid, room.id)
            return RoomPlanSummary(
                room_id=room.id, label=room.label, status="error", reason=str(e)[:200]
            )
        p = plan.prediction
        items = [i.model_copy(update={"key": f"{room.id[:6]}-{i.key}"}) for i in plan.items]
        return RoomPlanSummary(
            room_id=room.id, label=room.label, status="ok", area_m2=plan.room.area_m2,
            mid_before_s=p.mid_before_s, mid_after_s=p.mid_after_s,
            target_mid=(p.target_low_s[2], p.target_high_s[2]), items=items, item_count=len(items),
            blocked=sum(i.status == "blocked" for i in items), moved=sum(i.status in ("moved", "replaced") for i in items),
            vision_status=plan.room.vision_status,
        )  # fmt: skip

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        out += list(pool.map(one, todo))
    out.sort(key=lambda r: (r.status != "ok", -(r.area_m2 or 0)))
    house = HouseTreatment(
        sid=sid, objective=objective, scenario=scenario, rooms=out,
        total_items=sum(r.item_count for r in out),
        notes=[
            "Every room is planned on its own for this use; rooms you have not opened use typical "
            "materials and furniture (assumed) plus the scan's geometry and furniture.",
        ],
    )  # fmt: skip
    _CACHE[key] = house
    return house
