import pytest

from noise.categories import BY_NAME
from noise.models import NoiseReport, NoiseSource
from noise.overpass import OverpassError
from noise.service import exposure_for, get_noise_report
from tests.noise.conftest import SAMPLE_LAT, SAMPLE_LON


def src(category, distance):
    return NoiseSource(id="way/1", category=category, subtype="x", name=None, lat=0, lon=0,
                       distance_m=distance, bearing_deg=0, bearing_compass="N",
                       osm_url="", osm_ids=["way/1"])  # fmt: skip


@pytest.mark.parametrize(
    ("distance", "level"),
    [(80, "high"), (100, "high"), (100.1, "moderate"), (250, "moderate"), (400, "low")],
)
def test_exposure_thresholds_major_road(distance, level):
    e = exposure_for(BY_NAME["road_major"], [src("road_major", distance), src("venue", 1)])
    assert e.level == level and e.count == 1 and e.nearest_m == distance


def test_exposure_none_found():
    e = exposure_for(BY_NAME["rail"], [])
    assert e.level == "none" and e.nearest_m is None and "500 m" in e.reason


class CountingFetcher:
    def __init__(self, payload=None, error=None):
        self.calls, self.payload, self.error = 0, payload, error

    def __call__(self, query):
        self.calls += 1
        if self.error:
            raise self.error
        return self.payload


def test_report_from_sample_and_cache(tmp_path, overpass_sample):
    fetch = CountingFetcher(overpass_sample)
    kw = {"cache_dir": tmp_path, "fetcher": fetch}
    r1 = get_noise_report(SAMPLE_LAT, SAMPLE_LON, "zvKHR9DHNjJ", "estimated", **kw)
    r2 = get_noise_report(SAMPLE_LAT, SAMPLE_LON, "zvKHR9DHNjJ", "estimated", **kw)
    assert fetch.calls == 1
    assert r1 == r2
    assert (tmp_path / "zvKHR9DHNjJ.json").exists()
    levels = {e.category: e.level for e in r1.exposure}
    assert levels["road_minor"] == "moderate"  # Bronson ~79 m, moderate within 100 m
    assert levels["road_major"] == "low"  # Santa Monica Blvd ~305 m
    assert levels["rail"] == "none"
    assert r1.status == "ok" and r1.location_provenance == "estimated"
    assert any("not decibels" in n for n in r1.notes)
    assert "dB" not in r1.model_dump_json().replace("decibels", "")
    get_noise_report(SAMPLE_LAT, SAMPLE_LON, "zvKHR9DHNjJ", refresh=True, **kw)
    assert fetch.calls == 2


def test_cache_ignored_when_coordinates_change(tmp_path, overpass_sample):
    fetch = CountingFetcher(overpass_sample)
    get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=fetch)
    get_noise_report(2, 2, "s", cache_dir=tmp_path, fetcher=fetch)
    assert fetch.calls == 2


def test_failure_returns_error_report_and_is_not_cached(tmp_path):
    fetch = CountingFetcher(error=OverpassError("502 Bad Gateway"))
    r = get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=fetch)
    assert isinstance(r, NoiseReport)
    assert r.status == "error" and r.sources == [] and "502" in r.notes[0]
    assert not list(tmp_path.iterdir())
