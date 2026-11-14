import pytest

from noise.categories import BY_NAME, CATEGORIES
from noise.models import NoiseSource
from noise.risk import INTENSITY, WHEN, assess_risk, proximity, sample_geometry


def src(category, distance, geometry=None, sid="way/1"):
    return NoiseSource(id=sid, category=category, subtype="x", name=None, lat=34.0, lon=-118.0,
                       distance_m=distance, bearing_deg=0, bearing_compass="N", osm_url="",
                       osm_ids=[sid], geometry=geometry)  # fmt: skip


def test_every_category_has_an_intensity_and_a_time_hint():
    for c in CATEGORIES:
        assert 0 < INTENSITY[c.name] <= 1
        assert WHEN[c.name]


def test_proximity_is_one_close_by_and_falls_with_distance():
    c = BY_NAME["road_major"]
    assert proximity(c, 0) == 1.0
    assert proximity(c, c.high_within_m) == 1.0
    assert proximity(c, c.moderate_within_m) == pytest.approx(0.5)
    assert proximity(c, c.radius_m) == pytest.approx(0.15)
    assert proximity(c, c.radius_m * 2) == pytest.approx(0.15)
    assert proximity(c, 150) > proximity(c, 300)


def test_ranking_puts_a_close_major_road_above_a_far_cafe():
    r = assess_risk([src("food_drink", 400, sid="node/2"), src("road_major", 60)])
    assert [s.id for s in r.ranked] == ["way/1", "node/2"]
    assert r.ranked[0].level == "high" and r.ranked[1].level == "low"
    assert "not a sound level" in " ".join(r.notes)


def test_line_geometry_is_sampled_into_weighted_heat_points():
    line = {"type": "LineString", "coordinates": [[-118.0, 34.0], [-118.0, 34.0027]]}  # ~300 m
    pts = sample_geometry(line, spacing_m=30)
    assert 10 <= len(pts) <= 12
    r = assess_risk([src("rail", 100, geometry=line)])
    feats = r.heat["features"]
    assert len(feats) == len(pts)
    assert all(f["properties"]["weight"] == pytest.approx(INTENSITY["rail"]) for f in feats)


def test_point_sources_without_geometry_use_their_nearest_point():
    r = assess_risk([src("emergency", 200)])
    [f] = r.heat["features"]
    assert f["geometry"]["coordinates"] == [-118.0, 34.0]
