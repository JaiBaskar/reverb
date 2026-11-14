"""The structured room representation, built by a LangGraph pipeline:

    geometry -> imagery -> [walls agent | furniture agent | surroundings agent] -> assemble

geometry: outline checked against the scan mesh (height, real wall surfaces, openings).
imagery: the room's scan positions, their side/floor/ceiling views, and one rendered view per
wall. The three specialist agents (roomintel/agents.py) run in parallel on those images.
assemble: deterministic merge (roomintel/merge.py): per-wall finishes and features in metres,
furniture by kind and covering, hazards per wall, furniture objects from the meshes, and the
extra absorption all of that adds. Anything an agent could not establish stays "assumed".
"""

import logging
import operator
from typing import Annotated, Literal, TypedDict

import numpy as np
from pydantic import BaseModel

from acoustics.field import _inside
from acoustics.furniture import FurnitureItem, default_furnishing
from acoustics.materials import DEFAULT_SELECTION, MATERIALS
from properties import matterport
from properties.models import Room
from properties.service import get_rooms
from properties.tour import get_tour
from roomintel import agents, merge, obstacles, views
from roomintel.geometry import RoomGeometry, room_geometry
from roomintel.obstacles import FurnitureObject
from roomintel.panorama import ScanPosition, scan_positions

log = logging.getLogger(__name__)

MIN_CONFIDENCE = merge.MIN_CONFIDENCE
MAX_SCANS = 2


class MaterialAssignment(BaseModel):
    surface: Literal["floor", "walls", "ceiling"]
    material_id: str
    label: str
    alpha: list[float]
    provenance: Literal["observed", "assumed", "user"]
    confidence: float | None
    basis: str


class RoomModel(BaseModel):
    sid: str
    room_id: str
    label: str
    geometry: RoomGeometry
    scans: list[ScanPosition]
    materials: list[MaterialAssignment]
    furniture_as_scanned: list[FurnitureItem]
    furniture_basis: str
    agents: list[agents.AgentRun]
    walls: list[merge.WallFound]
    pieces: list[merge.PieceFound]
    hazards: list[merge.HazardFound]
    furniture_objects: list[FurnitureObject]
    wall_extra_sabins: list[float]  # absorption the per-wall findings add vs uniform walls
    absorption_notes: list[str]
    vision_status: Literal["ok", "partial", "unavailable", "error"]
    vision_reason: str | None
    issues: list[str]


class _State(TypedDict, total=False):
    sid: str
    room_id: str
    use_vision: bool
    room: Room
    geometry: RoomGeometry
    scans: list[ScanPosition]
    picked: list[ScanPosition]
    faces: dict
    wall_views: list
    wall_images: dict
    runs: Annotated[list, operator.add]
    issues: Annotated[list, operator.add]
    model: RoomModel


def stage_geometry(state: _State) -> _State:
    import trimesh

    sid, rid = state["sid"], state["room_id"]
    room = next((r for r in get_rooms(sid) if r.id == rid), None)
    if room is None:
        raise KeyError(f"room {rid} not found in {sid}")
    tr = next((t for t in get_tour(sid).rooms if t.room_id == rid), None)
    issues: list[str] = []
    mesh = None
    try:
        path = matterport.mesh_path(sid)
        mesh = trimesh.load(path, file_type="obj", force="mesh") if path else None
        if path is None:
            issues.append(
                "Matterport offers no mesh for this model; walls come from the outline only."
            )
    except matterport.MatterportError as e:
        issues.append(f"Scan mesh unavailable ({e}); walls come from the outline only.")
    geo = room_geometry(room, tr.polygon if tr else None, mesh)
    return {"room": room, "geometry": geo, "issues": issues}


def pick_scans(scans: list[ScanPosition], polygon, k: int = MAX_SCANS) -> list[ScanPosition]:
    """The scan nearest the room's centre, then the one farthest from it (other viewpoint)."""
    if not scans:
        return []
    cx = sum(p[0] for p in polygon) / len(polygon)
    cy = sum(p[1] for p in polygon) / len(polygon)
    first = min(scans, key=lambda s: (s.position[0] - cx) ** 2 + (s.position[1] - cy) ** 2)
    rest = [s for s in scans if s.id != first.id]
    picked = [first]
    if rest and k > 1:
        fx, fy = first.position[:2]
        picked.append(
            max(rest, key=lambda s: (s.position[0] - fx) ** 2 + (s.position[1] - fy) ** 2)
        )
    return picked


