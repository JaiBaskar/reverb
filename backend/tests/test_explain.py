import pytest

from acoustics.explain import compare
from acoustics.report import analyze_room
from properties.models import Field, Room


def room(area, w, d, h, rid="r"):
    f = lambda v: Field(value=v, provenance="verified")
    return Room(
        id=rid,
        label="Test room",
        label_confidence=1.0,
        area_m2=f(area),
        width_m=f(w),
        depth_m=f(d),
        height_m=f(h),
        usable=True,
        issues=[],
    )


def report(r, materials=None):
    return analyze_room("sid", r, materials)


SMALL = room(16.0, 4.0, 4.0, 2.5)
BIG = room(32.0, 8.0, 4.0, 2.5)


def test_identical_rooms_are_reported_similar():
    c = compare(report(SMALL), report(SMALL))
    assert c.livelier is None
    assert c.volume_factor == pytest.approx(1.0)
    assert c.absorption_factor == pytest.approx(1.0)
    assert c.material_differences == []
    assert any("similar" in s for s in c.statements)


def test_volume_and_absorption_factors_multiply_to_the_rt60_ratio():
    a, b = report(SMALL), report(BIG)
    c = compare(a, b)
    ta = (a.rt60_s[2] + a.rt60_s[3]) / 2
    tb = (b.rt60_s[2] + b.rt60_s[3]) / 2
    assert c.mid_rt60_s == pytest.approx([ta, tb])
    # T = 0.161 V / A, so T_a / T_b = (V_a / V_b) * (A_b / A_a) exactly
    assert c.volume_factor * c.absorption_factor == pytest.approx(ta / tb, rel=1e-9)
    assert c.volume_factor == pytest.approx(40.0 / 80.0)


def test_floor_material_difference_makes_hard_floor_room_livelier():
    carpet = report(SMALL, {"floor": "carpet"})
    wood = report(SMALL, {"floor": "hardwood"})
    c = compare(carpet, wood)
    assert c.livelier == "B"
    assert [d.surface for d in c.material_differences] == ["floor"]
    assert c.material_differences[0].a == "carpet"
    assert c.material_differences[0].b == "hardwood"
    assert c.volume_factor == pytest.approx(1.0)


def test_statements_are_modeled_and_quote_computed_numbers():
    a, b = report(SMALL, {"floor": "carpet"}), report(SMALL)
    c = compare(a, b)
    text = " ".join(c.statements)
    assert f"{c.mid_rt60_s[0]:.2f}" in text and f"{c.mid_rt60_s[1]:.2f}" in text
    assert "modeled" in text.lower()


def test_lowest_mode_and_schroeder_are_taken_from_the_reports():
    a, b = report(SMALL), report(BIG)
    c = compare(a, b)
    assert c.schroeder_hz == pytest.approx([a.schroeder_hz, b.schroeder_hz])
    assert c.lowest_mode_hz == pytest.approx([a.modes[0].freq_hz, b.modes[0].freq_hz])
    assert c.first_reflection_ms == pytest.approx(
        [min(r.delay_ms for r in a.early_reflections), min(r.delay_ms for r in b.early_reflections)]
    )
