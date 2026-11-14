"""Turn raw Matterport room dimensions into rooms with explicit provenance.

Matterport omits width/depth/height/dimensions on some rooms. Nothing is invented silently:
every derived or defaulted value carries `estimated` or `assumed` plus a note.
"""

from statistics import median

from properties.models import Field, Room

DEFAULT_CEILING_M = 2.7
MIN_AREA_M2 = 3.0
UNUSABLE_LABELS = {"void"}


def _verified(v: float | None) -> Field:
    return Field(value=v, provenance="verified") if v else Field(value=None, provenance="missing")


def normalize_rooms(raw_rooms: list[dict]) -> list[Room]:
    heights = [
        r["dimensions"]["height"] for r in raw_rooms if (r.get("dimensions") or {}).get("height")
    ]
    ceiling_est = median(heights) if heights else None
    return [_normalize(r, ceiling_est) for r in raw_rooms]


def _normalize(raw: dict, ceiling_est: float | None) -> Room:
    dims = raw.get("dimensions") or {}
    cls = (raw.get("classifications") or [{}])[0]
    label = cls.get("label") or "Unlabelled"
    issues: list[str] = []

    area = _verified(dims.get("areaFloor"))
    width = _verified(dims.get("width"))
    depth = _verified(dims.get("depth"))
    height = _verified(dims.get("height"))

    if area.value is None:
        issues.append("no floor area from Matterport")
    else:
        if width.value is None and depth.value is not None:
            width = Field(
                value=area.value / depth.value,
                provenance="estimated",
                note="area / depth",
            )
        elif depth.value is None and width.value is not None:
            depth = Field(
                value=area.value / width.value,
                provenance="estimated",
                note="area / width",
            )
        elif width.value is None and depth.value is None:
            side = area.value**0.5
            note = "square footprint assumed from floor area"
            width = Field(value=side, provenance="assumed", note=note)
            depth = Field(value=side, provenance="assumed", note=note)

        if height.value is None:
            if ceiling_est is not None:
                height = Field(
                    value=ceiling_est,
                    provenance="estimated",
                    note="median ceiling height of this property's other rooms",
                )
            else:
                height = Field(
                    value=DEFAULT_CEILING_M,
                    provenance="assumed",
                    note="default ceiling height; no verified heights in this property",
                )

    usable = area.value is not None
    if label.lower() in UNUSABLE_LABELS:
        usable = False
        issues.append("labelled Void by Matterport")
    if area.value is not None and area.value < MIN_AREA_M2:
        usable = False
        issues.append(f"floor area under {MIN_AREA_M2:g} m2")

    return Room(
        id=str(raw.get("id", "")),
        label=label,
        label_confidence=cls.get("confidence"),
        area_m2=area,
        width_m=width,
        depth_m=depth,
        height_m=height,
        usable=usable,
        issues=issues,
    )
