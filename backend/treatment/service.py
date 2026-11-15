"""The Acoustic Treatment Engine: validated room model in, treatment plan out.

    room model (roomintel)  ->  room report (acoustics.report, same as everywhere in REVERB)
        ->  layout + candidate positions (placement)  ->  optimisation (optimizer)
        ->  predicted untreated vs treated results, problems and why each item is there
        ->  viewpoint for the picture (viewpoint)

The explanations are fixed templates filled with the calculated numbers. A language model is
not involved in any number, position or recommendation.
"""

import itertools
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.advice import parallel_wall_pairs
from acoustics.field import room_field
from acoustics.furniture import FurnitureItem
from acoustics.physics import bass_ratio, schroeder_frequency
from acoustics.products import PRODUCTS
from acoustics.report import AcousticReport, analyze_room
from properties.models import Room
from roomintel import obstacles
from roomintel.model import RoomModel, build_room_model
from treatment.fit import fit_candidates
from treatment.objectives import OBJECTIVES, Objective, targets
from treatment.optimizer import Scored, optimise, reflection_after
from treatment.placement import (
    REFLECTION_WINDOW_MS,
    Blocker,
    Layout,
    PlacedItem,
    candidates,
    mic_layout,
    monitoring_layout,
    wall_names,
)
from treatment.viewpoint import Viewpoint, choose

Scenario = Literal["as_scanned", "empty"]


class Problem(BaseModel):
    id: str
    title: str
    detail: str
    severity: Literal["high", "medium", "low"]
    addressed_by: list[str]  # item groups
    after: str


class ReflectionResult(BaseModel):
    source: str
    surface: str
    delay_ms: float
    before_db: float
    after_db: float
    treated_by: str | None


class Prediction(BaseModel):
    bands_hz: list[int]
    before_rt60_s: list[float]
    after_rt60_s: list[float]
    target_low_s: list[float]
    target_high_s: list[float]
    mid_before_s: float
    mid_after_s: float
    bass_ratio_before: float
    bass_ratio_after: float
    schroeder_before_hz: float
    schroeder_after_hz: float
    reflections: list[ReflectionResult]


class ItemGroup(BaseModel):
    group: str
    product_id: str
    product: str
    count: int
    why: str


class Alternative(BaseModel):
    summary: str
    items: int
    mid_rt60_s: float
    score: float
    chosen: bool


class RoomSummary(BaseModel):
    polygon: list[tuple[float, float]]
    floor_z: float
    height_m: float
    height_provenance: str
    area_m2: float
    volume_m3: float
    geometry_source: str
    walls: list[dict]
    materials: list[dict]
    furniture: list[FurnitureItem]
    furniture_basis: str
    vision_status: str
    vision_reason: str | None
    agents: list[dict]  # each specialist agent: status, model, seconds, reason
    wall_findings: list[dict]  # per wall: finish and features in metres
    pieces: list[dict]  # furniture the furniture agent saw, with the table id used
    hazards: list[dict]
    furniture_objects: list[dict]  # furniture found in the scan meshes
    absorption_notes: list[str]


class TreatmentPlan(BaseModel):
    sid: str
    room_id: str
    label: str
    objective: Objective
    scenario: Scenario
    layout: Layout | None
    items: list[PlacedItem]
    groups: list[ItemGroup]
    problems: list[Problem]
    prediction: Prediction
    alternatives: list[Alternative]
    viewpoint: Viewpoint | None
    room: RoomSummary
    notes: list[str]
    assumptions: list[str]
    limitations: list[str]


GROUP_WHY = {
    "first_reflection": "Absorb the first reflections from the side walls before they reach you",
    "ceiling": "Absorb the reflection off the ceiling between the speakers and you",
    "front_wall": "Stop the wall behind the speakers cancelling part of the bass",
    "rear_wall": "Tame the reflection from the wall behind you",
    "corner": "Damp the room's bass resonances where they are strongest",
    "coverage": "Bring the overall reverberation time down to the target",
}


def _room_for_model(rm: RoomModel, base: Room) -> Room:
    """The Model API room with the height the geometry stage settled on."""
    return base.model_copy(update={"height_m": rm.geometry.height})


