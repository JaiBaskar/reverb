"""Specialist vision agents. Each looks at a different set of images for one job and answers
in a strict JSON vocabulary; none of them ever produces an acoustic number.

- walls agent: one rendered view per wall (views.py) + the floor and ceiling. Per wall: the
  finish (a material id) and every feature on it (window, door, open doorway, glass door,
  mirror, radiator, built-in shelving, artwork, wall shelf, TV) as image rectangles, which
  merge.py converts to metres along the wall and heights above the floor.
- furniture agent: the scan's side views. Each piece of furniture with its kind, its covering
  material (fabric, leather, wood, glass, metal...) and where it sits in the image.
- surroundings agent: the same views, looking for what damages the room acoustically or lets
  noise in: street-facing windows, HVAC vents, fans, appliances, fireplaces, large glass or
  mirrors, open-plan connections, stairwells.

Agents run in parallel (LangGraph branches). Answers are parsed as JSON, validated with
pydantic, retried once with the validation error, and cached per room and prompt version.
A failure is recorded as such; nothing is filled in for a missing answer.
"""

import base64
import io
import json
import logging
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from acoustics.materials import MATERIALS, SURFACE_MATERIALS

log = logging.getLogger(__name__)

PROMPT_VERSION = 2
IMAGE_PX = 1024

WallFeatureKind = Literal[
    "window", "door", "open_doorway", "glass_door", "mirror", "radiator",
    "built_in_shelving", "artwork", "wall_shelf", "tv", "other",
]  # fmt: skip
FurnitureKind = Literal[
    "sofa", "armchair", "chair", "office_chair", "bed", "table", "desk", "bookshelf",
    "wardrobe", "cabinets", "rug", "curtains", "piano", "cushions", "tv_stand", "lamp",
    "plant", "other",
]  # fmt: skip
Covering = Literal[
    "fabric", "leather", "wood", "glass", "metal", "plastic", "stone", "mixed", "unknown"
]
HazardKind = Literal[
    "street_facing_window", "single_glazing", "hvac_vent", "ceiling_fan", "appliance",
    "aquarium", "fireplace", "large_mirror", "large_glass", "open_plan_connection",
    "stairwell", "exposed_pipes", "hard_bare_surfaces", "other",
]  # fmt: skip


# ---- answers (what each agent must return) ----


class WallFeature(BaseModel):
    kind: WallFeatureKind
    x_start: float = Field(ge=0, le=1)
    x_end: float = Field(ge=0, le=1)
    y_top: float = Field(ge=0, le=1)
    y_bottom: float = Field(ge=0, le=1)
    covering: Literal["none", "blinds", "curtains", "shutters", "unknown"] = "unknown"
    confidence: float = Field(ge=0, le=1)


class WallAnswer(BaseModel):
    image: str  # "W<n>"
    material_id: str
    finish: str
    confidence: float = Field(ge=0, le=1)
    features: list[WallFeature] = []


class SurfaceAnswer(BaseModel):
    surface: Literal["floor", "ceiling"]
    material_id: str
    finish: str
    confidence: float = Field(ge=0, le=1)


class WallsReport(BaseModel):
    walls: list[WallAnswer]
    surfaces: list[SurfaceAnswer]
    notes: list[str] = []


