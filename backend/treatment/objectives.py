"""What a room should sound like for each use: RT60 limits per octave band (125 Hz-4 kHz).

- mixing / critical listening: EBU Tech 3276 (listening conditions for sound programme):
  mean RT60 Tm = 0.25 (V / 100 m3)^(1/3) s, tolerance -0.05/+0.05 s from 200 Hz up, with the
  upper limit rising towards low frequencies (+0.3 s at 63 Hz -> about +0.15 s at 125 Hz).
  Early reflections in the first 15 ms should be at least 10 dB below the direct sound
  (ITU-R BS.1116 / EBU Tech 3276): a reflection-free zone at the listening position.
- music production: the same centre value with a looser tolerance (+/-0.1 s).
- recording (vocals and instruments): controlled but not dead, 0.3-0.5 s mid-band, bass not
  much longer than the mids.
- podcasting / voice: short and even, 0.2-0.35 s, so speech stays intelligible and dry.
These are rules of thumb and standards for control rooms, used as design targets.
"""

from typing import Literal

from pydantic import BaseModel

ObjectiveId = Literal["mixing", "critical_listening", "music_production", "recording", "podcasting"]


class Objective(BaseModel):
    id: ObjectiveId
    label: str
    layout: Literal["monitoring", "mic"]
    needs_rfz: bool  # reflection-free zone at the listening position
    rfz_db: float  # reflections must be this far below the direct sound
    allow_diffusion: bool
    basis: str


OBJECTIVES: dict[str, Objective] = {
    o.id: o
    for o in [
        Objective(id="mixing", label="Mixing", layout="monitoring", needs_rfz=True, rfz_db=10,
                  allow_diffusion=True, basis="EBU Tech 3276 reverberation limits; reflection-free zone (10 dB, ITU-R BS.1116)"),
        Objective(id="critical_listening", label="Critical listening", layout="monitoring", needs_rfz=True,
                  rfz_db=10, allow_diffusion=True, basis="EBU Tech 3276 reverberation limits; reflection-free zone (10 dB, ITU-R BS.1116)"),
        Objective(id="music_production", label="Music production", layout="monitoring", needs_rfz=True,
                  rfz_db=6, allow_diffusion=True, basis="EBU Tech 3276 centre value, widened to +/-0.1 s; reflections 6 dB down"),
        Objective(id="recording", label="Recording vocals and instruments", layout="mic", needs_rfz=False,
                  rfz_db=0, allow_diffusion=True, basis="Rule of thumb for small tracking rooms: 0.3-0.5 s, even bass"),
        Objective(id="podcasting", label="Podcasting and voice", layout="mic", needs_rfz=False, rfz_db=0,
                  allow_diffusion=False, basis="Rule of thumb for voice rooms: 0.2-0.35 s, even across bands"),
    ]
}  # fmt: skip


def targets(objective: Objective, volume_m3: float, bands: list[int]) -> list[tuple[float, float]]:
    """(low, high) RT60 limits per band."""
    if objective.id in ("mixing", "critical_listening", "music_production"):
        tm = 0.25 * (volume_m3 / 100.0) ** (1 / 3)
        tol = 0.05 if objective.id != "music_production" else 0.10
        out = []
        for f in bands:
            hi_extra = 0.15 if f <= 125 else 0.0  # EBU upper limit eases below 200 Hz
            out.append((max(0.1, tm - tol), tm + tol + hi_extra))
        return out
    if objective.id == "recording":
        return [(0.3, 0.6 if f <= 125 else 0.5) for f in bands]
    return [(0.2, 0.4 if f <= 125 else 0.35) for f in bands]
