import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from acoustics import router as arouter
from app import main
from app.main import app
from properties import service, tour

FIX = Path(__file__).parent / "fixtures"
SID = "zvKHR9DHNjJ"
RAW = json.loads((FIX / f"matterport_{SID}.json").read_text())
GEOM = json.loads((FIX / f"matterport_tour_{SID}.json").read_text())


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(service, "shortlist_ids", lambda: [SID])
    monkeypatch.setattr(service, "fetch_model", lambda sid, **_: RAW)
    monkeypatch.setattr(tour, "fetch_tour_geometry", lambda sid, **_: GEOM)
    monkeypatch.setattr(main, "is_known", lambda sid: sid == SID)
    monkeypatch.setattr(arouter, "is_known", lambda sid: sid == SID)
    return TestClient(app)


def test_house_insights_cover_every_usable_room_with_an_outline(client):
    body = client.get(f"/properties/{SID}/insights").json()
    assert body["rooms"]
    living = next(r for r in body["rooms"] if r["label"] == "Living Room")
    f = living["field"]
    assert len(f["c50_db"]) == f["nx"] * f["ny"]
    assert living["report"]["geometry"]["wall_source"] == "outline"
    assert living["report"]["furniture"] and living["advice"]


def test_empty_house_has_longer_reverb_than_furnished(client):
    furn = client.get(f"/properties/{SID}/insights").json()["rooms"][0]
    empty = client.get(f"/properties/{SID}/insights?furnished=false").json()["rooms"][0]
    assert empty["report"]["rt60_s"][2] > furn["report"]["rt60_s"][2]


def test_room_insight_moves_the_source(client):
    living = next(
        r
        for r in client.get(f"/properties/{SID}/insights").json()["rooms"]
        if r["label"] == "Living Room"
    )
    x, y = living["field"]["best_spot"]
    r = client.post(
        "/rooms/insight", json={"sid": SID, "room_id": living["room_id"], "source": [x, y]}
    )
    assert r.status_code == 200 and r.json()["field"]["source"] == [x, y]


def test_analyze_accepts_furniture_and_rejects_unknown_items(client):
    rooms = client.get(f"/properties/{SID}/rooms").json()
    rid = next(r["id"] for r in rooms if r["label"] == "Living Room" and r["usable"])
    ok = client.post(
        "/rooms/analyze", json={"sid": SID, "room_id": rid, "furnished": True, "use_outline": True}
    )
    assert ok.status_code == 200 and ok.json()["furniture"]
    bad = client.post(
        "/rooms/analyze", json={"sid": SID, "room_id": rid, "furniture": [{"id": "x"}]}
    )
    assert bad.status_code == 422