class FurniturePiece(BaseModel):
    kind: FurnitureKind
    covering: Covering
    label: str
    count: int = Field(ge=1)
    image: str
    x_start: float = Field(ge=0, le=1)
    x_end: float = Field(ge=0, le=1)
    floor_y: float | None = Field(default=None, ge=0, le=1)
    top_y: float | None = Field(default=None, ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


class FurnitureReport(BaseModel):
    pieces: list[FurniturePiece]
    existing_treatment: list[str] = []
    notes: list[str] = []


class Hazard(BaseModel):
    kind: HazardKind
    image: str
    x: float = Field(ge=0, le=1)
    note: str
    confidence: float = Field(ge=0, le=1)


class SurroundingsReport(BaseModel):
    hazards: list[Hazard]
    notes: list[str] = []


class AgentRun(BaseModel):
    agent: str
    status: Literal["ok", "unavailable", "error"]
    model: str | None = None
    seconds: float | None = None
    reason: str | None = None
    created: str | None = None
    answer: dict | None = None  # the validated answer (WallsReport / FurnitureReport / ...)


# ---- prompts ----

RULES = """Answer with ONE JSON object only (no prose, no markdown). Report only what you can see.
Never estimate sizes, distances, absorption, reverberation, decibels or any acoustic number.
Image coordinates are fractions: x from 0 (left) to 1 (right), y from 0 (top) to 1 (bottom)."""


def walls_prompt(walls: list[str], extra: list[str]) -> str:
    wall_mats = ", ".join(f"{m} ({MATERIALS[m]['label']})" for m in SURFACE_MATERIALS["walls"])
    floor_mats = ", ".join(SURFACE_MATERIALS["floor"])
    ceil_mats = ", ".join(SURFACE_MATERIALS["ceiling"])
    return f"""You inspect the walls, floor and ceiling of ONE room.
Images {", ".join(walls)} each show ONE wall of the room, straight on (the wall fills the
middle of the image; neighbouring walls may show at the edges: ignore them). {", ".join(extra)}
look straight down (floor) and up (ceiling) from a scan position.
For each wall image return: its finish as material_id (one of: {wall_mats}), a short "finish"
description, confidence, and "features": every window, door, open_doorway, glass_door, mirror,
radiator, built_in_shelving, artwork, wall_shelf or tv ON THAT WALL with its rectangle
x_start, x_end, y_top, y_bottom, the window covering if any, and confidence.
Also return "surfaces": the floor (material_id one of: {floor_mats}) and the ceiling (one of:
{ceil_mats}).
Schema: {{"walls": [{{"image": "W0", "material_id": "...", "finish": "...", "confidence": 0.0,
"features": [{{"kind": "window", "x_start": 0.0, "x_end": 0.0, "y_top": 0.0, "y_bottom": 0.0,
"covering": "blinds", "confidence": 0.0}}]}}], "surfaces": [{{"surface": "floor",
"material_id": "...", "finish": "...", "confidence": 0.0}}], "notes": ["..."]}}
{RULES}"""


def furniture_prompt(images: list[str]) -> str:
    kinds = ", ".join(FurnitureKind.__args__)
    covers = ", ".join(Covering.__args__)
    return f"""You inventory the furniture and soft furnishings of ONE room from 360-degree
scan views {", ".join(images)}. "S<n>" is a scan position, "F1".."F4" its four side views (each
90 degrees clockwise from the previous; neighbouring views overlap). Different scans see the
same objects: list every physical object ONCE. Ignore things seen through doorways.
For each piece: kind (one of: {kinds}), covering material (one of: {covers}; e.g. a fabric
sofa vs a leather sofa, a glass vs wooden table), a short label, count, the image where it is
clearest, its horizontal extent x_start..x_end, floor_y where it touches the floor (null if
hidden) and top_y of its top edge (null if cut off), and confidence.
Also list any existing acoustic treatment (panels, foam, bass traps, diffusers) you see.
Schema: {{"pieces": [{{"kind": "sofa", "covering": "fabric", "label": "...", "count": 1,
"image": "S1F2", "x_start": 0.0, "x_end": 0.0, "floor_y": 0.0, "top_y": 0.0,
"confidence": 0.0}}], "existing_treatment": ["..."], "notes": ["..."]}}
{RULES}"""


def surroundings_prompt(images: list[str]) -> str:
    kinds = ", ".join(HazardKind.__args__)
    return f"""You look for things that hurt ONE room acoustically for recording music, in
scan views {", ".join(images)} ("S<n>F1".."F4": side views of scan position n).
Only report things INSIDE this room; for a doorway or opening to another space report it once
as open_plan_connection and ignore what is in the other space.
Report: windows that face a street or neighbours (street_facing_window), thin single glazing,
HVAC vents or returns, ceiling fans, appliances (fridge, washer, dishwasher, aquarium pump),
fireplaces, large mirrors or glass, open-plan connections to other spaces, stairwells, exposed
pipes, and large bare hard surfaces. kind is one of: {kinds}. For each: the image where it is
clearest, its horizontal centre x, a short note on why it matters, and confidence.
Schema: {{"hazards": [{{"kind": "hvac_vent", "image": "S1F3", "x": 0.0, "note": "...",
"confidence": 0.0}}], "notes": ["..."]}}
{RULES}"""


# ---- running ----


def model_name() -> tuple[str | None, str | None]:
    if os.environ.get("REVERB_VISION_MODEL"):
        return os.environ["REVERB_VISION_MODEL"], None
    if os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter:anthropic/claude-sonnet-5.5", None
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic:claude-sonnet-5-5", None
    return (
        None,
        "No OPENROUTER_API_KEY or ANTHROPIC_API_KEY in .env, so the room was not inspected.",
    )


def _b64(path: Path) -> str:
    from PIL import Image

    im = Image.open(path).convert("RGB")
    im.thumbnail((IMAGE_PX, IMAGE_PX))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def extract_json(text: str) -> dict:
    """The JSON object in a model reply (tolerates code fences and stray prose)."""
    text = re.sub(r"```(?:json)?", "", text)
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[a : b + 1])


