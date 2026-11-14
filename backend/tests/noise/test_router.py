import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from noise import overpass, router
from noise.models import NoiseReport
from properties.matterport import MatterportError
from properties.models import Property

PROPS = Path(__file__).parents[3] / "contract" / "fixtures" / "properties.json"


@pytest.fixture
def props() -> dict[str, Property]:
    return {p["sid"]: Property(**p) for p in json.loads(PROPS.read_text())}


@pytest.fixture
def client(tmp_path, monkeypatch, overpass_sample, props):
    monkeypatch.setenv("REVERB_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(router, "shortlist_ids", lambda: list(props))
    monkeypatch.setattr(router, "get_property", lambda sid: props[sid])
    real_fetch = overpass.fetch
    mock = httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=overpass_sample))
    )
    monkeypatch.setattr(overpass, "fetch", lambda q, client=None: real_fetch(q, mock))
    return TestClient(app)


def test_sample_property(client):
    resp = client.get("/properties/zvKHR9DHNjJ/noise")
    assert resp.status_code == 200
    report = NoiseReport.model_validate(resp.json())
    assert report.sid == "zvKHR9DHNjJ"
    assert (report.lat, report.lon) == (34.0934917, -118.3171)
    assert report.location_provenance == "verified"
    assert report.sources[0].name == "North Bronson Avenue"


def test_not_shortlisted_404(client):
    assert client.get("/properties/nope/noise").status_code == 404


def test_missing_geolocation_422(client, props, monkeypatch):
    p = props["zvKHR9DHNjJ"].model_copy(update={"lat": None})
    monkeypatch.setattr(router, "get_property", lambda sid: p)
    assert client.get("/properties/zvKHR9DHNjJ/noise").status_code == 422


def test_matterport_failure_502(client, monkeypatch):
    def boom(sid):
        raise MatterportError("down")

    monkeypatch.setattr(router, "get_property", boom)
    assert client.get("/properties/zvKHR9DHNjJ/noise").status_code == 502


def test_fetch_falls_back_to_next_endpoint(overpass_sample):
    hits = []

    def handler(request):
        hits.append(str(request.url))
        if len(hits) == 1:
            return httpx.Response(502)
        return httpx.Response(200, json=overpass_sample)

    with httpx.Client(transport=httpx.MockTransport(handler)) as c:
        assert overpass.fetch("q", c) == overpass_sample
    assert hits == list(overpass.ENDPOINTS[:2])


def test_fetch_all_fail_raises():
    transport = httpx.MockTransport(lambda r: httpx.Response(429))
    with httpx.Client(transport=transport) as c, pytest.raises(overpass.OverpassError):
        overpass.fetch("q", c)
