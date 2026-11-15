import base64
import math

from pydantic import BaseModel

from acoustics.report import AcousticReport
from ir.generate import (
    MAX_ORDER,
    N_RAYS,
    SAMPLE_RATE,
    SCATTERING,
    generate_ir,
    ir_to_wav_bytes,
    measure_rt60,
)


class IrResponse(BaseModel):
    sid: str
    room_id: str
    label: str
    sample_rate: int
    duration_s: float
    wav_base64: str
    bands_hz: list[int]
    report_rt60_s: list[float]  # the room report's RT60 (Eyring with air absorption)
    ir_rt60_s: list[float | None]  # decay measured from the MODELED IR, not from the real room
    params: dict
    notes: list[str]


MAX_ALPHA = 0.99


def effective_alphas(
    report: AcousticReport, box: tuple[float, float, float]
) -> dict[str, list[float]]:
    """Surface absorption for the simulated shoebox, scaled per band so its total absorption
    equals the report's. The report's absorption includes furniture and, when known, the wall
    area of the real outline; the shoebox has neither, so without this the IR would decay like
    an empty box. Furniture is not placed as objects: its absorption is spread over the
    surfaces in proportion to theirs (a Sabine-equivalent simplification)."""
    w, d, h = box
    areas = {"floor": w * d, "ceiling": w * d, "walls": 2 * (w + d) * h}
    base = {m.surface: m.alpha for m in report.materials}
    out = {s: list(base[s]) for s in areas}
    for b, target in enumerate(report.absorption_sabins):
        have = sum(areas[s] * base[s][b] for s in areas)
        if have <= 0:
            continue
        k = target / have
        scaled = {s: base[s][b] * k for s in areas}
        over = sum(areas[s] * max(0.0, scaled[s] - MAX_ALPHA) for s in areas)
        for s in areas:
            scaled[s] = min(scaled[s], MAX_ALPHA)
        if over > 0:  # hand the excess to surfaces still below the cap
            room = {s: areas[s] * (MAX_ALPHA - scaled[s]) for s in areas}
            free = sum(room.values())
            for s, area in areas.items():
                if free > 0:
                    scaled[s] += min(room[s], over * room[s] / free) / area
        for s in areas:
            out[s][b] = scaled[s]
    return out


def build_ir(report: AcousticReport, seed: int = 1) -> IrResponse:
    g = report.geometry
    box = (g.equivalent_width_m, g.equivalent_depth_m, g.height_m.value)
    alphas = effective_alphas(report, box)
    src, lis = tuple(report.source_position_m), tuple(report.listener_position_m)
    ir = generate_ir(box, alphas, src, lis, seed=seed)

    ir_rt60 = [measure_rt60(ir, SAMPLE_RATE, f) for f in report.bands_hz]
    return IrResponse(
        sid=report.sid,
        room_id=report.room_id,
        label=report.label,
        sample_rate=SAMPLE_RATE,
        duration_s=len(ir) / SAMPLE_RATE,
        wav_base64=base64.b64encode(ir_to_wav_bytes(ir)).decode(),
        bands_hz=report.bands_hz,
        report_rt60_s=report.rt60_s,
        ir_rt60_s=[None if math.isnan(m) else m for m in ir_rt60],
        params={
            "method": "pyroomacoustics hybrid image-source + ray tracing",
            "max_order": MAX_ORDER,
            "n_rays": N_RAYS,
            "scattering": SCATTERING,
            "seed": seed,
            "box_m": list(box),
            "source_m": list(src),
            "listener_m": list(lis),
        },
        notes=[
            "Modeled approximation from geometry, assumed materials and furniture (its absorption "
            "spread over the surfaces); not a recording of the real space.",
            f"Surface scattering of {SCATTERING} is an assumption.",
            "Both the IR and the report's RT60 include air absorption (ISO 9613-1).",
            f"IR decay below the Schroeder frequency (~{report.schroeder_hz:.0f} Hz) "
            "is modal and can differ strongly from the statistical (Eyring) value.",
        ],
    )