def base_report(
    rm: RoomModel, room: Room, scenario: Scenario, materials=None, furniture=None
) -> AcousticReport:
    sel = {m.surface: m.material_id for m in rm.materials}
    sel.update(materials or {})
    items = (
        furniture
        if furniture is not None
        else ([] if scenario == "empty" else rm.furniture_as_scanned)
    )
    return analyze_room(
        rm.sid,
        _room_for_model(rm, room),
        sel,
        furniture=items,
        outline=rm.geometry.polygon,
        extra_sabins=rm.wall_extra_sabins,
        extra_note=absorption_note(rm),
    )


def absorption_note(rm: RoomModel) -> str:
    if not rm.absorption_notes:
        return "Walls are one uniform material; no windows, doors or openings were found to count."
    return (
        "Per-wall absorption counts what the scan and the walls agent found: "
        + "; ".join(rm.absorption_notes)
        + ". Glass, doors and finishes use the material table; an open doorway absorbs everything."
    )


def keep_clear(rm: RoomModel, avoid_walls: list[int]) -> tuple[list[str], list[Blocker]]:
    """Mark what no treatment may cover and what is in the way but movable.

    - walls the user keeps clear;
    - building features the walls agent found (windows, doors, glass doors, radiators,
      built-in shelving): no-go rectangles at their real position and height;
    - things hung on the walls (art, shelves, TVs, mirrors): movable blockers for the x-ray view.
    """
    notes = []
    walls = rm.geometry.walls
    for i in avoid_walls:
        if 0 <= i < len(walls):
            walls[i].openings = [(0.0, walls[i].length_m)]
    if avoid_walls:
        notes.append(f"{len(avoid_walls)} wall(s) kept clear at your request.")
    movable: list[Blocker] = []
    n_build = 0
    for wf in rm.walls:
        w = walls[wf.wall]
        for k, f in enumerate(wf.features):
            if f.category == "building":
                w.no_go.append((f.along[0], f.along[1], f.z[0], f.z[1], f.kind))
                n_build += 1
            elif f.category == "movable":
                u = (np.array(w.end) - np.array(w.start)) / w.length_m
                n = np.array(w.inward)
                base = np.array(w.start) + n * w.surface_offset_m
                pts = [base + u * a for a in f.along] + [base + u * a + n * 0.06 for a in f.along]
                xy = np.array(pts)
                fz = rm.geometry.floor_z
                movable.append(Blocker(
                    id=f"w{wf.wall}-{k}", label=f.kind.replace("_", " "), kind="wall_object",
                    min=(float(xy[:, 0].min()), float(xy[:, 1].min()), fz + f.z[0]),
                    max=(float(xy[:, 0].max()), float(xy[:, 1].max()), fz + f.z[1]),
                ))  # fmt: skip
    if n_build:
        notes.append(
            f"{n_build} window(s), door(s) or fixture(s) the walls agent found are kept clear at their real size."
        )
    return notes, movable


