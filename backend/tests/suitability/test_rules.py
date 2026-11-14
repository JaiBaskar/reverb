import pytest

from suitability.service import assess
from tests.suitability.conftest import with_rt60

USE_CASES = {
    "vocal", "instrument", "production", "mixing", "critical_listening", "podcasting",
    "acoustic_guitar", "electric_guitar",
}  # fmt: skip


def fit(report, use_case):
    return next(f for f in assess(report).fits if f.use_case == use_case)


def test_all_use_cases_present(living_room):
    r = assess(living_room)
    assert {f.use_case for f in r.fits} == USE_CASES
    assert r.room_id == living_room.room_id


@pytest.mark.parametrize(
    ("mid", "level"),
    [(0.35, "good"), (0.40, "good"), (0.55, "workable"), (0.60, "workable"), (0.75, "poor")],
)
def test_vocal_rt60_bands(living_room, mid, level):
    # Living room is 77 m3 and 2.67 m high, so only RT60 decides.
    assert fit(with_rt60(living_room, mid), "vocal").level == level


def test_podcasting(living_room):
    assert fit(with_rt60(living_room, 0.25), "podcasting").level == "good"
    assert fit(with_rt60(living_room, 0.45), "podcasting").level == "workable"
    assert fit(with_rt60(living_room, 0.55), "podcasting").level == "poor"


def test_instrument_range_and_volume(living_room):
    assert fit(with_rt60(living_room, 0.45), "instrument").level == "good"  # 77 m3 >= 40
    assert fit(with_rt60(living_room, 0.25), "instrument").level == "workable"  # below 0.30
    small = living_room.model_copy(
        update={"geometry": living_room.geometry.model_copy(update={"volume_m3": 30.0})}
    )
    f = fit(with_rt60(small, 0.45), "instrument")
    assert f.level == "workable"
    assert any(c.id == "volume" and c.status == "caution" for c in f.checks)


def test_mixing_flags_modes_and_bass(living_room):
    f = fit(with_rt60(living_room, 0.3, low=0.75), "mixing")  # bass ratio 2.5 -> fail
    assert f.level == "poor"
    bass = next(c for c in f.checks if c.id == "bass_ratio")
    assert bass.status == "fail" and "2.5" in bass.reason


def test_critical_listening_uses_bs1116_target(living_room):
    # target for 77.07 m3 = 0.229 s
    assert (
        next(
            c
            for c in fit(with_rt60(living_room, 0.30), "critical_listening").checks
            if c.id == "rt60"
        ).status
        == "pass"
    )  # within 0.10 s
    assert (
        next(
            c
            for c in fit(with_rt60(living_room, 0.40), "critical_listening").checks
            if c.id == "rt60"
        ).status
        == "caution"
    )  # 0.17 s off
    assert (
        next(
            c
            for c in fit(with_rt60(living_room, 0.50), "critical_listening").checks
            if c.id == "rt60"
        ).status
        == "fail"
    )  # 0.27 s off


def test_overall_is_worst_check(living_room):
    for f in assess(living_room).fits:
        statuses = {c.status for c in f.checks}
        expected = "poor" if "fail" in statuses else "workable" if "caution" in statuses else "good"
        assert f.level == expected
        assert all(c.reason for c in f.checks)


def test_assumptions_and_no_db(living_room):
    r = assess(living_room)
    joined = " ".join(r.assumptions)
    assert "Hardwood floor" in joined  # material presets named
    assert any("noise" in m.lower() for m in r.missing)
    assert "dB" not in r.model_dump_json()


def test_estimated_geometry_is_listed(living_room):
    g = living_room.geometry
    h = g.height_m.model_copy(update={"provenance": "assumed", "note": "default 2.7 m"})
    rep = living_room.model_copy(update={"geometry": g.model_copy(update={"height_m": h})})
    assert any("height" in a and "assumed" in a for a in assess(rep).assumptions)


def test_shape_level_ignores_treatable_reverb(living_room):
    # Very reverberant but a well-sized room: poor as modeled, shape judged separately.
    f = fit(with_rt60(living_room, 1.9), "vocal")
    assert f.level == "poor"
    assert f.shape_level == "good"  # 77 m3, 2.67 m ceiling
    assert next(c for c in f.checks if c.id == "rt60").treatable is True
    assert next(c for c in f.checks if c.id == "volume").treatable is False


def test_shape_level_none_when_only_treatable_checks(living_room):
    assert fit(living_room, "podcasting").shape_level is None


def test_bass_ratio_reason_reads_cleanly(living_room):
    f = fit(with_rt60(living_room, 0.3, low=0.45), "mixing")
    reason = next(c for c in f.checks if c.id == "bass_ratio").reason
    assert reason.startswith("RT60 at 125 Hz is 1.50x the mid RT60")
