import pytest

from noise.overpass import build_query, classify, parse
from tests.noise.conftest import SAMPLE_LAT, SAMPLE_LON


def way(id_, tags, coords):
    return {"type": "way", "id": id_, "tags": tags,
            "geometry": [{"lat": a, "lon": b} for a, b in coords]}  # fmt: skip


def node(id_, tags, lat, lon):
    return {"type": "node", "id": id_, "tags": tags, "lat": lat, "lon": lon}


def test_classify():
    assert classify({"highway": "primary"})[0].name == "road_major"
    assert classify({"highway": "motorway_link"})[0].name == "road_major"
    assert classify({"highway": "tertiary"})[0].name == "road_minor"
    assert classify({"highway": "residential"}) is None
    assert classify({"amenity": "bar"})[1] == "amenity=bar"
    assert classify({"aeroway": "helipad"})[0].name == "heliport"
    assert classify({"aeroway": "aerodrome"})[0].name == "airport"
    assert classify({"railway": "light_rail"})[0].name == "rail"
    assert classify({"railway": "abandoned"}) is None


def test_way_nearest_point_distance_and_url():
    # Primary road running east-west 0.0009 deg (~100.08 m) north of the origin.
    payload = {"elements": [way(7, {"highway": "primary", "name": "Main St"},
                                [(0.0009, -0.01), (0.0009, 0.01)])]}  # fmt: skip
    [s] = parse(payload, 0, 0)
    assert s.category == "road_major"
    assert s.subtype == "highway=primary"
    assert s.distance_m == pytest.approx(100.08, abs=0.05)
    assert s.bearing_compass == "N"
    assert s.osm_url == "https://www.openstreetmap.org/way/7"
    assert s.provenance == "verified"


def test_node_unnamed_and_coordless_skipped():
    payload = {"elements": [
        node(1, {"amenity": "bar"}, 0.001, 0),
        {"type": "way", "id": 2, "tags": {"amenity": "bar"}},  # no coordinates
        node(3, {"shop": "bakery"}, 0.001, 0),  # not a noise category
    ]}  # fmt: skip
    [s] = parse(payload, 0, 0)
    assert s.id == "node/1" and s.category == "venue" and s.name is None


def test_beyond_radius_dropped():
    # Bar ~556 m away; venue radius is 300 m.
    assert parse({"elements": [node(1, {"amenity": "bar"}, 0.005, 0)]}, 0, 0) == []


def test_dedupe_and_sort_and_merge_segments():
    payload = {"elements": [
        node(1, {"amenity": "pub"}, 0.002, 0),
        node(1, {"amenity": "pub"}, 0.002, 0),
        way(10, {"highway": "tertiary", "name": "Van Ness"}, [(0.0005, -1), (0.0005, 1)]),
        way(11, {"highway": "tertiary", "name": "Van Ness"}, [(0.001, -1), (0.001, 1)]),
        way(12, {"highway": "tertiary"}, [(0.0012, -1), (0.0012, 1)]),
    ]}  # fmt: skip
    out = parse(payload, 0, 0)
    assert [s.id for s in out] == ["way/10", "way/12", "node/1"]
    assert out[0].osm_ids == ["way/10", "way/11"]
    assert [s.distance_m for s in out] == sorted(s.distance_m for s in out)


def test_query_covers_every_category():
    q = build_query(1.5, 2.5)
    assert q.startswith("[out:json]")
    for key in ("aeroway", "railway", "highway", "amenity", "landuse", "man_made"):
        assert f'["{key}"' in q
    assert "(around:5000,1.5,2.5)" in q
    assert "out tags geom;" in q and "out tags center;" in q


def test_recorded_sample_property(overpass_sample):
    out = parse(overpass_sample, SAMPLE_LAT, SAMPLE_LON)
    names = {s.name for s in out}
    assert {"North Van Ness Avenue", "North Bronson Avenue", "Santa Monica Boulevard",
            "Hollywood Freeway"} <= names  # fmt: skip
    nearest = out[0]
    assert nearest.name == "North Bronson Avenue"
    assert nearest.bearing_compass == "W"
    assert 60 < nearest.distance_m < 90
    smb = next(s for s in out if s.name == "Santa Monica Boulevard")
    assert smb.category == "road_major" and smb.bearing_compass == "S"
    assert len(smb.osm_ids) > 1  # merged segments
    assert all(s.distance_m <= 5000 * 1.05 for s in out)
