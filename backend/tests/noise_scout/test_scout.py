import json
from pathlib import Path

import pytest

from noise.models import NoiseReport
from noise_scout.models import DraftFinding, ScoutDraft
from noise_scout.tools import EvidenceLedger, ScoutContext, build_tools
from noise_scout.validate import subagents_used, validate_draft

FIXTURE = (
    Path(__file__).resolve().parents[3] / "contract" / "fixtures" / "noise_report_zvKHR9DHNjJ.json"
)


@pytest.fixture
def report() -> NoiseReport:
    return NoiseReport.model_validate_json(FIXTURE.read_text())


@pytest.fixture
def ctx(report, tmp_path):
    overpass_calls = []

    def fake_overpass(query: str) -> dict:
        overpass_calls.append(query)
        return {
            "elements": [
                {
                    "type": "node",
                    "id": 1,
                    "lat": report.lat + 0.001,
                    "lon": report.lon,
                    "tags": {"amenity": "fire_station", "name": "Station 27"},
                },
                {
                    "type": "way",
                    "id": 2,
                    "center": {"lat": report.lat + 0.01, "lon": report.lon},
                    "tags": {"amenity": "fire_station"},
                },
            ]
        }

    def fake_osm(osm_id: str) -> dict:
        return {"highway": "primary", "maxspeed": "35 mph", "lanes": "4"}

    c = ScoutContext(
        sid="zvKHR9DHNjJ",
        address="5836 La Mirada Ave",
        lat=report.lat,
        lon=report.lon,
        noise=report,
        facts=[{"label": "Year built", "value": 1925, "provenance": "verified"}],
        ledger=EvidenceLedger(),
        overpass=fake_overpass,
        osm_tags=fake_osm,
        cache_dir=tmp_path,
    )
    c.overpass_calls = overpass_calls
    return c


def tool(tools, name):
    return next(t for t in tools if t.name == name)


def test_list_noise_sources_returns_b1_sources_and_records_evidence(ctx, report):
    cat = report.sources[0].category
    out = json.loads(tool(build_tools(ctx), "list_noise_sources").invoke({"category": cat}))
    assert out and all(s["category"] == cat for s in out)
    first = out[0]
    assert ctx.ledger.get(first["id"]).distance_m == first["distance_m"]


def test_list_noise_sources_rejects_unknown_category(ctx):
    out = tool(build_tools(ctx), "list_noise_sources").invoke({"category": "volcano"})
    assert "Unknown category" in out


def test_get_osm_tags_only_for_ids_already_returned(ctx, report):
    tools = build_tools(ctx)
    unknown = tool(tools, "get_osm_tags").invoke({"osm_id": "way/999999999"})
    assert "not returned by" in unknown
    sid = report.sources[0].id
    tool(tools, "list_noise_sources").invoke({"category": report.sources[0].category})
    tags = json.loads(tool(tools, "get_osm_tags").invoke({"osm_id": sid}))
    assert tags["maxspeed"] == "35 mph"
    assert ctx.ledger.get(sid).tags["maxspeed"] == "35 mph"


def test_search_nearby_computes_distance_and_caches(ctx):
    tools = build_tools(ctx)
    out = json.loads(tool(tools, "search_nearby").invoke({"kind": "fire_station"}))["results"]
    assert [s["id"] for s in out] == ["node/1", "way/2"]  # nearest first
    assert 100 < out[0]["distance_m"] < 125  # 0.001 deg latitude ~ 111 m
    assert out[0]["bearing_compass"] == "N"
    assert ctx.ledger.get("node/1").name == "Station 27"
    tool(tools, "search_nearby").invoke({"kind": "fire_station"})
    assert len(ctx.overpass_calls) == 1  # second call served from cache


def test_search_nearby_rejects_unknown_kind(ctx):
    assert "Unknown kind" in tool(build_tools(ctx), "search_nearby").invoke({"kind": "x"})


def test_property_context_states_orientation_unknown(ctx):
    out = json.loads(tool(build_tools(ctx), "get_property_context").invoke({}))
    assert out["address"] == "5836 La Mirada Ave"
    assert any("orientation" in n for n in out["notes"])


def _draft(*findings):
    return ScoutDraft(summary="s", findings=list(findings), recording_advice=[], data_gaps=[])


