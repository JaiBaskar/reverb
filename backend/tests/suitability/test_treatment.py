import math

import pytest

from suitability.compare import compare_fits
from suitability.service import assess
from suitability.treatment import PANEL_ALPHA, PANEL_AREA_M2, treatment
from tests.suitability.conftest import with_rt60


def fit(report, use_case):
    return next(f for f in assess(report).fits if f.use_case == use_case)


def test_treatment_hand_calculation(living_room):
    # 77.07 m3 at mid RT60 1.0 s; vocal target <= 0.40 s.
    rep = with_rt60(living_room, 1.0)
    t = treatment(rep, (None, 0.40))
    v = rep.geometry.volume_m3
    a_now = 0.161 * v / 1.0
    a_need = 0.161 * v / 0.40
    s = rep.surfaces.floor_m2 + rep.surfaces.ceiling_m2 + rep.surfaces.walls_m2
    area = (a_need - a_now) / (PANEL_ALPHA - a_now / s)
    assert t.verdict == "add_absorption"
    assert t.added_sabins == pytest.approx(a_need - a_now)
    assert t.panel_area_m2 == pytest.approx(area)
    assert t.panels == math.ceil(area / PANEL_AREA_M2)


def test_no_treatment_needed_when_already_in_range(living_room):
    t = treatment(with_rt60(living_room, 0.35), (None, 0.40))
    assert t.verdict == "none_needed" and t.panels == 0


def test_too_dead_room(living_room):
    t = treatment(with_rt60(living_room, 0.15), (0.30, 0.60))
    assert t.verdict == "too_dead" and t.panels == 0


def test_impractical_when_panels_would_cover_most_surfaces(living_room):
    t = treatment(with_rt60(living_room, 4.0), (None, 0.20))
    assert t.verdict == "impractical"


def test_fit_has_treatment_and_potential(living_room):
    f = fit(with_rt60(living_room, 1.2), "vocal")
    assert f.level == "poor"  # empty room as modeled
    assert f.treatment is not None and f.treatment.verdict == "add_absorption"
    assert f.potential_level == "good"  # shape is good, treatment is practical


def test_potential_is_capped_by_shape(living_room):
    small = living_room.model_copy(
        update={"geometry": living_room.geometry.model_copy(update={"volume_m3": 30.0})}
    )
    f = fit(with_rt60(small, 1.2), "instrument")  # 30 m3 is only workable for instruments
    assert f.potential_level == "workable"


def test_compare_prefers_better_potential_then_less_treatment(living_room):
    a = assess(with_rt60(living_room, 1.2))
    b = assess(with_rt60(living_room, 0.6))
    verdicts = {v.use_case: v for v in compare_fits(a, b)}
    vocal = verdicts["vocal"]
    assert vocal.better == "B"  # same shape, B needs fewer panels
    assert "panel" in vocal.reason
    same = {v.use_case: v for v in compare_fits(a, a)}
    assert same["vocal"].better is None
