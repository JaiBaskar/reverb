import math

import pytest

from acoustics.physics import (
    BANDS_HZ,
    axial_modes,
    equivalent_box,
    first_order_reflections,
    sabine_rt60,
    schroeder_frequency,
    surface_areas,
    total_absorption,
    volume,
)

# Reference room: 5 x 4 x 3 m (width x depth x height).
W, D, H = 5.0, 4.0, 3.0


def test_volume_is_area_times_height():
    assert volume(20.0, 3.0) == pytest.approx(60.0)


def test_surface_areas_5x4x3():
    s = surface_areas(W, D, H)
    assert s["floor"] == pytest.approx(20.0)
    assert s["ceiling"] == pytest.approx(20.0)
    assert s["walls"] == pytest.approx(54.0)  # 2*(5+4)*3
    assert sum(s.values()) == pytest.approx(94.0)


def test_total_absorption_is_area_weighted():
    # 40 m2 at 0.1 plus 54 m2 at 0.2 = 4.0 + 10.8
    assert total_absorption([(40.0, 0.1), (54.0, 0.2)]) == pytest.approx(14.8)


def test_sabine_uniform_alpha_matches_hand_calculation():
    # V=60, S=94, alpha=0.1 -> A=9.4 -> T=0.161*60/9.4
    a = total_absorption([(94.0, 0.1)])
    assert sabine_rt60(60.0, a) == pytest.approx(0.161 * 60 / 9.4)
    assert sabine_rt60(60.0, a) == pytest.approx(1.0277, abs=1e-3)


def test_sabine_zero_absorption_is_infinite_not_a_crash():
    assert math.isinf(sabine_rt60(60.0, 0.0))


def test_schroeder_frequency():
    # 2000 * sqrt(1.0277 / 60) = 261.8 Hz
    assert schroeder_frequency(1.0277, 60.0) == pytest.approx(261.8, abs=0.2)


def test_axial_modes_5x4x3():
    modes = axial_modes({"width": W, "depth": D, "height": H}, fmax_hz=120.0)
    by_axis = {}
    for m in modes:
        by_axis.setdefault(m["axis"], []).append(m["freq_hz"])
    assert by_axis["width"][0] == pytest.approx(34.3)  # 343 / (2*5)
    assert by_axis["depth"][0] == pytest.approx(42.875)  # 343 / (2*4)
    assert by_axis["height"][0] == pytest.approx(57.1667, abs=1e-3)  # 343 / (2*3)
    assert by_axis["width"][1] == pytest.approx(68.6)  # second order
    assert all(m["freq_hz"] <= 120.0 for m in modes)
    assert [m["freq_hz"] for m in modes] == sorted(m["freq_hz"] for m in modes)


def test_first_order_floor_reflection_delay():
    # Room 4x4x3, source (1,2,1.5), listener (3,2,1.5): direct = 2 m.
    # Floor image of source is (1,2,-1.5); distance to listener = sqrt(2^2 + 3^2) = 3.6056 m.
    refl = first_order_reflections((4, 4, 3), (1, 2, 1.5), (3, 2, 1.5))
    floor = next(r for r in refl if r["surface"] == "floor")
    assert floor["path_m"] == pytest.approx(math.sqrt(13), abs=1e-6)
    assert floor["delay_ms"] == pytest.approx((math.sqrt(13) - 2) / 343 * 1000, abs=1e-6)
    assert len(refl) == 6
    assert all(r["delay_ms"] > 0 for r in refl)


def test_equivalent_box_preserves_footprint_area_and_aspect_ratio():
    # L-shaped room: bounding box 5 x 4 = 20 but real area is 15.
    w, d = equivalent_box(area=15.0, width=5.0, depth=4.0)
    assert w * d == pytest.approx(15.0)
    assert w / d == pytest.approx(5.0 / 4.0)


def test_bands_are_octaves_125_to_4k():
    assert BANDS_HZ == [125, 250, 500, 1000, 2000, 4000]