def make_plan(
    sid: str,
    room_id: str,
    objective_id: str,
    scenario: Scenario = "as_scanned",
    materials: dict[str, str] | None = None,
    furniture: list[FurnitureItem] | None = None,
    room: Room | None = None,
    avoid_walls: list[int] | None = None,
    cache_only: bool = False,
) -> tuple[TreatmentPlan, AcousticReport]:
    from properties.service import get_rooms

    objective = OBJECTIVES[objective_id]
    rm = build_room_model(sid, room_id, cache_only=cache_only)
    clear_notes, wall_objects = keep_clear(rm, sorted(set(avoid_walls or [])))
    room = room or next(r for r in get_rooms(sid) if r.id == room_id)
    rep = base_report(rm, room, scenario, materials, furniture)
    geo = rm.geometry
    bands = rep.bands_hz
    tg = targets(objective, rep.geometry.volume_m3, bands)
    wall_alpha = next(m.alpha for m in rep.materials if m.surface == "walls")
    notes: list[str] = list(clear_notes)

    layout = None
    if objective.layout == "monitoring":
        layout = monitoring_layout(geo)
        if layout is None:
            notes.append(
                "No symmetrical speaker layout fits this room's shape; the plan uses the mic layout instead."
            )
    if layout is None:
        alpha = {m.surface: m.alpha for m in rep.materials}
        fld = room_field(geo.polygon, geo.height.value, rep.rt60_s, alpha)
        layout = mic_layout(
            geo, fld.best_spot, fld.source, fld.source_height_m, fld.listener_height_m
        )

    cands = candidates(geo, layout, wall_alpha[3], objective.allow_diffusion)
    located = geo.source != "box"  # a box room is in its own frame, not the scan's
    obs = obstacles.for_room(sid, geo.polygon, geo.floor_z, geo.height.value) if located else None
    if not located:
        notes.append(
            "Matterport has no wall outline for this room, so it is modeled as a rectangle of its "
            "measured size whose position in the scan is unknown: positions are relative to that "
            "rectangle, and there is no 3D preview or furniture check."
        )
    elif obs is None:
        notes.append(
            "No scan mesh: items could not be checked against the building and the furniture."
        )
    elif not obs.objects:
        notes.append(
            "No furniture geometry for this model (no MatterPak): furniture overlaps are not checked."
        )
    cands = fit_candidates(cands, geo, obs, wall_objects)
    notes += cands.notes
    surface = rep.surfaces.floor_m2 + rep.surfaces.ceiling_m2 + rep.surfaces.walls_m2
    best, ranked = optimise(
        cands, objective, tg, rep.absorption_sabins, rep.geometry.volume_m3, wall_alpha, surface
    )
    items = best.items
    after = best.rt60_s

    plan = TreatmentPlan(
        sid=sid,
        room_id=room_id,
        label=rm.label,
        objective=objective,
        scenario=scenario,
        layout=layout,
        items=items,
        groups=_groups(items),
        problems=_problems(rep, after, tg, objective, cands, items, geo, layout)
        + _site_problems(rm, items, layout),
        prediction=_prediction(rep, after, tg, cands, items),
        alternatives=_alternatives(best, ranked),
        viewpoint=choose(geo, rm.scans, items) if geo.source != "box" else None,
        room=_summary(rm, rep, layout),
        notes=notes,
        assumptions=[
            f"Room: {rep.geometry.volume_m3:.1f} m3 from the Matterport outline ({geo.area_m2:.1f} m2) "
            f"and a {geo.height.value:.2f} m ceiling ({geo.height.provenance}).",
            *[
                f"{m.surface.capitalize()}: {m.label} ({m.provenance}"
                + (f", confidence {m.confidence:.0%}" if m.confidence is not None else "")
                + ")"
                for m in rm.materials
            ],
            "Furniture: "
            + (
                rm.furniture_basis
                if scenario == "as_scanned"
                else "none (empty, move-in scenario)."
            ),
            "Treatment absorption is typical for each kind of product (acoustics/products.py), not a specific brand.",
            f"Targets: {objective.basis}.",
        ],
        limitations=[
            "Every result is a simulation from geometry and typical absorption values, not a measurement. "
            "Measure the treated room (e.g. with REW and a measurement mic) to confirm.",
            "Reverberation uses Eyring's formula with air absorption (diffuse-field assumptions); small rooms below the "
            f"Schroeder frequency (~{rep.schroeder_hz:.0f} Hz) behave modally and differ from it.",
            "Reflection points use first-order image sources off flat walls; furniture is not an obstacle in that calculation.",
            "Furniture and building overlaps use Matterport's meshes (furnished minus defurnished); thin objects under 7 cm deep (flat art) are only known when the walls agent saw them.",
            "Bass traps shorten modal ringing; they do not remove the modes themselves.",
        ],
    )
    return plan, rep


