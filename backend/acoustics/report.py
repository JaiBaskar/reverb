import math

from pydantic import BaseModel

from acoustics.materials import DEFAULT_SELECTION, MATERIALS
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
from properties.models import Field, Room

MODE_FMAX_HZ = 300.0
EAR_HEIGHT_M = 1.2
ASPECT_NOTE_THRESHOLD = 1.10


class Geometry(BaseModel):
    width_m: Field
    depth_m: Field
    height_m: Field
    area_m2: Field
    equivalent_width_m: float
    equivalent_depth_m: float
    volume_m3: float
    note: str | None = None


class Surfaces(BaseModel):
    floor_m2: float
    ceiling_m2: float
    walls_m2: float


class MaterialChoice(BaseModel):
    surface: str
    id: str
    label: str
    alpha: list[float]
    provenance: str = "assumed"


class Mode(BaseModel):
    axis: str
    order: int
    freq_hz: float


class Reflection(BaseModel):
    surface: str
    path_m: float
    delay_ms: float


class AcousticReport(BaseModel):
    sid: str
    room_id: str
    label: str
    bands_hz: list[int]
    geometry: Geometry
    surfaces: Surfaces
    materials: list[MaterialChoice]
    absorption_sabins: list[float]
    rt60_s: list[float]
    schroeder_hz: float
    modes: list[Mode]
    source_position_m: list[float]
    listener_position_m: list[float]
    early_reflections: list[Reflection]
    assumptions: list[str]
    warnings: list[str]
    method: str


class UnknownMaterial(ValueError):
    pass


def analyze_room(sid: str, room: Room, selection: dict[str, str] | None = None) -> AcousticReport:
    if not room.usable:
        raise ValueError(f"room {room.id} is not usable: {'; '.join(room.issues)}")
    sel = {**DEFAULT_SELECTION, **(selection or {})}
    for surface, mid in sel.items():
        if mid not in MATERIALS:
            raise UnknownMaterial(f"unknown material '{mid}' for {surface}")

    area, h = room.area_m2.value, room.height_m.value
    w0, d0 = room.width_m.value, room.depth_m.value
    assert area and h and w0 and d0  # guaranteed by usable normalization
    w, d = equivalent_box(area, w0, d0)
    vol = volume(area, h)
    surf = surface_areas(w, d, h)

    geo_note = None
    if w0 * d0 / area > ASPECT_NOTE_THRESHOLD:
        geo_note = (
            f"Matterport bounding box {w0:.2f} x {d0:.2f} m exceeds the true floor area "
            f"({area:.1f} m2): the room is not a rectangle. Calculations use an equivalent "
            f"{w:.2f} x {d:.2f} m box with the true area."
        )

    absorption, rt60 = [], []
    for i in range(len(BANDS_HZ)):
        a = total_absorption(
            [
                (surf["floor"], MATERIALS[sel["floor"]]["alpha"][i]),
                (surf["ceiling"], MATERIALS[sel["ceiling"]]["alpha"][i]),
                (surf["walls"], MATERIALS[sel["walls"]]["alpha"][i]),
            ]
        )
        absorption.append(a)
        rt60.append(sabine_rt60(vol, a))

    mid_rt60 = (rt60[2] + rt60[3]) / 2  # 500 Hz and 1 kHz
    fs = schroeder_frequency(mid_rt60, vol)

    z = min(EAR_HEIGHT_M, 0.45 * h)
    src = (0.5 * w, 0.25 * d, z)
    lis = (0.5 * w, 0.60 * d, z)

    warnings = [
        (
            f"Below the Schroeder frequency (~{fs:.0f} Hz) the sound field is dominated by "
            "individual room modes and the Sabine RT60 is not a reliable description."
        ),
    ]
    mean_alpha = [a / sum(surf.values()) for a in absorption]
    if max(mean_alpha) > 0.3:
        warnings.append(
            "Average absorption exceeds 0.3 in at least one band; Sabine tends to overestimate "
            "RT60 for very absorptive rooms."
        )
    if any(math.isinf(t) for t in rt60):
        warnings.append("Zero absorption in a band gives an infinite RT60.")

    assumptions = [
        "Surface materials are generic presets, not known for this property.",
        "Room is empty (no furniture, people or curtains).",
        "Walls, floor and ceiling are single uniform materials; doors and windows are ignored.",
        "Air absorption is ignored (affects 2-4 kHz in large rooms).",
        (
            f"Source at ({src[0]:.2f}, {src[1]:.2f}, {src[2]:.2f}) m and listener at "
            f"({lis[0]:.2f}, {lis[1]:.2f}, {lis[2]:.2f}) m are default positions."
        ),
    ]
    for field, name in (
        (room.width_m, "width"),
        (room.depth_m, "depth"),
        (room.height_m, "height"),
    ):
        if field.provenance in ("estimated", "assumed"):
            assumptions.append(f"Room {name} is {field.provenance}: {field.note}.")

    return AcousticReport(
        sid=sid,
        room_id=room.id,
        label=room.label,
        bands_hz=BANDS_HZ,
        geometry=Geometry(
            width_m=room.width_m,
            depth_m=room.depth_m,
            height_m=room.height_m,
            area_m2=room.area_m2,
            equivalent_width_m=w,
            equivalent_depth_m=d,
            volume_m3=vol,
            note=geo_note,
        ),
        surfaces=Surfaces(
            floor_m2=surf["floor"], ceiling_m2=surf["ceiling"], walls_m2=surf["walls"]
        ),
        materials=[
            MaterialChoice(
                surface=s,
                id=sel[s],
                label=MATERIALS[sel[s]]["label"],
                alpha=MATERIALS[sel[s]]["alpha"],
            )
            for s in ("floor", "walls", "ceiling")
        ],
        absorption_sabins=absorption,
        rt60_s=rt60,
        schroeder_hz=fs,
        modes=[Mode(**m) for m in axial_modes({"width": w, "depth": d, "height": h}, MODE_FMAX_HZ)],
        source_position_m=list(src),
        listener_position_m=list(lis),
        early_reflections=[Reflection(**r) for r in first_order_reflections((w, d, h), src, lis)],
        assumptions=assumptions,
        warnings=warnings,
        method="Sabine RT60 per octave band; axial modes f = n*c/(2L); "
        "first-order image-source reflections. Modeled, not measured.",
    )
