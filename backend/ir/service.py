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
    sabine_rt60_s: list[float]
    measured_rt60_s: list[float | None]
    params: dict
    notes: list[str]


def build_ir(report: AcousticReport, seed: int = 1) -> IrResponse:
    g = report.geometry
    box = (g.equivalent_width_m, g.equivalent_depth_m, g.height_m.value)
    alphas = {m.surface: m.alpha for m in report.materials}
    src, lis = tuple(report.source_position_m), tuple(report.listener_position_m)
    ir = generate_ir(box, alphas, src, lis, seed=seed)

    measured = [measure_rt60(ir, SAMPLE_RATE, f) for f in report.bands_hz]
    return IrResponse(
        sid=report.sid,
        room_id=report.room_id,
        label=report.label,
        sample_rate=SAMPLE_RATE,
        duration_s=len(ir) / SAMPLE_RATE,
        wav_base64=base64.b64encode(ir_to_wav_bytes(ir)).decode(),
        bands_hz=report.bands_hz,
        sabine_rt60_s=report.rt60_s,
        measured_rt60_s=[None if math.isnan(m) else m for m in measured],
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
            "Modeled approximation of an empty room from geometry and assumed materials; "
            "not a recording of the real space.",
            f"Surface scattering of {SCATTERING} is an assumption.",
            f"Measured RT60 below the Schroeder frequency (~{report.schroeder_hz:.0f} Hz) "
            "is modal and can differ strongly from the Sabine value.",
        ],
    )
