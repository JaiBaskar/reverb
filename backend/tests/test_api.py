import base64
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from scipy.io import wavfile

from app.main import app
from properties import service
from properties.matterport import MatterportError

RAW = json.loads((Path(__file__).parent / "fixtures" / "matterport_zvKHR9DHNjJ.json").read_text())
SID = "zvKHR9DHNjJ"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(service, "shortlist_ids", lambda: [SID])
    monkeypatch.setattr(service, "fetch_model", lambda sid, **_: RAW)
    from app import main

    monkeypatch.setattr(main, "is_known", lambda sid: sid == SID)
    return TestClient(app)


def room_id(client, label, usable=True):
    rooms = client.get(f"/properties/{SID}/rooms").json()
    return next(r["id"] for r in rooms if r["label"] == label and r["usable"] == usable)


def test_properties_lists_shortlist_with_numeric_coordinates(client):
    [p] = client.get("/properties").json()
    assert p["sid"] == SID
    assert isinstance(p["lat"], float) and isinstance(p["lon"], float)
    assert p["usable_room_count"] >= 2


def test_unknown_property_is_404(client):
    assert client.get("/properties/nope/rooms").status_code == 404


def test_analyze_returns_report_for_usable_room(client):
    r = client.post("/rooms/analyze", json={"sid": SID, "room_id": room_id(client, "Living Room")})
    assert r.status_code == 200
    body = r.json()
    assert len(body["rt60_s"]) == 6 and body["schroeder_hz"] > 0
    assert any("presets" in a for a in body["assumptions"])


def test_analyze_unusable_room_is_422_with_reason(client):
    r = client.post("/rooms/analyze", json={"sid": SID, "room_id": room_id(client, "Void", False)})
    assert r.status_code == 422
    assert "Void" in r.json()["detail"]


def test_analyze_unknown_room_is_404_and_unknown_material_is_422(client):
    assert client.post("/rooms/analyze", json={"sid": SID, "room_id": "x"}).status_code == 404
    rid = room_id(client, "Living Room")
    r = client.post(
        "/rooms/analyze", json={"sid": SID, "room_id": rid, "materials": {"floor": "lava"}}
    )
    assert r.status_code == 422


def test_ir_returns_decodable_48k_wav(client):
    r = client.post("/rooms/ir", json={"sid": SID, "room_id": room_id(client, "Bathroom")})
    assert r.status_code == 200
    rate, data = wavfile.read(io.BytesIO(base64.b64decode(r.json()["wav_base64"])))
    assert rate == 48000 and data.ndim == 1 and len(data) > 4800


def test_compare_returns_statements(client):
    a = {"sid": SID, "room_id": room_id(client, "Living Room")}
    b = {"sid": SID, "room_id": room_id(client, "Bathroom"), "materials": {"floor": "tile"}}
    r = client.post("/rooms/compare", json={"a": a, "b": b})
    assert r.status_code == 200
    assert r.json()["material_differences"][0]["surface"] == "floor"


def test_matterport_failure_is_502(client, monkeypatch):
    def boom(sid, **_):
        raise MatterportError("down")

    monkeypatch.setattr(service, "fetch_model", boom)
    assert client.get("/properties").status_code == 502
    assert client.get(f"/properties/{SID}/rooms").status_code == 502


def test_analyze_and_ir_accept_a_custom_room(client):
    body = {
        "sid": SID,
        "custom_room": {"label": "Den", "width_m": 4, "depth_m": 3.5, "height_m": 2.6},
    }
    r = client.post("/rooms/analyze", json=body)
    assert r.status_code == 200
    assert r.json()["geometry"]["width_m"]["provenance"] == "user"
    assert client.post("/rooms/ir", json=body).status_code == 200


def test_analyze_requires_exactly_one_room_source(client):
    assert client.post("/rooms/analyze", json={"sid": SID}).status_code == 422
    both = {
        "sid": SID,
        "room_id": "x",
        "custom_room": {"width_m": 4, "depth_m": 3, "height_m": 2.5},
    }
    assert client.post("/rooms/analyze", json=both).status_code == 422
    bad = {"sid": SID, "custom_room": {"width_m": 4, "depth_m": 3, "height_m": 0.5}}
    assert client.post("/rooms/analyze", json=bad).status_code == 422


def test_demo_pair_names_a_good_and_a_bad_room():
    from fastapi.testclient import TestClient as TC

    body = TC(app).get("/demo").json()
    assert {"good", "bad"} <= set(body)
    for side in ("good", "bad"):
        assert body[side]["sid"] and body[side]["room_id"] and body[side]["why"]