def _ask(model: str, prompt: str, images: dict[str, Path]):
    from langchain.chat_models import init_chat_model
    from langchain_core.messages import HumanMessage

    content: list[dict] = [{"type": "text", "text": prompt}]
    for name, path in images.items():
        content.append({"type": "text", "text": f"Image {name}:"})
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64(path)}"}}
        )
    llm = init_chat_model(model, temperature=0)
    msgs = [HumanMessage(content=content)]
    return llm, msgs


def run_agent(name: str, schema: type[BaseModel], prompt: str, images: dict[str, Path], cache: Path,
              use_cache: bool = True) -> AgentRun:  # fmt: skip
    if use_cache and cache.exists():
        return AgentRun.model_validate_json(cache.read_text())
    model, why = model_name()
    if model is None:
        return AgentRun(agent=name, status="unavailable", reason=why)
    if not images:
        return AgentRun(agent=name, status="unavailable", reason="No imagery of this room.")
    t0 = time.time()
    try:
        llm, msgs = _ask(model, prompt, images)
        reply = llm.invoke(msgs)
        try:
            answer = schema.model_validate(extract_json(str(reply.content)))
        except (ValueError, ValidationError) as e:  # one retry with the error spelled out
            from langchain_core.messages import AIMessage, HumanMessage

            retry = llm.invoke([*msgs, AIMessage(content=str(reply.content)),
                                HumanMessage(content=f"That did not match the schema: {str(e)[:600]}. Reply with the corrected JSON object only.")])  # fmt: skip
            answer = schema.model_validate(extract_json(str(retry.content)))
    except Exception as e:  # provider, parsing or schema failure: recorded, never substituted
        log.exception("%s agent failed", name)
        return AgentRun(agent=name, status="error", model=model, seconds=time.time() - t0,
                        reason=f"{type(e).__name__}: {e}"[:400])  # fmt: skip
    run = AgentRun(
        agent=name, status="ok", model=model, seconds=round(time.time() - t0, 1),
        created=datetime.now(UTC).isoformat(timespec="seconds"), answer=answer.model_dump(),
    )  # fmt: skip
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(run.model_dump_json(indent=1))
    return run


def cache_path(sid: str, room_id: str, agent: str) -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or Path(__file__).resolve().parents[2] / "data"
    return Path(root) / "cache" / "vision" / f"{sid}_{room_id}_{agent}_v{PROMPT_VERSION}.json"
