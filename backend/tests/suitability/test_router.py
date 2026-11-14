from fastapi.testclient import TestClient

from app.main import app
from suitability.models import SuitabilityReport

client = TestClient(app)


def test_post_report(living_room):
    resp = client.post("/suitability", json=living_room.model_dump(mode="json"))
    assert resp.status_code == 200
    r = SuitabilityReport.model_validate(resp.json())
    assert len(r.fits) == 6


def test_malformed_body_422():
    assert client.post("/suitability", json={"rt60_s": [1]}).status_code == 422
