"""Room Inspector: a Deep Agents coordinator that runs the three vision specialists.

    coordinator (Deep Agent, text model)
      ├─ task -> walls-inspector        (vision: one view per wall + floor and ceiling)
      ├─ task -> furniture-inspector    (vision: the scan's side views)
      └─ task -> surroundings-inspector (vision: the same views, acoustic hazards)

Each specialist is a CompiledSubAgent: a one-node LangGraph that sends its images to the vision
model, validates the JSON answer against its pydantic schema (agents.run_agent) and hands the
coordinator a short text summary. The coordinator cross-checks the three (a low-confidence
wall, blinds vs curtains, glass the walls inspector missed), may send ONE specialist back with
a focus note, and writes a structured summary. The validated specialist answers, never the
coordinator's prose, are what reach the acoustics (merge.py). If no coordinator model is
available or it fails, the specialists run directly in parallel and that is recorded.
"""

import logging
import os
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from roomintel import agents

log = logging.getLogger(__name__)

TIMEOUT_S = int(os.environ.get("REVERB_INSPECTOR_TIMEOUT_S", "900"))
SPECIALISTS = {
    "walls": "walls-inspector",
    "furniture": "furniture-inspector",
    "surroundings": "surroundings-inspector",
}
NUMBERS = re.compile(r"\d+(\.\d+)?\s*(dB|Hz|kHz|ms|sabins?|seconds?|s\b)", re.IGNORECASE)


class InspectionDraft(BaseModel):
    """What the coordinator returns. No acoustic numbers: those come from Python."""

    summary: str = Field(
        description="Two or three sentences: what the room is made of and furnished with."
    )
    cross_checks: list[str] = Field(
        default=[],
        description="Agreements or conflicts between the inspectors, citing images (W0, S1F2).",
    )
    rechecked: list[str] = Field(
        default=[], description="Specialists sent back for a second look, and why."
    )
    gaps: list[str] = Field(
        default=[], description="What could not be established from the images."
    )


class Inspection(BaseModel):
    orchestrator: Literal["deepagents", "direct"]
    coordinator_model: str | None = None
    vision_model: str | None = None
    summary: str | None = None
    cross_checks: list[str] = []
    rechecked: list[str] = []
    gaps: list[str] = []
    seconds: float | None = None
    reason: str | None = None  # why the coordinator did not run (fallback)


# A job: (schema, prompt, images, cache path). Built by model.py from the room's imagery.
Job = tuple[type[BaseModel], str, dict[str, Path], Path]


