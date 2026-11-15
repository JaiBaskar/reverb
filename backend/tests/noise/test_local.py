import osmium
import pytest

from noise import local, overpass
from noise.service import get_noise_report

LAT, LON = 34.0935, -118.3171


@pytest.fixture
def region(tmp_path, monkeypatch):
    """A tiny extract: a primary road 170 m north, a cafe next door, an untagged way, a road
    outside the region box."""
    monkeypatch.setenv("REVERB_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        local, "REGIONS", {"test": {"pbf": "test.osm.pbf", "bbox": (34.0, -118.4, 34.2, -118.2)}}
    )
    (tmp_path / "osm").mkdir()
    pbf = tmp_path / "osm" / "test.osm.pbf"
    w = osmium.SimpleWriter(str(pbf))
    nodes = {
        1: (34.0950, -118.3300),
        2: (34.0950, -118.3100),
        3: (34.09, -118.32),
        4: (34.091, -118.321),
        5: (35.0, -119.0),
        6: (35.01, -119.0),
    }
    for nid, (la, lo) in nodes.items():
        w.add_node(osmium.osm.mutable.Node(id=nid, location=(lo, la), tags={}))
    w.add_node(
        osmium.osm.mutable.Node(id=10, location=(-118.3172, 34.0936), tags={"amenity": "cafe"})
    )
    w.add_way(
        osmium.osm.mutable.Way(
            id=100, nodes=[1, 2], tags={"highway": "primary", "name": "Sunset Blvd"}
        )
    )
    w.add_way(osmium.osm.mutable.Way(id=101, nodes=[3, 4], tags={"highway": "footway"}))
    w.add_way(osmium.osm.mutable.Way(id=102, nodes=[5, 6], tags={"highway": "primary"}))
    w.close()
    return local.build_region("test")


def test_build_keeps_only_noise_sources_inside_the_region(region):
    assert region["counts"] == {"road_major": 1, "food_drink": 1}


def test_report_comes_from_the_local_index_without_overpass(region, tmp_path, monkeypatch):
    def no_network(*a, **k):
        raise AssertionError("Overpass must not be called")

    monkeypatch.setattr(overpass, "fetch", no_network)
    rep = get_noise_report(LAT, LON, "sid1", cache_dir=tmp_path / "cache")
    ids = {s.id for s in rep.sources}
    assert ids == {"way/100", "node/10"}
    road = next(s for s in rep.sources if s.id == "way/100")
    assert 150 < road.distance_m < 190 and road.bearing_compass == "N"
    assert road.geometry["type"] == "LineString"
    assert any("local OpenStreetMap extract (test.osm.pbf" in n for n in rep.notes)


def test_points_outside_every_region_fall_back_to_overpass(region, tmp_path):
    assert local.payload_near(40.7, -74.0) is None


def test_multipolygon_airports_are_indexed_with_a_centre(tmp_path, monkeypatch):
    monkeypatch.setenv("REVERB_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        local, "REGIONS", {"test": {"pbf": "a.osm.pbf", "bbox": (34.0, -118.4, 34.2, -118.2)}}
    )
    (tmp_path / "osm").mkdir()
    w = osmium.SimpleWriter(str(tmp_path / "osm" / "a.osm.pbf"))
    ring = [(34.10, -118.30), (34.10, -118.28), (34.12, -118.28), (34.12, -118.30)]
    for k, (la, lo) in enumerate(ring, start=1):
        w.add_node(osmium.osm.mutable.Node(id=k, location=(lo, la), tags={}))
    w.add_way(osmium.osm.mutable.Way(id=50, nodes=[1, 2, 3, 4, 1], tags={}))
    w.add_relation(
        osmium.osm.mutable.Relation(
            id=7,
            members=[("w", 50, "outer")],
            tags={"type": "multipolygon", "aeroway": "aerodrome", "name": "Test Field"},
        )
    )
    w.close()
    assert local.build_region("test")["counts"] == {"airport": 1}
    payload, _ = local.payload_near(34.09, -118.29)
    (el,) = payload["elements"]
    assert el["type"] == "relation" and el["id"] == 7
    assert el["center"]["lat"] == pytest.approx(34.11, abs=0.006)
