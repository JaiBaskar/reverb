from fastapi.testclient import TestClient

from app.main import app
from costar import router

client = TestClient(app)


def test_not_shortlisted_404(monkeypatch):
    monkeypatch.setattr(router, "is_known", lambda sid: sid == "resSID")
    assert client.get("/properties/nope/facts").status_code == 404


def test_facts_shape(monkeypatch, kit, tmp_path):
    monkeypatch.setattr(router, "is_known", lambda sid: sid == "resSID")
    monkeypatch.setenv("COSTAR_KIT_DIR", str(kit))
    monkeypatch.setenv("REVERB_DATA_DIR", str(tmp_path))
    body = client.get("/properties/resSID/facts").json()
    assert body["sid"] == "resSID" and body["status"] == "ok"
    assert {f["key"] for f in body["facts"]} >= {"year_built", "ceiling_height_m"}
