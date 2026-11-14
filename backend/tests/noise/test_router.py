import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from noise import overpass
from noise.models import NoiseReport
from noise.router import router


@pytest.fixture
def client(tmp_path, monkeypatch, overpass_sample):
    monkeypatch.setenv("REVERB_DATA_DIR", str(tmp_path))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=overpass_sample)

    real_fetch = overpass.fetch
    mock = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(overpass, "fetch", lambda q, client=None: real_fetch(q, mock))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_sample_property(client):
    resp = client.get("/properties/zvKHR9DHNjJ/noise")
    assert resp.status_code == 200
    report = NoiseReport.model_validate(resp.json())
    assert report.sid == "zvKHR9DHNjJ"
    assert report.location_provenance == "verified"
    assert report.sources[0].name == "North Bronson Avenue"


def test_explicit_coordinates_are_verified(client):
    resp = client.get(
        "/properties/other/noise", params={"lat": 34.0936779, "lon": -118.316589}
    )
    assert resp.status_code == 200
    assert resp.json()["location_provenance"] == "verified"


def test_unknown_property_404(client):
    assert client.get("/properties/nope/noise").status_code == 404


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
    with (
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))) as c,
        pytest.raises(overpass.OverpassError),
    ):
        overpass.fetch("q", c)
