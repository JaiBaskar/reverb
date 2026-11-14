from treatment import photoreal


def test_unavailable_without_a_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    st = photoreal.status()
    assert not st.available and "OPENROUTER_API_KEY" in st.reason


def test_rejects_non_image_inputs():
    assert not photoreal._data_uri_ok("https://example.com/x.jpg")
    assert photoreal._data_uri_ok("data:image/jpeg;base64,/9j/4AAQ")


def test_endpoint_reports_503_without_key(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    c = TestClient(app)
    assert c.get("/visualize/status").json()["available"] is False
    r = c.post(
        "/visualize/photoreal",
        json={
            "sid": "x",
            "room_id": "y",
            "before": "data:image/jpeg;base64,AA",
            "render": "data:image/jpeg;base64,AA",
        },
    )
    assert r.status_code == 503
