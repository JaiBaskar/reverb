import pytest

from acoustics.physics import axial_modes
from acoustics.report import Mode
from suitability.metrics import bass_ratio, bs1116_target, mid_rt60, mode_spread

BANDS = [125, 250, 500, 1000, 2000, 4000]


def test_mid_rt60_is_mean_of_500_and_1k():
    assert mid_rt60([0.9, 0.8, 0.5, 0.3, 0.2, 0.1], BANDS) == pytest.approx(0.4)


def test_bass_ratio():
    # Beranek bass ratio: (RT125 + RT250) / (RT500 + RT1k)
    assert bass_ratio([0.6, 0.5, 0.4, 0.4, 0.3, 0.3], BANDS) == pytest.approx(1.375)


def test_bs1116_target():
    assert bs1116_target(100) == pytest.approx(0.25)
    # 0.25 * (0.7707)^(1/3) = 0.25 * 0.9169 = 0.2292
    assert bs1116_target(77.07) == pytest.approx(0.2292, abs=1e-4)


def _modes_5x4x3():
    return [Mode(**m) for m in axial_modes({"width": 5, "depth": 4, "height": 3}, 300)]


def test_mode_spread_5x4x3():
    # Below 200 Hz: 34.3 42.9 57.2 68.6 85.75 102.9 114.3 128.6 137.2 171.5(x3)
    s = mode_spread(_modes_5x4x3(), fmax_hz=200)
    assert s.count == 12
    assert s.max_gap_hz == pytest.approx(34.3, abs=0.05)
    assert s.max_gap_between == pytest.approx((137.2, 171.5), abs=0.05)
    # 171.5 Hz is shared by width n=5, depth n=4 and height n=3: 3 coincident pairs
    assert len(s.coincident) == 3
    assert all(f == pytest.approx(171.5, abs=0.05) for f, _ in s.coincident)


def test_mode_spread_ignores_same_axis_and_far_modes():
    modes = [
        Mode(axis="width", order=1, freq_hz=50),
        Mode(axis="width", order=2, freq_hz=51),  # same axis: not coincident
        Mode(axis="depth", order=1, freq_hz=60),  # 60/51 differ by >5 %
        Mode(axis="height", order=1, freq_hz=250),  # above fmax
    ]
    s = mode_spread(modes, fmax_hz=200)
    assert s.count == 3 and s.coincident == []
    assert s.max_gap_hz == pytest.approx(9)


def test_mode_spread_too_few_modes():
    s = mode_spread([Mode(axis="width", order=1, freq_hz=80)], fmax_hz=200)
    assert s.max_gap_hz is None
