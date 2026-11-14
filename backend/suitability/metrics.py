"""Pure metrics derived from an AcousticReport for the suitability rules."""

import itertools
from dataclasses import dataclass, field

from acoustics import physics
from acoustics.report import Mode, Reflection


def _band(rt60: list[float], bands: list[int], hz: int) -> float:
    return rt60[bands.index(hz)]


def mid_rt60(rt60: list[float], bands: list[int]) -> float:
    """Mean of the 500 Hz and 1 kHz bands."""
    return (_band(rt60, bands, 500) + _band(rt60, bands, 1000)) / 2


def bass_ratio(rt60: list[float], bands: list[int]) -> float:
    """Beranek bass ratio, shared with the comparison explanation (acoustics.physics)."""
    return physics.bass_ratio(rt60, bands)


def hf_ratio(rt60: list[float], bands: list[int]) -> float:
    """RT60 at 4 kHz relative to mid RT60; <1 means highs die away faster (a darker room)."""
    return _band(rt60, bands, 4000) / mid_rt60(rt60, bands)


def reflection_gap_ms(reflections: list[Reflection]) -> float | None:
    """Delay after the direct sound of the earliest first-order wall or ceiling reflection.

    The floor bounce is excluded: it depends on mic and source height and is usually handled
    with a rug or mic placement, not by choosing a room.
    """
    delays = [r.delay_ms for r in reflections if r.surface != "floor"]
    return min(delays) if delays else None


def bs1116_target(volume_m3: float) -> float:
    """ITU-R BS.1116 reference reverberation time for listening rooms: 0.25 (V/100)^(1/3) s."""
    return 0.25 * (volume_m3 / 100) ** (1 / 3)


@dataclass
class ModeSpread:
    count: int
    max_gap_hz: float | None
    max_gap_between: tuple[float, float] | None
    coincident: list[tuple[float, str]] = field(default_factory=list)  # (freq, "axis/axis")


def mode_spread(modes: list[Mode], fmax_hz: float = 200, tolerance: float = 0.05) -> ModeSpread:
    """Largest gap between axial modes below fmax, and near-coincident modes on different axes."""
    low = sorted((m for m in modes if m.freq_hz <= fmax_hz), key=lambda m: m.freq_hz)
    gap, between = None, None
    for a, b in itertools.pairwise(low):
        g = b.freq_hz - a.freq_hz
        if gap is None or g > gap:
            gap, between = g, (a.freq_hz, b.freq_hz)
    coincident = [
        (a.freq_hz, f"{a.axis}/{b.axis}")
        for i, a in enumerate(low)
        for b in low[i + 1 :]
        if a.axis != b.axis and abs(b.freq_hz - a.freq_hz) / a.freq_hz <= tolerance
    ]
    return ModeSpread(len(low), gap, between, coincident)
