import io

import numpy as np
import pytest
from scipy.io import wavfile

from acoustics.physics import BANDS_HZ, sabine_rt60
from ir.generate import generate_ir, ir_to_wav_bytes, measure_rt60

FS = 48000
BOX = (5.0, 4.0, 3.0)
SRC = (2.5, 1.0, 1.2)
LIS = (2.5, 2.4, 1.2)


def flat(alpha):
    a = [alpha] * 6
    return {"floor": a, "ceiling": a, "walls": a}


def test_measure_rt60_recovers_known_exponential_decay():
    rng = np.random.default_rng(0)
    t = np.arange(int(2.5 * FS)) / FS
    true_t60 = 1.0
    x = rng.standard_normal(t.size) * np.exp(-6.9078 * t / true_t60)
    assert measure_rt60(x, FS, 1000) == pytest.approx(true_t60, rel=0.08)


def test_generate_ir_is_deterministic():
    a = generate_ir(BOX, flat(0.2), SRC, LIS, seed=7)
    b = generate_ir(BOX, flat(0.2), SRC, LIS, seed=7)
    assert np.array_equal(a, b)


def test_ir_wav_roundtrip_is_mono_float_at_48k_with_unit_peak():
    ir = generate_ir(BOX, flat(0.2), SRC, LIS, seed=1)
    rate, data = wavfile.read(io.BytesIO(ir_to_wav_bytes(ir, FS)))
    assert rate == FS
    assert data.ndim == 1
    assert data.dtype == np.float32
    assert np.abs(data).max() == pytest.approx(1.0, abs=1e-3)


def test_measured_rt60_matches_sabine_within_20_percent_mid_and_high_bands():
    # 5x4x3 m, alpha 0.2 everywhere: V=60, S=94 -> Sabine 0.161*60/(94*0.2) = 0.514 s
    ir = generate_ir(BOX, flat(0.2), SRC, LIS, seed=1)
    sabine = sabine_rt60(60.0, 94 * 0.2)
    for f in (500, 1000, 2000):
        assert measure_rt60(ir, FS, f) == pytest.approx(sabine, rel=0.20), f"band {f} Hz"


def test_more_absorption_gives_shorter_decay():
    live = generate_ir(BOX, flat(0.1), SRC, LIS, seed=1)
    dead = generate_ir(BOX, flat(0.4), SRC, LIS, seed=1)
    assert measure_rt60(dead, FS, 1000) < 0.6 * measure_rt60(live, FS, 1000)


def test_bands_constant_has_six_octaves():
    assert len(BANDS_HZ) == 6