def treated_report(rep: AcousticReport, plan: TreatmentPlan) -> AcousticReport:
    """The room report with the plan installed (used for the treated room's impulse response)."""
    wall_alpha = next(m.alpha for m in rep.materials if m.surface == "walls")
    from treatment.optimizer import delta_absorption

    a = list(rep.absorption_sabins)
    for it in plan.items:
        for b, d in enumerate(delta_absorption(it, wall_alpha)):
            a[b] += d
    rt = plan.prediction.after_rt60_s
    counts = ", ".join(f"{g.count} x {g.product}" for g in plan.groups) or "nothing"
    return rep.model_copy(update={
        "label": f"{rep.label} (treated: {plan.objective.label.lower()})",
        "absorption_sabins": a,
        "rt60_s": rt,
        "schroeder_hz": schroeder_frequency((rt[2] + rt[3]) / 2, rep.geometry.volume_m3),
        "assumptions": [*rep.assumptions, f"Treatment installed as planned: {counts}."],
    })  # fmt: skip


def _groups(items: list[PlacedItem]) -> list[ItemGroup]:
    out: dict[tuple[str, str], ItemGroup] = {}
    for i in items:
        k = (i.group, i.product_id)
        if k not in out:
            out[k] = ItemGroup(
                group=i.group,
                product_id=i.product_id,
                product=PRODUCTS[i.product_id].label,
                count=0,
                why=GROUP_WHY[i.group],
            )
        out[k].count += 1
    return list(out.values())


def _mid(rt: list[float]) -> float:
    return (rt[2] + rt[3]) / 2


def _prediction(rep, after, tg, cands, items) -> Prediction:
    vol = rep.geometry.volume_m3
    refl = []
    for r in cands.reflections:
        if r.delay_ms > REFLECTION_WINDOW_MS:
            continue
        after_db, by = reflection_after(r, items)
        refl.append(ReflectionResult(source=r.source, surface=r.surface, delay_ms=r.delay_ms,
                                     before_db=r.level_db, after_db=after_db, treated_by=by))  # fmt: skip
    return Prediction(
        bands_hz=rep.bands_hz,
        before_rt60_s=rep.rt60_s,
        after_rt60_s=after,
        target_low_s=[t[0] for t in tg],
        target_high_s=[t[1] for t in tg],
        mid_before_s=_mid(rep.rt60_s),
        mid_after_s=_mid(after),
        bass_ratio_before=bass_ratio(rep.rt60_s, rep.bands_hz),
        bass_ratio_after=bass_ratio(after, rep.bands_hz),
        schroeder_before_hz=rep.schroeder_hz,
        schroeder_after_hz=schroeder_frequency(_mid(after), vol),
        reflections=sorted(refl, key=lambda r: r.delay_ms),
    )  # fmt: skip


