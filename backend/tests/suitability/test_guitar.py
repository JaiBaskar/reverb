import json
from pathlib import Path

import pytest

from acoustics.report import Reflection
from suitability.metrics import hf_ratio, reflection_gap_ms
from suitability.service import assess
from tests.suitability.conftest import with_rt60

BANDS = [125, 250, 500, 1000, 2000, 4000]
CONTRACT = Path(__file__).parents[3] / "contract" / "fixtures"


def fit(report, use_case):
    return next(f for f in assess(report).fits if f.use_case == use_case)


def check(f, cid):
    return next(c for c in f.checks if c.id == cid)


def with_reflections(report, delays_ms: dict[str, float]):
    refl = [Reflection(surface=s, path_m=0.0, delay_ms=d) for s, d in delays_ms.items()]
    return report.model_copy(update={"early_reflections": refl})


def with_volume(report, v):
    return report.model_copy(
        update={"geometry": report.geometry.model_copy(update={"volume_m3": v})}
    )


# --- metrics -------------------------------------------------------------------------------


def test_hf_ratio_is_4k_over_mid():
    # mid = (0.5 + 0.5) / 2 = 0.5; 4 kHz 0.35 -> 0.7
    assert hf_ratio([0.9, 0.7, 0.5, 0.5, 0.45, 0.35], BANDS) == pytest.approx(0.7)


def test_reflection_gap_ignores_floor(living_room):
    rep = with_reflections(living_room, {"floor": 0.4, "ceiling": 2.5, "left wall": 4.0})
    assert reflection_gap_ms(rep.early_reflections) == pytest.approx(2.5)


def test_reflection_gap_none_without_non_floor_reflections(living_room):
    rep = with_reflections(living_room, {"floor": 0.4})
    assert reflection_gap_ms(rep.early_reflections) is None


# --- acoustic guitar -----------------------------------------------------------------------


def test_acoustic_guitar_checks_present(living_room):
    f = fit(living_room, "acoustic_guitar")
    assert f.label == "Acoustic guitar recording"
    assert {c.id for c in f.checks} == {"rt60", "volume", "hf_ratio", "mode_gap", "reflection_gap"}


def test_acoustic_guitar_rt60_and_volume_bands(living_room):
    flat = with_reflections(with_rt60(living_room, 0.45), {"ceiling": 4.0})
    # 77 m3 >= 30, flat RT60 so hf ratio 1.0, ceiling gap 4 ms >= 3, living-room modes gap 26 Hz.
    assert fit(flat, "acoustic_guitar").level == "good"
    assert check(fit(with_volume(flat, 20.0), "acoustic_guitar"), "volume").status == "caution"
    assert check(fit(with_volume(flat, 12.0), "acoustic_guitar"), "volume").status == "fail"
    assert check(fit(with_rt60(flat, 0.9), "acoustic_guitar"), "rt60").status == "fail"


def test_acoustic_guitar_dull_room_is_cautioned(living_room):
    rt = [0.5, 0.5, 0.5, 0.5, 0.4, 0.3]  # hf ratio 0.6
    f = fit(living_room.model_copy(update={"rt60_s": rt}), "acoustic_guitar")
    c = check(f, "hf_ratio")
    assert c.status == "caution" and c.treatable and "0.60" in c.reason


def test_acoustic_guitar_reflection_gap_bands(living_room):
    base = with_rt60(living_room, 0.45)
    for gap, status in [(3.0, "pass"), (2.0, "caution"), (1.0, "fail")]:
        f = fit(with_reflections(base, {"floor": 0.2, "back wall": gap}), "acoustic_guitar")
        c = check(f, "reflection_gap")
        assert c.status == status and not c.treatable
        assert "floor" in c.reason  # says the floor bounce is excluded


# --- electric guitar -----------------------------------------------------------------------


def test_electric_guitar_checks_present(living_room):
    f = fit(living_room, "electric_guitar")
    assert f.label == "Electric guitar amp recording"
    assert {c.id for c in f.checks} == {
        "rt60", "volume", "mode_gap", "coincident_modes", "bass_ratio",
    }  # fmt: skip


def test_electric_guitar_tolerates_short_rt60_and_small_rooms(living_room):
    dead_small = with_volume(with_rt60(living_room, 0.15, low=0.15), 13.0)
    f = fit(dead_small, "electric_guitar")
    assert check(f, "rt60").status == "pass"
    assert check(f, "volume").status == "pass"
    # whereas acoustic guitar wants some decay and more air
    a = fit(dead_small, "acoustic_guitar")
    assert check(a, "rt60").status == "fail" and check(a, "volume").status == "fail"


def test_electric_guitar_flags_bass_ratio(living_room):
    f = fit(with_rt60(living_room, 0.4, low=0.9), "electric_guitar")  # ratio 2.25
    assert check(f, "bass_ratio").status == "fail" and f.level == "poor"


def test_guitar_shape_level_ignores_treatable_checks(living_room):
    # RT60 fails as modeled (empty hard room), but shape-only checks ignore it.
    f = fit(with_rt60(living_room, 2.0), "electric_guitar")
    assert f.level == "poor"
    assert f.shape_level in ("good", "workable")


# --- existing use cases unchanged --------------------------------------------------------


def test_existing_six_use_cases_match_contract_fixture(living_room):
    expected = json.loads((CONTRACT / "suitability_zvKHR9DHNjJ_living_room.json").read_text())
    got = assess(living_room).model_dump(mode="json")
    old = {f["use_case"]: f for f in expected["fits"]}
    new = {f["use_case"]: f for f in got["fits"] if f["use_case"] in old}
    assert new == old