def test_validate_keeps_cited_findings_and_attaches_tool_distances(ctx, report):
    tool(build_tools(ctx), "list_noise_sources").invoke({"category": report.sources[0].category})
    src = report.sources[0]
    ok = DraftFinding(
        title="Road",
        detail="Busy road nearby.",
        category=src.category,
        significance="high",
        evidence=[src.id],
    )
    findings, rejected = validate_draft(_draft(ok), ctx.ledger)
    assert len(findings) == 1 and not rejected
    assert findings[0].evidence[0].distance_m == src.distance_m
    assert findings[0].evidence[0].osm_url == src.osm_url


def test_validate_rejects_uncited_unknown_and_decibel_claims(ctx, report):
    tool(build_tools(ctx), "list_noise_sources").invoke({"category": report.sources[0].category})
    src = report.sources[0]
    uncited = DraftFinding(title="A", detail="x", category="other", significance="low", evidence=[])
    invented = DraftFinding(
        title="B", detail="x", category="other", significance="low", evidence=["way/1"]
    )
    decibels = DraftFinding(
        title="C",
        detail="Expect about 65 dB at the facade.",
        category=src.category,
        significance="high",
        evidence=[src.id],
    )
    findings, rejected = validate_draft(_draft(uncited, invented, decibels), ctx.ledger)
    assert findings == []
    reasons = " ".join(r.reason for r in rejected)
    assert "no evidence" in reasons and "not returned by any tool" in reasons
    assert "decibel" in reasons


def test_validate_drops_advice_with_decibels():
    draft = ScoutDraft(
        summary="s",
        findings=[],
        data_gaps=[],
        recording_advice=["Record after 10 pm.", "Traffic is 70 dBA."],
    )
    _findings, rejected = validate_draft(draft, EvidenceLedger())
    assert draft.recording_advice == ["Record after 10 pm."]
    assert any("advice" in r.title.lower() for r in rejected)


def test_subagents_used_reads_task_tool_calls():
    from langchain_core.messages import AIMessage

    msgs = [
        AIMessage(
            content="",
            tool_calls=[
                {"name": "task", "args": {"subagent_type": "transport-analyst"}, "id": "1"},
                {
                    "name": "task",
                    "args": {"subagent_type": "aviation-industrial-analyst"},
                    "id": "2",
                },
                {"name": "write_file", "args": {}, "id": "3"},
            ],
        )
    ]
    assert subagents_used(msgs) == ["aviation-industrial-analyst", "transport-analyst"]


def test_run_scout_without_key_is_unavailable_not_an_error(monkeypatch, tmp_path):
    import noise_scout.service as svc

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    result = svc.run_scout("zvKHR9DHNjJ", cache_dir=tmp_path)
    assert result.status == "unavailable"
    assert "API_KEY" in result.notes[0]


def test_cached_result_is_not_run_when_missing(tmp_path):
    from noise_scout.service import cached_result

    assert cached_result("abc", cache_dir=tmp_path).status == "not_run"


def test_agent_builds_with_three_subagents():
    from noise_scout.agent import build_agent

    report = NoiseReport.model_validate_json(FIXTURE.read_text())
    ctx = ScoutContext(
        sid="s",
        address="a",
        lat=report.lat,
        lon=report.lon,
        noise=report,
        facts=[],
        cache_dir=Path("/tmp"),
    )
    tools = build_tools(ctx)
    agent = build_agent(tools[:1], tools[1:])
    assert agent is not None


def test_models_prefer_openrouter_when_its_key_is_set(monkeypatch):
    from noise_scout.agent import models

    monkeypatch.delenv("NOISE_SCOUT_MODEL", raising=False)
    monkeypatch.delenv("NOISE_SCOUT_SUBAGENT_MODEL", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "x")
    assert models() == (
        "openrouter:anthropic/claude-sonnet-5.5",
        "openrouter:anthropic/claude-haiku-5.5",
    )
    monkeypatch.delenv("OPENROUTER_API_KEY")
    assert models()[0].startswith("anthropic:")
    monkeypatch.setenv("NOISE_SCOUT_MODEL", "openrouter:some/model")
    assert models()[0] == "openrouter:some/model"


def test_risk_ranking_tool_orders_by_risk_and_records_evidence(ctx):
    out = json.loads(tool(build_tools(ctx), "get_risk_ranking").invoke({"limit": 5}))
    assert 0 < len(out) <= 5
    risks = [r["risk"] for r in out]
    assert risks == sorted(risks, reverse=True)
    assert all(r["id"] in ctx.ledger for r in out)  # citable in findings
    assert all("dB" not in json.dumps(r) for r in out)