def _problems(rep, after, tg, objective, cands, items, geo, layout) -> list[Problem]:
    out = []
    groups = {i.group for i in items}
    mid0, mid1 = _mid(rep.rt60_s), _mid(after)
    lo, hi = tg[2][0], tg[2][1]
    if mid0 > hi:
        out.append(Problem(
            id="reverb", severity="high" if mid0 > hi * 1.5 else "medium",
            title="Too much reverberation",
            detail=f"Mid-band RT60 is {mid0:.2f} s; {objective.label.lower()} wants {lo:.2f}-{hi:.2f} s. "
                   f"Notes smear into each other and you hear the room more than the source.",
            addressed_by=[g for g in ("coverage", "first_reflection", "ceiling", "rear_wall", "corner") if g in groups],
            after=f"Predicted {mid1:.2f} s after treatment.",
        ))  # fmt: skip
    elif mid0 < lo:
        out.append(Problem(
            id="dead", severity="medium", title="The room is already very dead",
            detail=f"Mid-band RT60 is {mid0:.2f} s, under the {lo:.2f} s target: adding absorption would make it worse. "
                   "Hard surfaces or diffusion help instead.",
            addressed_by=[g for g in ("rear_wall",) if g in groups], after=f"Predicted {mid1:.2f} s.",
        ))  # fmt: skip
    t125_0, t125_1 = rep.rt60_s[0], after[0]
    low_modes = sorted(m.freq_hz for m in rep.modes if m.freq_hz < 200)
    gaps = [b - a for a, b in itertools.pairwise(low_modes)]
    clusters = [f"{a:.0f}/{b:.0f} Hz" for a, b in itertools.pairwise(low_modes) if b - a < 5]
    out.append(Problem(
        id="bass", severity="high" if t125_0 > tg[0][1] * 1.3 else "medium",
        title="Bass resonances (room modes)",
        detail=f"Below ~{rep.schroeder_hz:.0f} Hz the room's modes dominate. Lowest axial modes: "
               f"{', '.join(f'{f:.0f}' for f in low_modes[:6])} Hz"
               + (f"; modes nearly on top of each other at {', '.join(clusters[:3])} boom on those notes" if clusters else "")
               + (f"; the biggest gap between modes is {max(gaps):.0f} Hz, so some notes are weak" if gaps else "")
               + f". 125 Hz rings for {t125_0:.2f} s.",
        addressed_by=[g for g in ("corner", "rear_wall", "front_wall") if g in groups],
        after=f"125 Hz decay predicted {t125_1:.2f} s. Traps shorten the ringing; the modes stay where they are.",
    ))  # fmt: skip
    early = [
        r for r in cands.reflections if r.delay_ms <= REFLECTION_WINDOW_MS and r.level_db > -10
    ]
    if early:
        worst = max(early, key=lambda r: r.level_db)
        out.append(Problem(
            id="reflections", severity="high" if objective.needs_rfz else "medium",
            title="Strong early reflections",
            detail=f"{len(early)} reflections reach the {'listening position' if layout.kind == 'monitoring' else 'mic'} within "
                   f"{REFLECTION_WINDOW_MS:.0f} ms and less than 10 dB below the direct sound (worst: {worst.source} off the "
                   f"{worst.surface}, {worst.delay_ms:.1f} ms, {worst.level_db:+.1f} dB). They blur the stereo image and colour the tone (comb filtering).",
            addressed_by=[g for g in ("first_reflection", "ceiling") if g in groups],
            after="See the reflection table for each one after treatment.",
        ))  # fmt: skip
    if any(i.group == "front_wall" for i in items):
        out.append(Problem(
            id="sbir", severity="medium", title="Speakers close to the front wall",
            detail=next(i.reason for i in items if i.group == "front_wall"),
            addressed_by=["front_wall"], after="Thick panels behind the speakers reduce the cancellation.",
        ))  # fmt: skip
    names = wall_names(geo, layout)
    for p in parallel_wall_pairs(geo.polygon)[:2]:
        treated = any(i.wall in (p.a, p.b) for i in items)
        out.append(Problem(
            id=f"flutter{p.a}-{p.b}", severity="low", title=f"Parallel {names[p.a]} and {names[p.b]}",
            detail=f"They face each other {p.separation_m:.1f} m apart over {p.overlap_m:.1f} m: a clap can ring back and forth (flutter echo).",
            addressed_by=sorted({i.group for i in items if i.wall in (p.a, p.b)}),
            after="Panels on one of them break up the flutter." if treated else "Not treated by this plan.",
        ))  # fmt: skip
    return out


HAZARD = {
    "street_facing_window": (
        "high",
        "Window onto the street or neighbours",
        "Glass is the weakest part of a wall for outside noise; heavy curtains or a window plug help, panels do not.",
    ),
    "single_glazing": (
        "high",
        "Thin single glazing",
        "Lets traffic and voices in; secondary glazing or a window plug is the fix.",
    ),
    "hvac_vent": (
        "medium",
        "HVAC vent",
        "Air noise and duct-borne sound from other rooms; switch it off while recording or fit a baffled vent.",
    ),
    "ceiling_fan": ("medium", "Ceiling fan", "Motor and blade noise; turn it off while recording."),
    "appliance": (
        "medium",
        "Appliance nearby",
        "Hum and compressor cycles end up on recordings; unplug or move it.",
    ),
    "aquarium": (
        "medium",
        "Aquarium pump",
        "A constant hum and bubbling; switch it off while recording.",
    ),
    "fireplace": (
        "low",
        "Fireplace",
        "An open flue lets outside noise in and is a hard reflective surface.",
    ),
    "large_mirror": (
        "medium",
        "Large mirror",
        "A hard, flat reflector; cover it or move it off the first-reflection points.",
    ),
    "large_glass": (
        "medium",
        "Large glass surface",
        "Reflects mids and highs strongly; curtains or a rug in front help.",
    ),
    "open_plan_connection": (
        "medium",
        "Open to another space",
        "Sound leaks both ways and the bigger connected volume rings longer than this room alone.",
    ),
    "stairwell": (
        "low",
        "Stairwell",
        "Footsteps and household noise carry in; the coupled space adds a late tail.",
    ),
    "exposed_pipes": ("low", "Exposed pipes", "Water noise when plumbing is used elsewhere."),
    "hard_bare_surfaces": (
        "low",
        "Large bare hard surfaces",
        "Strong reflections; the plan places absorption, a rug helps the floor.",
    ),
    "other": ("low", "Other concern", ""),
}


