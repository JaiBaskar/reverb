"""The reverberation and air-absorption equations against their published sources."""

import math

import pytest

from acoustics.physics import (
    SABINE_CONSTANT,
    air_attenuation_db_per_m,
    eyring_absorption_for,
    eyring_rt60,
)
from treatment.objectives import OBJECTIVES, ebu_upper, targets


@pytest.mark.parametrize(
    ("f", "db_per_km"),
    # ISO 9613-1 Table 1 / ISO 9613-2 Table 2, 20 C, 70 % RH (rounded to 0.1 dB/km)
    [(125, 0.3), (250, 1.1), (500, 2.8), (1000, 5.0), (2000, 9.0), (4000, 22.9)],
)
def test_air_absorption_matches_iso_9613(f, db_per_km):
    assert air_attenuation_db_per_m(f, 20, 70) * 1000 == pytest.approx(db_per_km, abs=0.2)


def test_eyring_tends_to_sabine_for_a_live_room():
    v, s, a = 100.0, 130.0, 2.0  # mean absorption 0.015
    sabine = SABINE_CONSTANT * v / a
    # Eyring is always a little shorter (-ln(1 - a) > a); at a = 0.015 by about 1-3 %
    assert eyring_rt60(v, a, s, 125) == pytest.approx(sabine, rel=0.03)
    assert eyring_rt60(v, a, s, 125) < sabine


def test_eyring_is_shorter_than_sabine_for_an_absorptive_room():
    v, s = 40.0, 70.0
    a = 0.4 * s  # mean absorption 0.4: a treated room
    sabine = SABINE_CONSTANT * v / a
    eyring = eyring_rt60(v, a, s, 500)
    assert eyring < sabine * 0.8  # Sabine overstates by more than 20 % at a = 0.4
    assert eyring == pytest.approx(
        SABINE_CONSTANT * v / (-s * math.log(0.6) + 4 * 0.000629 * v), rel=0.01
    )


def test_inverse_round_trips():
    for f in (125, 1000, 4000):
        t = eyring_rt60(40, 15, 70, f)
        assert eyring_absorption_for(t, 40, 70, f) == pytest.approx(15)


def test_ebu_3276_tolerance():
    assert ebu_upper(200) == ebu_upper(4000) == pytest.approx(0.05)
    assert ebu_upper(63) == pytest.approx(0.30)
    # 125 Hz is 40.7 % of the way (log f) from 200 Hz to 63 Hz: 0.05 + 0.407 * 0.25
    assert ebu_upper(125) == pytest.approx(0.152, abs=0.001)
    tm = 0.25 * (40 / 100) ** (1 / 3)
    lo, hi = targets(OBJECTIVES["mixing"], 40, [125])[0]
    assert lo == pytest.approx(tm - 0.05) and hi == pytest.approx(tm + 0.152, abs=0.001)
