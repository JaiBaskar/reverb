from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from roomintel import agents, inspector

WALLS = {
    "walls": [
        {
            "image": "W0",
            "material_id": "painted_drywall",
            "finish": "paint",
            "confidence": 0.4,
            "features": [],
        }
    ],
    "surfaces": [],
    "notes": [],
}


@pytest.fixture
def fake_vision(monkeypatch):
    calls = []

    def run_agent(name, schema, prompt, images, cache, use_cache=True):
        calls.append((name, prompt, use_cache))
        answer = WALLS if name == "walls" else {"pieces": [], "hazards": [], "notes": []}
        return agents.AgentRun(
            agent=name, status="ok", model="fake:vision", seconds=1.0, answer=answer
        )

    monkeypatch.setattr(agents, "run_agent", run_agent)
    monkeypatch.setattr(agents, "model_name", lambda: ("fake:vision", None))
    monkeypatch.setattr(inspector, "coordinator_model", lambda: "fake:coordinator")
    return calls


def jobs():
    img = {"W0": Path("w0.jpg")}
    return {
        n: (agents.WallsReport, f"{n} prompt", img, Path(f"{n}.json"))
        for n in ("walls", "furniture", "surroundings")
    }


def test_coordinator_delegates_rechecks_and_its_numbers_are_dropped(fake_vision):
    def factory(model, jobs_, context, results, rechecks):
        subs = {n: inspector._specialist(n, j, results, rechecks) for n, j in jobs_.items()}

        class Coordinator:
            def invoke(self, _):
                replies = [
                    subs[n].invoke({"messages": [HumanMessage(content="Living room")]})
                    for n in subs
                ]
                assert "W0: painted_drywall" in replies[0]["messages"][-1].content
                subs["walls"].invoke(
                    {"messages": [HumanMessage(content="Look again at W0: is it brick?")]}
                )
                draft = inspector.InspectionDraft(
                    summary="Painted drywall room with a fabric sofa.",
                    cross_checks=["W0 confidence was low; rechecked", "Reverb is about 0.6 s"],
                    gaps=["Ceiling not visible"],
                )
                return {"structured_response": draft}

        return Coordinator()

    results, ins = inspector.inspect(jobs(), {"label": "Living room"}, agent_factory=factory)
    assert ins.orchestrator == "deepagents" and ins.coordinator_model == "fake:coordinator"
    assert set(results) == {"walls", "furniture", "surroundings"}
    assert ins.cross_checks == [
        "W0 confidence was low; rechecked"
    ]  # the acoustic number is dropped
    assert ins.rechecked and "brick" in ins.rechecked[0]
    second = [c for c in fake_vision if c[0] == "walls"][1]
    assert "Look again at W0" in second[1] and second[2] is False  # fresh call with the focus note


def test_coordinator_failure_falls_back_to_running_the_specialists(fake_vision):
    def factory(*a):
        raise RuntimeError("rate limited")

    results, ins = inspector.inspect(jobs(), {"label": "x"}, agent_factory=factory)
    assert ins.orchestrator == "direct" and "rate limited" in ins.reason
    assert all(r.status == "ok" for r in results.values())


def test_no_imagery_skips_the_coordinator(fake_vision):
    empty = {n: (s, p, {}, c) for n, (s, p, _, c) in jobs().items()}
    _, ins = inspector.inspect(
        empty, {}, agent_factory=lambda *a: pytest.fail("coordinator must not run")
    )
    assert ins.orchestrator == "direct" and ins.reason == "No imagery of this room."


def test_the_deep_agent_has_the_three_vision_subagents(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    agent = inspector.build_agent("anthropic:claude-haiku-5-5", jobs(), {"label": "x"}, {}, [])
    assert agent.name == "room-inspector"
    task = agent.get_graph().nodes  # compiled: the tools node carries `task` and get_room_context
    assert task