def _site_problems(rm: RoomModel, items: list[PlacedItem], layout: Layout) -> list[Problem]:
    out = []
    names = wall_names(rm.geometry, layout)
    for k, h in enumerate(rm.hazards):
        sev, title, why = HAZARD.get(h.kind, HAZARD["other"])
        where = f" ({names[h.wall]})" if h.wall is not None else ""
        out.append(Problem(id=f"hazard{k}", severity=sev, title=title + where,  # type: ignore[arg-type]
                           detail=f"{h.note} {why}".strip(), addressed_by=[],
                           after=f"Seen by the surroundings agent ({h.confidence:.0%} confidence); not something panels fix."))  # fmt: skip
    blocked = [i for i in items if i.status == "blocked"]
    if blocked:
        what = sorted({b.label for i in blocked for b in i.blocked_by})
        out.append(Problem(
            id="furniture", severity="medium", title="Furniture is in the way of some treatment",
            detail=f"{len(blocked)} item(s) sit where the acoustics need them but {', '.join(what)} "
                   "stand in the way (shown see-through in the 3D view).",
            addressed_by=sorted({i.group for i in blocked}),
            after="Move that furniture, or accept slightly less effect from those items.",
        ))  # fmt: skip
    return out


def _alternatives(best: Scored, ranked: list[Scored]) -> list[Alternative]:
    seen, out = set(), []
    for s in ranked:
        key = (
            s.config.reflection_panels,
            s.config.traps,
            s.config.cloud,
            s.config.rear,
            s.config.front,
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(
            Alternative(
                summary=s.summary,
                items=len(s.items),
                mid_rt60_s=_mid(s.rt60_s),
                score=round(s.score, 2),
                chosen=s is best,
            )
        )
        if len(out) == 5:
            break
    return out


def _summary(rm: RoomModel, rep: AcousticReport, layout: Layout) -> RoomSummary:
    geo = rm.geometry
    names = wall_names(geo, layout)
    return RoomSummary(
        polygon=geo.polygon,
        floor_z=geo.floor_z,
        height_m=geo.height.value,
        height_provenance=geo.height.provenance,
        area_m2=geo.area_m2,
        volume_m3=rep.geometry.volume_m3,
        geometry_source=geo.source,
        walls=[
            {
                "index": w.index,
                "name": names[w.index],
                "length_m": round(w.length_m, 2),
                "coverage": w.coverage,
                "openings": w.openings,
                "surface_offset_m": round(w.surface_offset_m, 3),
            }
            for w in geo.walls
        ],
        materials=[m.model_dump() for m in rm.materials],
        furniture=rep.furniture,
        furniture_basis=rm.furniture_basis,
        vision_status=rm.vision_status,
        vision_reason=rm.vision_reason,
        agents=[a.model_dump(exclude={"answer"}) for a in rm.agents],
        wall_findings=[{**w.model_dump(exclude={"view"}), "name": names[w.wall]} for w in rm.walls],
        pieces=[p.model_dump() for p in rm.pieces],
        hazards=[
            {**h.model_dump(), "wall_name": names.get(h.wall) if h.wall is not None else None}
            for h in rm.hazards
        ],
        furniture_objects=[o.model_dump() for o in rm.furniture_objects],
        absorption_notes=rm.absorption_notes,
    )