def coordinator_model() -> str | None:
    if os.environ.get("REVERB_INSPECTOR_MODEL"):
        return os.environ["REVERB_INSPECTOR_MODEL"]
    if not (os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")):
        return None
    from noise_scout.agent import models  # same coordinator model as Noise Scout

    return models()[0]


def summarize(name: str, run: agents.AgentRun) -> str:
    """The specialist's validated answer as short text for the coordinator."""
    if run.status != "ok" or not run.answer:
        return f"{name} inspector: {run.status} ({run.reason or 'no answer'})."
    a = run.answer
    if name == "walls":
        lines = [f"- {w['image']}: {w['material_id']} ({w['finish']}), confidence {w['confidence']:.2f}"
                 + (f"; features: {', '.join(f['kind'] + ('/' + f['covering'] if f.get('covering') not in (None, 'unknown', 'none') else '') for f in w['features'])}" if w["features"] else "")
                 for w in a.get("walls", [])]  # fmt: skip
        lines += [
            f"- {s['surface']}: {s['material_id']} ({s['finish']}), confidence {s['confidence']:.2f}"
            for s in a.get("surfaces", [])
        ]
    elif name == "furniture":
        lines = [
            f"- {p['count']} x {p['kind']} ({p['covering']}) '{p['label']}' in {p['image']}, confidence {p['confidence']:.2f}"
            for p in a.get("pieces", [])
        ]
        if a.get("existing_treatment"):
            lines.append(f"- existing treatment: {', '.join(a['existing_treatment'])}")
    else:
        lines = [
            f"- {h['kind']} in {h['image']}: {h['note']} (confidence {h['confidence']:.2f})"
            for h in a.get("hazards", [])
        ]
    notes = [f"- note: {n}" for n in a.get("notes", [])]
    return f"{name} inspector answered ({run.seconds} s):\n" + "\n".join(
        lines + notes or ["- nothing found"]
    )


def _specialist(name: str, job: Job, results: dict[str, agents.AgentRun], rechecks: list[str]):
    """A CompiledSubAgent runnable: run the vision agent, keep the validated answer, report back."""
    from langchain_core.messages import AIMessage, HumanMessage
    from langgraph.graph import START, MessagesState, StateGraph

    schema, prompt, images, cache = job

    def node(state: MessagesState):
        task = next(
            (str(m.content) for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
        )
        again = name in results
        if again:  # a second look: the coordinator's focus note goes into the prompt, fresh call
            rechecks.append(f"{name}: {task[:200]}")
            run = agents.run_agent(
                name,
                schema,
                f"{prompt}\nCoordinator's focus for this second look: {task[:600]}",
                images,
                cache,
                use_cache=False,
            )
            if run.status == "ok" or results[name].status != "ok":
                results[name] = run
        else:
            results[name] = agents.run_agent(name, schema, prompt, images, cache)
        return {"messages": [AIMessage(content=summarize(name, results[name]))]}

    g = StateGraph(MessagesState)
    g.add_node("inspect", node)
    g.add_edge(START, "inspect")
    return g.compile()


PROMPT = """You coordinate the inspection of ONE room of a home for a musician. Three vision
specialists can look at the room's images: walls-inspector (finishes of walls, floor, ceiling;
windows, doors, glass on each wall), furniture-inspector (every piece of furniture and its
covering) and surroundings-inspector (things that hurt recording: vents, fans, appliances,
street-facing windows, open-plan connections).

Process:
1. Call get_room_context. Then YOUR NEXT RESPONSE must be three `task` calls, one per
   specialist, in parallel. Pass the room label in each task description.
2. Read their answers and cross-check them: a wall or surface with confidence below 0.5; window
   coverings the walls inspector calls blinds that the furniture inspector lists as curtains (or
   the reverse); large glass or mirrors one saw and the other did not; furniture that looks
   counted twice. If something matters, send THAT ONE specialist back once with a `task` whose
   description says exactly what to look at again (image names). At most two second looks.
3. Save your notes with write_file to /findings/inspection.md, then return the structured
   summary.
Rules: you never see the images yourself; only report what the specialists said. Never state
absorption, reverberation, decibels, frequencies or any acoustic number: those are computed
elsewhere from the specialists' validated answers. Cite image names (W0, S1F2) in cross-checks.
"""


def _validate(d: InspectionDraft) -> InspectionDraft:
    clean = lambda xs: [x for x in xs if not NUMBERS.search(x)]
    summary = (
        d.summary if not NUMBERS.search(d.summary) else NUMBERS.sub("[number removed]", d.summary)
    )
    return InspectionDraft(
        summary=summary,
        cross_checks=clean(d.cross_checks),
        rechecked=d.rechecked,
        gaps=clean(d.gaps),
    )


def run_direct(jobs: dict[str, Job]) -> dict[str, agents.AgentRun]:
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {n: pool.submit(agents.run_agent, n, *job) for n, job in jobs.items()}
        return {n: f.result() for n, f in futs.items()}


def inspect(
    jobs: dict[str, Job], context: dict, agent_factory: Callable | None = None
) -> tuple[dict[str, agents.AgentRun], Inspection]:
    """Run the specialists under the Deep Agents coordinator; fall back to running them directly."""
    vision, _ = agents.model_name()
    coord = coordinator_model()
    t0 = time.time()
    if not any(job[2] for job in jobs.values()):
        return run_direct(jobs), Inspection(
            orchestrator="direct", vision_model=vision, reason="No imagery of this room."
        )
    if coord is None or vision is None:
        why = (
            "No coordinator model (OPENROUTER_API_KEY / ANTHROPIC_API_KEY)."
            if coord is None
            else "No vision model."
        )
        return run_direct(jobs), Inspection(orchestrator="direct", vision_model=vision, reason=why)

    results: dict[str, agents.AgentRun] = {}
    rechecks: list[str] = []
    try:
        agent = (agent_factory or build_agent)(coord, jobs, context, results, rechecks)
        with ThreadPoolExecutor(max_workers=1) as pool:
            out = pool.submit(
                agent.invoke,
                {
                    "messages": [
                        {"role": "user", "content": f"Inspect the room '{context.get('label')}'."}
                    ]
                },
            ).result(timeout=TIMEOUT_S)
        draft = out.get("structured_response")
        draft = _validate(
            draft
            if isinstance(draft, InspectionDraft)
            else InspectionDraft.model_validate(draft or {"summary": ""})
        )
    except (FutureTimeout, Exception) as e:
        log.exception("inspector coordinator failed")
        missing = {n: j for n, j in jobs.items() if n not in results}
        results.update(run_direct(missing))
        return results, Inspection(orchestrator="direct", coordinator_model=coord, vision_model=vision,
                                   seconds=round(time.time() - t0, 1), reason=f"Coordinator failed ({type(e).__name__}: {str(e)[:200]}); specialists ran directly.")  # fmt: skip
    missing = {
        n: j for n, j in jobs.items() if n not in results
    }  # a specialist the coordinator skipped
    results.update(run_direct(missing))
    return results, Inspection(
        orchestrator="deepagents", coordinator_model=coord, vision_model=vision, summary=draft.summary,
        cross_checks=draft.cross_checks, rechecked=rechecks or draft.rechecked, gaps=draft.gaps,
        seconds=round(time.time() - t0, 1),
        reason=f"Coordinator skipped {', '.join(missing)}; ran directly." if missing else None,
    )  # fmt: skip


def build_agent(
    model: str, jobs: dict[str, Job], context: dict, results: dict, rechecks: list[str]
):
    from deepagents import CompiledSubAgent, create_deep_agent
    from langchain_core.tools import tool

    import noise_scout.agent  # noqa: F401 - registers the harness profile that hides file browsing

    @tool
    def get_room_context() -> dict:
        """The room being inspected: label, size, walls and which images each specialist has."""
        return context

    descriptions = {
        "walls": "Vision specialist: identifies wall, floor and ceiling finishes and the windows, doors, glass and objects on each wall. Give it the room label; on a second look, name the images to re-examine.",
        "furniture": "Vision specialist: lists every piece of furniture with its kind and covering (fabric, leather, wood...). On a second look, say what to recount.",
        "surroundings": "Vision specialist: finds acoustic hazards inside the room (vents, fans, appliances, street-facing windows, open-plan connections).",
    }
    subagents = [
        CompiledSubAgent(
            name=SPECIALISTS[n],
            description=descriptions[n],
            runnable=_specialist(n, job, results, rechecks),
        )
        for n, job in jobs.items()
    ]
    return create_deep_agent(model=model, tools=[get_room_context], system_prompt=PROMPT, subagents=subagents,
                             response_format=InspectionDraft, name="room-inspector")  # fmt: skip
