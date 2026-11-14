"""Synthetic room impulse responses with Pyroomacoustics (hybrid image-source + ray tracing).

The IR is a modeled approximation of a shoebox room, not a measurement. ir/service.py scales
the surface absorption so the box matches the report's total (materials and furniture).
"""

import io
import threading

import numpy as np
import pyroomacoustics as pra
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

from acoustics.physics import BANDS_HZ

SAMPLE_RATE = 48000
MAX_ORDER = 3  # image-source order before ray tracing takes over
N_RAYS = 20000
RECEIVER_RADIUS_M = 0.5
SCATTERING = 0.5  # assumed surface diffusion; 0 (pure specular) decays too slowly vs Sabine
MAX_LENGTH_S = 4.0
FADE_S = 0.02

# pra.random.seed() sets one global RNG; FastAPI serves sync endpoints from a threadpool, so
# concurrent requests (rooms A and B load together) must not interleave seeding and simulation.
_SIM_LOCK = threading.Lock()


def generate_ir(
    box: tuple[float, float, float],
    alphas: dict[str, list[float]],
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
    *,
    fs: int = SAMPLE_RATE,
    seed: int = 1,
    max_order: int = MAX_ORDER,
    n_rays: int = N_RAYS,
    scattering: float = SCATTERING,
) -> np.ndarray:
    """Mono RIR normalised to unit peak. alphas: floor/ceiling/walls -> 6 octave-band values."""

    def mat(surface: str) -> pra.Material:
        return pra.Material(
            energy_absorption={"coeffs": alphas[surface], "center_freqs": BANDS_HZ},
            scattering=scattering,
        )

    materials = {k: mat("walls") for k in ("east", "west", "north", "south")}
    materials["floor"] = mat("floor")
    materials["ceiling"] = mat("ceiling")

    with _SIM_LOCK:
        pra.random.seed(seed)  # ray tracing is stochastic; fix it so the same room sounds the same
        room = pra.ShoeBox(
            list(box),
            fs=fs,
            materials=materials,
            max_order=max_order,
            ray_tracing=True,
            air_absorption=True,
        )
        room.set_ray_tracing(n_rays=n_rays, receiver_radius=RECEIVER_RADIUS_M)
        room.add_source(list(source))
        room.add_microphone(list(listener))
        room.compute_rir()
        ir = np.asarray(room.rir[0][0], dtype=np.float64)

    ir = ir[: int(MAX_LENGTH_S * fs)]
    n_fade = int(FADE_S * fs)
    if ir.size > n_fade:
        ir[-n_fade:] *= np.linspace(1.0, 0.0, n_fade)
    peak = np.abs(ir).max()
    return ir / peak if peak > 0 else ir


def measure_rt60(ir: np.ndarray, fs: int, center_hz: float) -> float:
    """RT60 in one octave band by Schroeder backward integration (T30, falling back to T20)."""
    hi = min(center_hz * 2**0.5, fs / 2 * 0.99)
    sos = butter(4, [center_hz / 2**0.5, hi], btype="band", fs=fs, output="sos")
    x = sosfilt(sos, ir)
    energy = np.cumsum((x**2)[::-1])[::-1]
    if energy[0] <= 0:
        return float("nan")
    decay_db = 10 * np.log10(energy / energy[0] + 1e-30)
    t = np.arange(x.size) / fs
    for lo_db, hi_db in ((-5, -35), (-5, -25)):
        if decay_db.min() < hi_db:
            i0, i1 = np.argmax(decay_db < lo_db), np.argmax(decay_db < hi_db)
            if i1 - i0 > 10:
                slope = np.polyfit(t[i0:i1], decay_db[i0:i1], 1)[0]
                return float(-60.0 / slope)
    return float("nan")


def ir_to_wav_bytes(ir: np.ndarray, fs: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    wavfile.write(buf, fs, ir.astype(np.float32))  # float32 keeps the quiet tail intact
    return buf.getvalue()
