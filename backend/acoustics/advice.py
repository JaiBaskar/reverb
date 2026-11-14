"""Room recommendations from the calculated numbers only (fixed templates, no LLM).

Uses the acoustic report (materials and furniture already in the absorption), the room's
real outline (parallel walls, wall clearance) and the spatial field (best spot, bass and
reflection maps).
"""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel

from acoustics.field import REFLECTION_FLOOR_DB as fld_floor
from acoustics.field import RoomField
from acoustics.furniture import FURNITURE, furniture_absorption
from acoustics.report import AcousticReport
from suitability.treatment import treatment

Severity = Literal["info", "consider", "important"]
FLUTTER_MIN_SEPARATION_M = 1.5
HARD_ALPHA = 0.15  # walls below this at 1-2 kHz reflect most mid/high sound
TARGET_MID_RT60 = (0.3, 0.5)  # small-room recording/mixing range used for the panel estimate


class Advice(BaseModel):
    kind: str
    severity: Severity
    title: str
    detail: str


class WallPair(BaseModel):
    a: int
    b: int
    separation_m: float
    overlap_m: float


def parallel_wall_pairs(poly) -> list[WallPair]:
    edges = [(poly[i - 1], poly[i]) for i in range(len(poly))]
    out = []
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            (a0, a1), (b0, b1) = edges[i], edges[j]
            va = np.subtract(a1, a0)
            vb = np.subtract(b1, b0)
            la, lb = np.linalg.norm(va), np.linalg.norm(vb)
            if la < 1.0 or lb < 1.0:
                continue
            ua = va / la
            if abs(abs(float(np.dot(ua, vb / lb))) - 1) > 1 - math.cos(math.radians(5)):
                continue
            n = np.array([-ua[1], ua[0]])
            sep = abs(float(np.dot(np.subtract(b0, a0), n)))
            if sep < FLUTTER_MIN_SEPARATION_M:
                continue
            ta = sorted([0.0, la])
            tb = sorted(
                [float(np.dot(np.subtract(b0, a0), ua)), float(np.dot(np.subtract(b1, a0), ua))]
            )
            overlap = min(ta[1], tb[1]) - max(ta[0], tb[0])
            if overlap >= 1.0:
                out.append(WallPair(a=i, b=j, separation_m=sep, overlap_m=overlap))
    return out


def _arr(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def advise(rep: AcousticReport, fld: RoomField, poly) -> list[Advice]:
    out: list[Advice] = []
    bass, refl, c50 = _arr(fld.bass_spread_db), _arr(fld.reflection_db), _arr(fld.c50_db)
    bi = round((fld.best_spot[1] - fld.origin[1]) / fld.step) * fld.nx + round(
        (fld.best_spot[0] - fld.origin[0]) / fld.step
    )
    wall_gap = min(_seg_dist(fld.best_spot, poly[i - 1], poly[i]) for i in range(len(poly)))

    out.append(
        Advice(
            kind="placement",
            severity="important",
            title="Best spot for the mic or the listening seat",
            detail=(
                f"The marked spot is {wall_gap:.1f} m from the nearest wall and "
                f"{math.dist(fld.best_spot, fld.source):.1f} m from the sound source. There the "
                f"model gives bass unevenness {bass[bi]:.1f} dB (room range "
                f"{np.nanmin(bass):.1f}-{np.nanmax(bass):.1f} dB), "
                + (
                    f"an early wall reflection {refl[bi]:+.1f} dB relative to the direct sound"
                    if refl[bi] > fld_floor
                    else "no strong early wall reflection"
                )
                + f" and clarity C50 {c50[bi]:+.1f} dB."
            ),
        )
    )

    t = treatment(rep, TARGET_MID_RT60)
    mid = t.current_mid_s
    if t.verdict == "add_absorption":
        detail = (
            f"Mid-band RT60 is {mid:.2f} s against {TARGET_MID_RT60[0]}-{TARGET_MID_RT60[1]} s "
            f"for recording and mixing: about {t.panels} acoustic panels "
            f"({t.panel_area_m2:.1f} m2, {t.coverage:.0%} of the surfaces). {t.reason}"
        )
        sev: Severity = "important"
    elif t.verdict == "impractical":
        detail = f"Mid-band RT60 is {mid:.2f} s. {t.reason}"
        sev = "important"
    else:
        detail = t.reason
        sev = "info"
    out.append(Advice(kind="reverb", severity=sev, title="Reverberation", detail=detail))

    spread = float(np.nanmax(bass) - np.nanmin(bass))
    out.append(
        Advice(
            kind="bass",
            severity="important" if np.nanmax(bass) > 6 else "consider",
            title="Bass varies across the room",
            detail=(
                f"Below the Schroeder frequency ({rep.schroeder_hz:.0f} Hz) room modes dominate: the "
                f"30-200 Hz response spread ranges {np.nanmin(bass):.1f}-{np.nanmax(bass):.1f} dB "
                f"across the floor ({spread:.1f} dB difference). Avoid the worst (red) areas for "
                "the listening seat; bass traps in the corners help more than panels."
            ),
        )
    )

    near = refl[~np.isnan(refl)] > -6
    share = float(near.mean()) if near.size else 0.0
    out.append(
        Advice(
            kind="reflections",
            severity="consider" if share > 0.15 else "info",
            title="Strong early reflections near walls",
            detail=(
                f"On {share:.0%} of the floor a wall reflection arrives within about 5 ms of the "
                "direct sound and within 6 dB of it, which colours the sound (comb filtering). "
                "Keep mics and the seat out of those areas, mostly along the walls, or put "
                "absorption at the first-reflection points."
            ),
        )
    )

    walls = next(m for m in rep.materials if m.surface == "walls")
    hard = (walls.alpha[3] + walls.alpha[4]) / 2 < HARD_ALPHA
    for p in parallel_wall_pairs(poly)[:2]:
        out.append(
            Advice(
                kind="flutter",
                severity="consider" if hard else "info",
                title=f"Parallel walls {p.separation_m:.1f} m apart",
                detail=(
                    f"Two {'hard ' if hard else ''}walls face each other {p.separation_m:.1f} m "
                    f"apart over {p.overlap_m:.1f} m: a clap can ring back and forth (flutter "
                    "echo). Diffusion or absorption on one of them breaks it up."
                ),
            )
        )

    if rep.furniture:
        fa = furniture_absorption(rep.furniture)
        share_f = (fa[2] + fa[3]) / (rep.absorption_sabins[2] + rep.absorption_sabins[3])
        names = ", ".join(FURNITURE[i.id]["label"].lower() for i in rep.furniture)
        prov = (
            "assumed for this room type"
            if any(i.provenance == "assumed" for i in rep.furniture)
            else "as you entered it"
        )
        detail = (
            f"Furniture ({names}; {prov}) provides {share_f:.0%} of the mid-band absorption. "
            "Moving out or rearranging soft furnishings changes the numbers above."
        )
    else:
        detail = (
            "The room is modeled empty: furniture visible in the scan is not counted. Add it to "
            "see how sofas, beds, rugs and curtains change the room."
        )
    out.append(Advice(kind="furniture", severity="info", title="Furniture", detail=detail))
    return out


def _seg_dist(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy or 1e-12
    t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2))
    return math.hypot(p[0] - ax - t * vx, p[1] - ay - t * vy)
