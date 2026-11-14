import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from properties import service, tour
from properties.normalize import normalize_rooms
from properties.tour import build_tour, chain_polygon, polygon_area

FIX = Path(__file__).parent / "fixtures"
RAW = json.loads((FIX / "matterport_zvKHR9DHNjJ.json").read_text())
GEOM = json.loads((FIX / "matterport_tour_zvKHR9DHNjJ.json").read_text())
SID = "zvKHR9DHNjJ"
LIVING = "cdz3fkt38kae7tapstpt0eaeb"
DINING_2 = "2qdmc5i9byxi79ry1pxdkqzea"  # boundary has a dangling wall edge
BATHROOM = "19ab05tns5h6y4qm42esqqpea"  # polygon but no tour sweeps
NO_BOUNDARY = "a5f9age4zzxewres6iqux2emc"  # no edges, one sweep


def _edge(a, b):
    return {"vertices": [{"id": a[0], "position": {"x": a[1], "y": a[2]}},
                         {"id": b[0], "position": {"x": b[1], "y": b[2]}}]}  # fmt: skip


def test_chain_polygon_square_any_edge_order_and_direction():
    a, b, c, d = ("a", 0, 0), ("b", 2, 0), ("c", 2, 1), ("d", 0, 1)
    poly = chain_polygon([_edge(c, b), _edge(a, b), _edge(d, a), _edge(c, d)])
    assert poly is not None and len(poly) == 4
    assert polygon_area(poly) == pytest.approx(2.0)


def test_chain_polygon_prunes_dangling_edge():
    a, b, c, d, e = ("a", 0, 0), ("b", 1, 0), ("c", 1, 1), ("d", 0, 1), ("e", 3, 3)
    poly = chain_polygon([_edge(a, b), _edge(b, c), _edge(c, d), _edge(d, a), _edge(c, e)])
    assert poly is not None and len(poly) == 4
    assert polygon_area(poly) == pytest.approx(1.0)


def test_chain_polygon_open_chain_or_empty_is_none():
    a, b, c = ("a", 0, 0), ("b", 1, 0), ("c", 1, 1)
    assert chain_polygon([_edge(a, b), _edge(b, c)]) is None
    assert chain_polygon([]) is None


@pytest.fixture
def layout():
    return build_tour(SID, GEOM, normalize_rooms(RAW["rooms"]))


def _room(layout, rid):
    return next(r for r in layout.rooms if r.room_id == rid)


def test_room_ids_match_reverb_rooms(layout):
    reverb_ids = {r["id"] for r in RAW["rooms"]}
    assert {r.room_id for r in layout.rooms} == reverb_ids


def test_living_room_polygon_and_sweeps_are_verified(layout):
    r = _room(layout, LIVING)
    assert r.polygon_provenance == "verified"
    # Wall-centreline polygon is slightly larger than Matterport's floor area (28.87 m2).
    assert polygon_area(r.polygon) == pytest.approx(29.74, abs=0.05)
    assert len(r.sweep_ids) == 5 and r.navigable
    assert r.entry_sweep_id in r.sweep_ids
    assert r.entry_sweep_provenance == "estimated"


def test_dangling_edge_room_still_gets_polygon(layout):
    r = _room(layout, DINING_2)
    assert r.polygon is not None and r.polygon_provenance == "verified"


def test_room_without_sweeps_is_not_navigable_and_says_why(layout):
    r = _room(layout, BATHROOM)
    assert r.polygon is not None
    assert not r.navigable and r.entry_sweep_id is None
    assert r.entry_sweep_provenance == "missing"
    assert any("no tour sweep" in i for i in r.issues)


def test_room_without_boundary_has_missing_polygon(layout):
    r = _room(layout, NO_BOUNDARY)
    assert r.polygon is None and r.polygon_provenance == "missing"
    assert r.navigable  # it has one sweep
    assert any("no wall boundary" in i for i in r.issues)


def test_sweeps_carry_room_and_sdk_ready_positions(layout):
    assert len(layout.sweeps) == 39
    s = next(s for s in layout.sweeps if s.id == "tgx6gn9g8wpqfq57gfammfqka")
    assert s.room_id == LIVING
    # Matterport model space (x, y, z-up); the Showcase SDK uses (x, z, -y).
    assert s.position == pytest.approx([0.00995, -0.01778, 0.02184], abs=1e-4)


def test_missing_geometry_payload_does_not_invent_rooms():
    out = build_tour(SID, {"id": SID, "rooms": [], "locations": None, "floors": None}, [])
    assert out.rooms == [] and out.sweeps == []


@pytest.fixture
def client(monkeypatch):
    from app import main

    monkeypatch.setattr(service, "shortlist_ids", lambda: [SID])
    monkeypatch.setattr(service, "fetch_model", lambda sid, **_: RAW)
    monkeypatch.setattr(tour, "fetch_tour_geometry", lambda sid, **_: GEOM)
    monkeypatch.setattr(main, "is_known", lambda sid: sid == SID)
    return TestClient(app)


def test_tour_endpoint(client):
    r = client.get(f"/properties/{SID}/tour")
    assert r.status_code == 200
    body = r.json()
    assert body["sid"] == SID and body["floors"][0]["index"] == 0
    living = next(x for x in body["rooms"] if x["room_id"] == LIVING)
    assert living["label"] == "Living Room" and living["usable"] is True
    assert "x, z, -y" in body["coordinate_note"]


def test_tour_endpoint_unknown_property_404(client):
    assert client.get("/properties/nope/tour").status_code == 404
