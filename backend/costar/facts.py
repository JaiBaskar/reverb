"""Turn CoStar kit records into property facts with provenance. Pure functions.

Missing or 'Unknown' values become provenance 'missing'; nothing is filled in.
"""

from acoustics.materials import MATERIALS
from costar.models import Fact, MaterialHint, PropertyFacts

SQFT_TO_M2 = 0.09290304
FT_TO_M = 0.3048
RES_SOURCE = "CoStar residential listing (MLS)"
COM_SOURCE = "CoStar commercial property record"

# Flooring feature words -> material preset id in acoustics/materials.py
FLOOR_WORDS = (
    ("wood", "hardwood"),
    ("hardwood", "hardwood"),
    ("carpet", "carpet"),
    ("tile", "tile"),
)


def _fact(key, label, value, source, unit=None, note=None) -> Fact:
    missing = value is None
    return Fact(
        key=key,
        label=label,
        value=value,
        unit=unit,
        provenance="missing" if missing else "verified",
        source=None if missing else source,
        note=note,
    )


def _ceiling(value_m: float | None, source: str) -> Fact:
    return _fact(
        "ceiling_height_m",
        "Ceiling height",
        None if value_m is None else round(value_m, 2),
        source,
        unit="m",
        note=None if value_m is not None else "Not recorded in CoStar for this property.",
    )


def _area(sqft: float | None, source: str) -> list[Fact]:
    if not sqft:
        return []
    return [_fact("building_area_m2", "Building area", round(sqft * SQFT_TO_M2, 1), source, "m2",
                  note=f"{sqft:,.0f} sq ft")]  # fmt: skip


def _hints(hardwood: bool | None, flooring: list[str]) -> list[MaterialHint]:
    hints: dict[str, MaterialHint] = {}
    if hardwood:
        hints["hardwood"] = MaterialHint(
            surface="floor", material_id="hardwood", reason="CoStar lists hardwood floors."
        )
    for name in flooring:
        for word, mid in FLOOR_WORDS:
            if word in name.lower() and mid not in hints and mid in MATERIALS:
                hints[mid] = MaterialHint(
                    surface="floor", material_id=mid, reason=f"CoStar flooring feature: {name}."
                )
    return [h for h in hints.values() if h.material_id in MATERIALS]


def residential_facts(listing: dict, features: dict | None, sid: str = "") -> PropertyFacts:
    prop = listing.get("property") or {}
    reso = listing.get("resoValues") or {}
    struct = reso.get("structure") or {}
    hardwood = reso.get("hasHardwoodFloors")
    if hardwood is None:
        hardwood = (listing.get("costarFeatureValues") or {}).get("hasHardwoodFloors")
    mls = [
        f for f in (features or {}).get("features", []) if f.get("source", "Mls") == "Mls"
    ]  # MachineLearning features are guesses from photos/remarks: leave them out
    flooring = [f["name"] for f in mls if f.get("subcategory1") == "Flooring" and f.get("name")]
    names = {f.get("name") for f in mls}

    facts = [
        _fact("construction", "Construction", None, RES_SOURCE,
              note="CoStar residential listings do not record the structural material."),
        _fact("year_built", "Year built", prop.get("yearBuilt") or struct.get("yearBuilt"),
              RES_SOURCE),
        _fact("floors", "Floors", prop.get("stories") or struct.get("stories"), RES_SOURCE),
        _fact("hardwood_floors", "Hardwood floors", hardwood, RES_SOURCE),
        _ceiling(None, RES_SOURCE),
    ]  # fmt: skip
    if struct.get("architecturalStyle"):
        facts.append(
            _fact("architectural_style", "Style", struct["architecturalStyle"], RES_SOURCE)
        )
    if prop.get("mlsPropertyType"):
        facts.append(_fact("property_type", "Property type", prop["mlsPropertyType"], RES_SOURCE))
    facts += _area(prop.get("sqftMax") or prop.get("sqftMin"), RES_SOURCE)
    if flooring:
        facts.append(_fact("flooring", "Flooring", "; ".join(flooring), RES_SOURCE))
    if "No Common Walls" in names:
        facts.append(
            _fact("no_common_walls", "No shared walls", True, RES_SOURCE,
                  note="Detached: no walls shared with neighbours.")
        )  # fmt: skip
    return PropertyFacts(
        sid=sid,
        kind="residential",
        costar_id=listing.get("id"),
        facts=facts,
        material_hints=_hints(hardwood, flooring),
    )


def _enum(enums: dict, name: str, value) -> str | None:
    label = enums.get(name, {}).get(str(value)) if value is not None else None
    return None if label in (None, "Unknown", "PropertyTypeUnknown") else label


def _year_built(events: list[dict], enums: dict) -> tuple[int | None, str | None]:
    names = {
        e.get("year"): _enum(enums, "ConstructionEventType", e.get("eventType")) for e in events
    }
    done = [y for y, n in names.items() if n == "ConstructionComplete" and y]
    if done:
        return max(done), None
    started = [y for y, n in names.items() if n == "GroundBreaking" and y]
    if started:
        return max(started), "Only a ground-breaking year is recorded; completion may be later."
    return None, None


def commercial_facts(prop: dict, enums: dict, sid: str = "") -> PropertyFacts:
    year, year_note = _year_built(prop.get("constructionEvents") or [], enums)
    structural = prop.get("structural") or {}
    residence = prop.get("propertyResidence") or {}
    ceiling_m = None
    if structural.get("ceilingHeightFeet") is not None:
        inches = structural["ceilingHeightFeet"] * 12 + (structural.get("ceilingHeightInches") or 0)
        ceiling_m = inches * 0.0254
    elif residence.get("ceilingHeightMainInFeet") is not None:
        ceiling_m = residence["ceilingHeightMainInFeet"] * FT_TO_M
    material = _enum(
        enums, "BuildingConstructionMaterialType", prop.get("buildingConstructionMaterial")
    )

    facts = [
        _fact("construction", "Construction", material, COM_SOURCE,
              note=None if material else "Structural material is 'Unknown' in CoStar."),
        _fact("year_built", "Year built", year, COM_SOURCE, note=year_note),
        _fact("floors", "Floors", prop.get("numStoriesAboveGrade"), COM_SOURCE),
        _fact("hardwood_floors", "Hardwood floors", None, COM_SOURCE,
              note="Not recorded for commercial properties."),
        _ceiling(ceiling_m, COM_SOURCE),
    ]  # fmt: skip
    ptype = _enum(enums, "PropertyType", prop.get("propertyType"))
    if ptype:
        facts.append(_fact("property_type", "Property type", ptype, COM_SOURCE))
    bclass = _enum(enums, "BuildingClass", prop.get("buildingClass"))
    if bclass:
        facts.append(_fact("building_class", "Building class", bclass, COM_SOURCE))
    if prop.get("buildingName"):
        facts.append(_fact("building_name", "Building", prop["buildingName"], COM_SOURCE))
    facts += _area(prop.get("grossBuildingAreaSquareFeet"), COM_SOURCE)
    units = (prop.get("propertyApartment") or {}).get("totalNumUnits")
    if units:
        facts.append(_fact("units", "Units", units, COM_SOURCE))
    return PropertyFacts(sid=sid, kind="commercial", costar_id=prop.get("id"), facts=facts)
