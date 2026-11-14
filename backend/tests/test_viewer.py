import pytest
from fastapi.testclient import TestClient

from app.main import app
from properties import viewer
from properties.matterport import MatterportError


def model(visibility="public", state="active", published=True):
    return {"id": "abc", "visibility": visibility, "state": state,
            "publication": {"published": published, "url": "https://my.matterport.com/show/?m=abc"}}  # fmt: skip


def test_public_active_published_scan_is_embeddable():
    v = viewer.viewer_from_model("abc", model())
    assert v.available and v.reason is None
    assert v.embed_url.startswith("https://my.matterport.com/show/?m=abc")
    assert "applicationKey" not in v.embed_url  # it stalls Showcase on localhost


def test_unlisted_scan_is_embeddable():
    assert viewer.viewer_from_model("abc", model(visibility="unlisted")).available


@pytest.mark.parametrize(
    ("kw", "word"),
    [
        ({"visibility": "private"}, "private"),
        ({"state": "inactive"}, "inactive"),
        ({"published": False}, "not published"),
    ],
)
def test_scans_that_cannot_be_viewed_say_why(kw, word):
    v = viewer.viewer_from_model("abc", model(**kw))
    assert not v.available and v.embed_url is None and word in v.reason


def test_status_is_cached(tmp_path):
    calls = []

    def fetch(sid):
        calls.append(sid)
        return model()

    viewer.get_viewer("abc", cache_dir=tmp_path, fetcher=fetch)
    viewer.get_viewer("abc", cache_dir=tmp_path, fetcher=fetch)
    assert calls == ["abc"]


def test_endpoint_404_for_unknown_and_reports_matterport_failure(monkeypatch):
    from properties import router as vr

    monkeypatch.setattr(vr, "is_known", lambda sid: sid == "abc")

    def boom(sid):
        raise MatterportError("down")

    monkeypatch.setattr(vr, "get_viewer", lambda sid: boom(sid))
    c = TestClient(app)
    assert c.get("/properties/nope/viewer").status_code == 404
    r = c.get("/properties/abc/viewer")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and "down" in body["reason"]