def stage_imagery(state: _State) -> _State:
    from PIL import Image

    sid, rid, geo = state["sid"], state["room_id"], state["geometry"]
    issues: list[str] = []
    try:
        scans = [s for s in scan_positions(matterport.fetch_assets(sid)) if s.room_id == rid]
    except matterport.MatterportError as e:
        return {
            "scans": [],
            "picked": [],
            "faces": {},
            "wall_views": [],
            "wall_images": {},
            "issues": [f"Panoramas unavailable ({e})."],
        }
    if not scans:
        issues.append("No tour scan position inside this room, so there is no imagery of it.")
    picked = pick_scans(scans, geo.polygon)
    faces: dict[str, object] = {}
    wall_views, wall_images = [], {}
    if state.get("use_vision", True) and scans:
        try:
            for n, s in enumerate(picked, start=1):
                for f, path in matterport.skybox_faces(sid, s.id, (0, 1, 2, 3, 4, 5)).items():
                    faces[f"S{n}F{f}"] = path
            wall_views = views.plan_views(geo, scans)
            out_dir = agents.cache_path(sid, rid, "x").parent / "views"
            out_dir.mkdir(parents=True, exist_ok=True)
            by_id = {s.id: s for s in scans}
            for v in wall_views:
                cube = {
                    k: np.asarray(Image.open(p).convert("RGB"))
                    for k, p in matterport.skybox_faces(sid, v.scan_id, (1, 2, 3, 4)).items()
                }
                dest = out_dir / f"{sid}_{rid}_W{v.wall}.jpg"
                if not dest.exists():
                    views.save(views.render(by_id[v.scan_id], cube, v.yaw_deg, v.hfov_deg), dest)
                wall_images[f"W{v.wall}"] = dest
        except matterport.MatterportError as e:
            issues.append(f"Panoramas could not be downloaded ({e}).")
    return {
        "scans": scans,
        "picked": picked,
        "faces": faces,
        "wall_views": wall_views,
        "wall_images": wall_images,
        "issues": issues,
    }


def _side(state: _State) -> dict:
    return {k: v for k, v in state["faces"].items() if k[-2:] in ("F1", "F2", "F3", "F4")}


def agent_walls(state: _State) -> _State:
    imgs = dict(state["wall_images"])
    extra = {}
    if "S1F5" in state["faces"]:
        extra["S1F5"] = state["faces"]["S1F5"]
    if "S1F0" in state["faces"]:
        extra["S1F0"] = state["faces"]["S1F0"]
    run = agents.run_agent("walls", agents.WallsReport, agents.walls_prompt(list(imgs), list(extra)),
                           {**imgs, **extra}, agents.cache_path(state["sid"], state["room_id"], "walls"))  # fmt: skip
    return {"runs": [run]}


def agent_furniture(state: _State) -> _State:
    imgs = _side(state)
    run = agents.run_agent("furniture", agents.FurnitureReport, agents.furniture_prompt(list(imgs)), imgs,
                           agents.cache_path(state["sid"], state["room_id"], "furniture"))  # fmt: skip
    return {"runs": [run]}


def agent_surroundings(state: _State) -> _State:
    imgs = _side(state)
    run = agents.run_agent("surroundings", agents.SurroundingsReport, agents.surroundings_prompt(list(imgs)),
                           imgs, agents.cache_path(state["sid"], state["room_id"], "surroundings"))  # fmt: skip
    return {"runs": [run]}


def _skipped(state: _State) -> _State:
    why = "Inspection not requested."
    return {
        "runs": [
            agents.AgentRun(agent=a, status="unavailable", reason=why)
            for a in ("walls", "furniture", "surroundings")
        ]
    }


