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
    assert fetch.calls == 2  # one base query + one extra-categories query
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
    assert fetch.calls == 4


def test_cache_ignored_when_coordinates_change(tmp_path, overpass_sample):
    fetch = CountingFetcher(overpass_sample)
    get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=fetch)
    get_noise_report(2, 2, "s", cache_dir=tmp_path, fetcher=fetch)
    assert fetch.calls == 4


def test_failure_returns_error_report_and_is_not_cached(tmp_path):
    fetch = CountingFetcher(error=OverpassError("502 Bad Gateway"))
    r = get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=fetch)
    assert isinstance(r, NoiseReport)
    assert r.status == "error" and r.sources == [] and "502" in r.notes[0]
    assert not list(tmp_path.iterdir())


def test_cache_from_an_older_schema_is_refetched(tmp_path):
    import json

    from noise.service import SCHEMA_VERSION, get_noise_report

    calls = []

    def fetch(q):
        calls.append(q)
        return {"elements": []}

    first = get_noise_report(1.0, 2.0, "sid", cache_dir=tmp_path, fetcher=fetch)
    assert first.schema_version == SCHEMA_VERSION
    path = tmp_path / "sid.json"
    stale = json.loads(path.read_text())
    stale.pop("schema_version")  # what a cache written before geometry looked like
    path.write_text(json.dumps(stale))
    get_noise_report(1.0, 2.0, "sid", cache_dir=tmp_path, fetcher=fetch)
    assert len(calls) == 4
    get_noise_report(1.0, 2.0, "sid", cache_dir=tmp_path, fetcher=fetch)
    assert len(calls) == 4  # current schema is served from cache


def test_extra_categories_failing_keeps_base_and_marks_them_unavailable(tmp_path):
    from noise.categories import EXTRA_CATEGORIES

    def fetch(q):
        if "fire_station" in q:
            raise OverpassError("timeout")
        return {"elements": []}

    r = get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=fetch)
    assert r.status == "ok"
    assert not {e.category for e in r.exposure} & {c.name for c in EXTRA_CATEGORIES}
    assert any("unavailable" in n for n in r.notes)


def test_refresh_failure_serves_previous_cache_with_a_note(tmp_path):
    get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=CountingFetcher({"elements": []}))
    down = CountingFetcher(error=OverpassError("connection refused"))
    r = get_noise_report(1, 1, "s", cache_dir=tmp_path, fetcher=down, refresh=True)
    assert r.status == "ok"
    assert any("cached earlier" in n for n in r.notes)
