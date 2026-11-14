"""Run the Noise Scout for a property: build context, invoke the agent, validate, cache."""

import logging
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

from costar.service import get_facts
from noise.service import get_noise_report
from noise_scout.agent import MAIN_MODEL, SUBAGENT_MODEL, build_agent
from noise_scout.models import NoiseScoutResult, ScoutDraft, TraceInfo
from noise_scout.tools import ScoutContext, build_tools
from noise_scout.validate import count_tool_calls, subagents_used, validate_draft
from properties.service import get_property

log = logging.getLogger(__name__)

PROVIDER_KEYS = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}


def default_cache_dir() -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or Path(__file__).resolve().parents[2] / "data"
    return Path(root) / "cache" / "noise_scout"


def _now() -> datetime:
    return datetime.now(UTC)


def missing_key() -> str | None:
    for model in (MAIN_MODEL, SUBAGENT_MODEL):
        env = PROVIDER_KEYS.get(model.split(":", 1)[0])
        if env and not os.environ.get(env):
            return env
    return None


def cached_result(sid: str, cache_dir: Path | None = None) -> NoiseScoutResult:
    path = (cache_dir or default_cache_dir()) / f"{sid}.json"
    if path.exists():
        return NoiseScoutResult.model_validate_json(path.read_text())
    return NoiseScoutResult(sid=sid, status="not_run", generated_at=_now())


def _files(state_files: dict | None) -> dict[str, str]:
    out = {}
    for path, data in (state_files or {}).items():
        content = data.get("content") if isinstance(data, dict) else data
        out[path] = "\n".join(content) if isinstance(content, list) else str(content)
    return out


def _trace(run_id: uuid.UUID) -> TraceInfo:
    project = os.environ.get("LANGSMITH_PROJECT")
    info = TraceInfo(project=project, run_id=str(run_id))
    if os.environ.get("LANGSMITH_TRACING", "").lower() != "true":
        return info
    try:
        from langchain_core.tracers.langchain import wait_for_all_tracers
        from langsmith import Client

        wait_for_all_tracers()
        client = Client()
        run = client.read_run(run_id)
        info.url = client.get_run_url(run=run, project_name=project)
    except Exception as exc:  # noqa: BLE001 - a missing trace link must not fail the report
        log.warning("LangSmith trace link unavailable: %s", exc)
    return info


def run_scout(sid: str, *, cache_dir: Path | None = None) -> NoiseScoutResult:
    cache_dir = cache_dir or default_cache_dir()
    if env := missing_key():
        return NoiseScoutResult(
            sid=sid,
            status="unavailable",
            generated_at=_now(),
            notes=[f"Noise Scout needs {env} in .env. The OpenStreetMap noise report still works."],
        )
    prop = get_property(sid)
    if prop.lat is None or prop.lon is None:
        return NoiseScoutResult(
            sid=sid, status="unavailable", generated_at=_now(), notes=["No geolocation."]
        )
    noise = get_noise_report(prop.lat, prop.lon, sid, "verified")
    facts = get_facts(sid)
    ctx = ScoutContext(
        sid=sid,
        address=prop.address,
        lat=prop.lat,
        lon=prop.lon,
        noise=noise,
        facts=[
            {"label": f.label, "value": f.value, "unit": f.unit, "provenance": f.provenance}
            for f in facts.facts
        ],
        cache_dir=cache_dir,
    )
    tools = build_tools(ctx)
    context_tools = [t for t in tools if t.name == "get_property_context"]
    research_tools = [t for t in tools if t.name != "get_property_context"]
    agent = build_agent(context_tools, research_tools)

    run_id = uuid.uuid4()
    try:
        state = agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": f"Research the noise around {prop.address} "
                        f"(lat {prop.lat}, lon {prop.lon}) for a musician who wants to "
                        "record and mix there.",
                    }
                ]
            },
            config={
                "run_id": run_id,
                "run_name": "noise-scout",
                "tags": ["reverb", "noise-scout", sid],
                "metadata": {"sid": sid, "address": prop.address},
                "recursion_limit": 120,
            },
        )
    except Exception as exc:  # noqa: BLE001 - surface agent failures; B1 report still renders
        return NoiseScoutResult(
            sid=sid,
            status="error",
            generated_at=_now(),
            model=MAIN_MODEL,
            subagent_model=SUBAGENT_MODEL,
            trace=_trace(run_id),
            notes=[f"Noise Scout failed: {type(exc).__name__}: {str(exc)[:300]}"],
        )

    raw = state.get("structured_response")
    draft = raw if isinstance(raw, ScoutDraft) else ScoutDraft.model_validate(raw)
    findings, rejected = validate_draft(draft, ctx.ledger)
    messages = state.get("messages", [])
    result = NoiseScoutResult(
        sid=sid,
        status="ok",
        generated_at=_now(),
        model=MAIN_MODEL,
        subagent_model=SUBAGENT_MODEL,
        summary=draft.summary,
        findings=findings,
        recording_advice=draft.recording_advice,
        data_gaps=draft.data_gaps,
        rejected=rejected,
        subagents_used=subagents_used(messages),
        tool_calls=count_tool_calls(messages),
        files=_files(state.get("files")),
        trace=_trace(run_id),
        notes=[
            "Written by an AI research agent from OpenStreetMap and CoStar data. Every finding "
            "links to the OpenStreetMap features it cites; claims without valid citations or "
            "with decibel levels were removed automatically.",
            "No noise was measured. Significance is a relative judgment.",
        ],
    )
    path = cache_dir / f"{sid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(result.model_dump_json(indent=1))
    return result