def assemble(state: _State) -> _State:
    room, geo = state["room"], state["geometry"]
    runs = {r.agent: r for r in state.get("runs", [])}
    scans = state.get("scans", [])
    picked = {f"S{n}": s for n, s in enumerate(state.get("picked", []), start=1)}
    poly = geo.polygon

    def inside(x: float, y: float) -> bool:
        return bool(_inside(np.array([x]), np.array([y]), poly)[0])

    none = agents.AgentRun(agent="?", status="unavailable", reason="not run")
    walls = merge.walls_found(
        runs.get("walls", none), geo, state.get("wall_views", []), {s.id: s for s in scans}
    )
    surf = merge.surfaces_found(runs.get("walls", none))
    pieces = merge.pieces_found(runs.get("furniture", none), picked, geo.floor_z, inside)
    hazards = merge.hazards_found(runs.get("surroundings", none), picked, geo)

    # walls: the finish most of the wall area has, if the agent saw it; otherwise the default
    area: dict[str, float] = {}
    for wf in walls:
        if wf.material_id:
            area[wf.material_id] = area.get(wf.material_id, 0.0) + geo.walls[wf.wall].length_m
    wall_mat = max(area, key=area.get) if area else None
    wall_conf = (
        [wf.confidence for wf in walls if wf.material_id == wall_mat and wf.confidence]
        if wall_mat
        else []
    )
    seen = {
        "floor": surf.get("floor"),
        "ceiling": surf.get("ceiling"),
        "walls": (wall_mat, float(np.mean(wall_conf)), "most of the wall area")
        if wall_mat
        else None,
    }
    materials = []
    for s in ("floor", "walls", "ceiling"):
        o = seen[s]
        mid = o[0] if o else DEFAULT_SELECTION[s]
        materials.append(MaterialAssignment(
            surface=s, material_id=mid, label=MATERIALS[mid]["label"], alpha=MATERIALS[mid]["alpha"],
            provenance="observed" if o else "assumed", confidence=o[1] if o else None,
            basis=f"Seen by the walls agent: {o[2]}" if o else "Typical finish (not identified)",
        ))  # fmt: skip
    extra, notes = merge.wall_absorption(geo, walls, materials[1].material_id)

    fr = runs.get("furniture")
    if fr and fr.status == "ok":
        furniture = merge.furniture_items(pieces)
        basis = (
            "Furniture seen by the furniture agent (by kind and covering, confidence 0.5 or more)."
        )
    else:
        furniture = default_furnishing(room.label)
        basis = f"Typical furniture for a {room.label.lower()} (assumed): {(fr.reason if fr else None) or 'not inspected'}"

    objects: list[FurnitureObject] = []
    issues = list(state.get("issues", []))
    try:
        obs = obstacles.for_room(state["sid"], geo.polygon, geo.floor_z, geo.height.value)
        if obs is not None:
            objects = obs.objects
            merge.name_objects(objects, pieces)
            if not objects:
                issues.append(
                    "No furniture found in the scan mesh (or no MatterPak for this model)."
                )
    except Exception as e:  # meshes are optional: report, do not guess
        log.exception("obstacles failed")
        issues.append(f"Furniture geometry unavailable ({e}).")

    statuses = [r.status for r in runs.values()]
    if statuses and all(s == "ok" for s in statuses):
        vstat, vwhy = "ok", None
    elif any(s == "ok" for s in statuses):
        vstat = "partial"
        vwhy = "; ".join(f"{r.agent}: {r.reason}" for r in runs.values() if r.status != "ok")
    elif any(s == "error" for s in statuses):
        vstat, vwhy = (
            "error",
            "; ".join(f"{r.agent}: {r.reason}" for r in runs.values() if r.reason),
        )
    else:
        vstat, vwhy = (
            "unavailable",
            next((r.reason for r in runs.values() if r.reason), "not inspected"),
        )
    return {"model": RoomModel(
        sid=state["sid"], room_id=room.id, label=room.label, geometry=geo, scans=scans,
        materials=materials, furniture_as_scanned=furniture, furniture_basis=basis,
        agents=list(runs.values()), walls=walls, pieces=pieces, hazards=hazards,
        furniture_objects=objects, wall_extra_sabins=extra, absorption_notes=notes,
        vision_status=vstat, vision_reason=vwhy, issues=issues + geo.notes,
    )}  # fmt: skip


def _route(state: _State):
    return (
        ["agent_walls", "agent_furniture", "agent_surroundings"]
        if state.get("use_vision", True)
        else ["skipped"]
    )


def _graph():
    from langgraph.graph import END, START, StateGraph

    g = StateGraph(_State)
    g.add_node("geometry", stage_geometry)
    g.add_node("imagery", stage_imagery)
    g.add_node("agent_walls", agent_walls)
    g.add_node("agent_furniture", agent_furniture)
    g.add_node("agent_surroundings", agent_surroundings)
    g.add_node("skipped", _skipped)
    g.add_node("assemble", assemble)
    g.add_edge(START, "geometry")
    g.add_edge("geometry", "imagery")
    g.add_conditional_edges(
        "imagery", _route, ["agent_walls", "agent_furniture", "agent_surroundings", "skipped"]
    )
    for n in ("agent_walls", "agent_furniture", "agent_surroundings", "skipped"):
        g.add_edge(n, "assemble")
    g.add_edge("assemble", END)
    return g.compile()


_PIPELINE = None


def build_room_model(sid: str, room_id: str, use_vision: bool = True) -> RoomModel:
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = _graph()
    return _PIPELINE.invoke(
        {"sid": sid, "room_id": room_id, "use_vision": use_vision, "runs": [], "issues": []}
    )["model"]
