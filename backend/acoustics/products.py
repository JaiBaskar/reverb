"""Acoustic treatment products: the only source of treatment absorption in REVERB.

Octave-band absorption coefficients (125 Hz-4 kHz) are typical published values for generic
products, rounded and capped at 1.0 (reverberation-room tests give values above 1 from edge
diffraction; Sabine arithmetic should not). They describe a kind of product, not a brand:
- broadband panels: 48 kg/m3 rigid fibreglass / mineral-wool board, mounted on the wall
  (ASTM C423 "A" mounting; e.g. the widely published 2" and 4" type-703 results);
- bass trap: 100 mm board straddling a room corner, floor to ceiling, with the corner air
  space behind it, which extends absorption down to 125 Hz;
- ceiling cloud: 100 mm board hung ~150 mm below the ceiling (air gap helps the low end);
- QRD diffuser: 1D quadratic-residue diffuser, N = 7, 150 mm deepest well. Its design
  frequency is f0 = c * s_max / (2 * N * d_max) = 343 * 4 / (2 * 7 * 0.15) ~ 650 Hz; above
  it, it scatters rather than absorbs. Its small absorption is listed for Sabine bookkeeping.
"""

from typing import Literal

from pydantic import BaseModel

Mount = Literal["wall", "corner", "ceiling"]


class Product(BaseModel):
    id: str
    label: str
    kind: Literal["panel", "bass_trap", "cloud", "diffuser"]
    mount: Mount
    width_m: float
    height_m: float  # for corner traps: per metre of height (the trap runs floor to ceiling)
    depth_m: float
    alpha: list[float]
    note: str


PRODUCTS: dict[str, Product] = {
    p.id: p
    for p in [
        Product(
            id="panel_50",
            label="Broadband panel, 50 mm, 0.6 x 1.2 m",
            kind="panel",
            mount="wall",
            width_m=0.6,
            height_m=1.2,
            depth_m=0.05,
            alpha=[0.17, 0.86, 1.00, 1.00, 1.00, 0.98],
            note="Controls mids and highs; little effect below 250 Hz.",
        ),
        Product(
            id="panel_100",
            label="Broadband panel, 100 mm, 0.6 x 1.2 m",
            kind="panel",
            mount="wall",
            width_m=0.6,
            height_m=1.2,
            depth_m=0.10,
            alpha=[0.84, 1.00, 1.00, 1.00, 1.00, 0.97],
            note="Thick enough to absorb from about 125 Hz up.",
        ),
        Product(
            id="panel_50_square",
            label="Broadband panel, 50 mm, 0.6 x 0.6 m",
            kind="panel",
            mount="wall",
            width_m=0.6,
            height_m=0.6,
            depth_m=0.05,
            alpha=[0.17, 0.86, 1.00, 1.00, 1.00, 0.98],
            note="Half-size panel for spots a full panel does not fit.",
        ),
        Product(
            id="bass_trap",
            label="Corner bass trap, 100 mm, floor to ceiling, 0.6 m face",
            kind="bass_trap",
            mount="corner",
            width_m=0.6,
            height_m=1.0,
            depth_m=0.42,  # corner to face along the diagonal
            alpha=[0.95, 1.00, 1.00, 1.00, 1.00, 0.97],
            note="Corners are where every room mode has a pressure maximum.",
        ),
        Product(
            id="cloud_100",
            label="Ceiling cloud, 100 mm, 1.2 x 1.8 m, hung 150 mm down",
            kind="cloud",
            mount="ceiling",
            width_m=1.2,
            height_m=1.8,
            depth_m=0.10,
            alpha=[0.80, 1.00, 1.00, 1.00, 1.00, 0.97],
            note="Absorbs the ceiling reflection between the speakers and the listener.",
        ),
        Product(
            id="diffuser_qrd",
            label="QRD diffuser, 0.6 x 0.6 m, 150 mm deep",
            kind="diffuser",
            mount="wall",
            width_m=0.6,
            height_m=0.6,
            depth_m=0.15,
            alpha=[0.10, 0.20, 0.25, 0.20, 0.15, 0.15],
            note="Scatters reflections above ~650 Hz instead of absorbing them; needs about 2 m "
            "or more between it and the listener.",
        ),
    ]
}
