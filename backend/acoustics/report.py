import math
from typing import Literal

from pydantic import BaseModel

from acoustics.furniture import FURNITURE, FurnitureItem, furniture_absorption
from acoustics.materials import DEFAULT_SELECTION, MATERIALS
from acoustics.physics import (
    BANDS_HZ,
    axial_modes,
    equivalent_box,
    eyring_rt60,
    first_order_reflections,
    outline_wall_length,
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
    wall_source: Literal["box", "outline"] = "box"


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
    furniture: list[FurnitureItem] = []
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


def analyze_room(
    sid: str,
    room: Room,
    selection: dict[str, str] | None = None,
    furniture: list[FurnitureItem] | None = None,
    outline: list | None = None,
    extra_sabins: list[float] | None = None,
    extra_note: str | None = None,
) -> AcousticReport:
    """furniture None means an empty room. outline: the room's floor polygon (metres); when
    given, wall area comes from its perimeter instead of the equivalent box."""
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
    wall_source = "box"
    if outline and len(outline) >= 3:
        surf["walls"] = outline_wall_length(outline, area) * h
        wall_source = "outline"
    items = furniture or []
    extra = furniture_absorption(items)
    if extra_sabins is not None:  # per-wall findings (windows, doors, finishes) vs uniform walls
        extra = [e + x for e, x in zip(extra, extra_sabins, strict=True)]

    geo_note = None
    if wall_source == "outline":
        geo_note = (
            f"Wall area ({surf['walls']:.1f} m2) comes from the Matterport room outline, so the "
            "room's real shape is used for absorption; modes and reflections still use an "
            f"equivalent {w:.2f} x {d:.2f} m box."
        )
    elif w0 * d0 / area < 1 / ASPECT_NOTE_THRESHOLD:
        geo_note = (
            f"Matterport width x depth ({w0:.2f} x {d0:.2f} m) is smaller than the floor area "
            f"({area:.1f} m2); calculations scale them to an equivalent {w:.2f} x {d:.2f} m box."
        )
    elif w0 * d0 / area > ASPECT_NOTE_THRESHOLD:
        geo_note = (
            f"Matterport bounding box {w0:.2f} x {d0:.2f} m exceeds the true floor area "
            f"({area:.1f} m2): the room is not a rectangle. Calculations use an equivalent "
            f"{w:.2f} x {d:.2f} m box with the true area; a box has less wall than the real "
            "shape, so RT60 is somewhat overestimated."
        )

    absorption, rt60 = [], []
    for i in range(len(BANDS_HZ)):
        a = (
            total_absorption(
                [
                    (surf["floor"], MATERIALS[sel["floor"]]["alpha"][i]),
                    (surf["ceiling"], MATERIALS[sel["ceiling"]]["alpha"][i]),
                    (surf["walls"], MATERIALS[sel["walls"]]["alpha"][i]),
                ]
            )
            + extra[i]
        )
        a = max(a, 0.01)  # per-wall corrections can lower it; it can never reach zero
        absorption.append(a)
        rt60.append(eyring_rt60(vol, a, sum(surf.values()), BANDS_HZ[i]))

    mid_rt60 = (rt60[2] + rt60[3]) / 2  # 500 Hz and 1 kHz
    fs = schroeder_frequency(mid_rt60, vol)

    z = min(EAR_HEIGHT_M, 0.45 * h)
    src = (0.5 * w, 0.25 * d, z)
    lis = (0.5 * w, 0.60 * d, z)

    warnings = [
        (
            f"Below the Schroeder frequency (~{fs:.0f} Hz) the sound field is dominated by "
            "individual room modes and a statistical RT60 is not a reliable description."
        ),
    ]
    mean_alpha = [a / sum(surf.values()) for a in absorption]  # furniture counted as surface
    if max(mean_alpha) > 0.6:
        warnings.append(
            "Average absorption exceeds 0.6 in at least one band: the room is very dead and any "
            "statistical reverberation formula, Eyring included, is only indicative there."
        )
    if any(math.isinf(t) for t in rt60):
        warnings.append("Zero absorption in a band gives an infinite RT60.")

    assumptions = [
        (
            "Surface materials are generic presets unless you chose them; absorption values "
            "are typical figures for those finishes, not measured for this property."
        ),
        (
            "Furnishing: "
            + ", ".join(
                f"{it.count} x {FURNITURE[it.id]['label']} ({it.provenance})" for it in items
            )
            + "; typical absorption per item, not measured."
            if items
            else "Room is empty (no furniture, people or curtains)."
        ),
        extra_note
        or "Walls, floor and ceiling are single uniform materials; doors and windows are ignored.",
        "RT60 uses Eyring's formula (accurate for absorptive rooms, unlike Sabine) with air absorption from ISO 9613-1 at 20 C and 50 % relative humidity.",
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
    if room.width_m.provenance == "user":
        assumptions.append(
            "Room dimensions were entered by the user and are modeled as a rectangular box."
        )

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
            wall_source=wall_source,
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
                provenance="user" if s in (selection or {}) else "assumed",
            )
            for s in ("floor", "walls", "ceiling")
        ],
        furniture=items,
        absorption_sabins=absorption,
        rt60_s=rt60,
        schroeder_hz=fs,
        modes=[Mode(**m) for m in axial_modes({"width": w, "depth": d, "height": h}, MODE_FMAX_HZ)],
        source_position_m=list(src),
        listener_position_m=list(lis),
        early_reflections=[Reflection(**r) for r in first_order_reflections((w, d, h), src, lis)],
        assumptions=assumptions,
        warnings=warnings,
        method="Eyring RT60 with ISO 9613-1 air absorption per octave band; axial modes f = n*c/(2L); "
        "first-order image-source reflections. Modeled, not measured.",
    )
