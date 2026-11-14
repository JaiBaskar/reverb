"""Build the discovery index from the CoStar kit in one pass over each dataset.

Only properties with a Matterport scan are included. Coordinates and addresses come from
CoStar records (verified); nothing is invented when a field is missing.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

from catalog.models import CatalogEntry


def _models_by_id(path: Path, id_col: str) -> dict[int, list[str]]:
    out: dict[int, list[str]] = defaultdict(list)
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            sid = (row.get("MatterportModelId") or "").strip()
            if sid and row.get(id_col):
                ids = out[int(row[id_col])]
                if sid not in ids:
                    ids.append(sid)
    return out


def _stream(path: Path, wanted: set[int]):
    with open(path) as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("id") in wanted:
                yield rec


def _coords(lat, lon) -> tuple[float | None, float | None, str]:
    if lat is None or lon is None:
        return None, None, "missing"
    return float(lat), float(lon), "verified"


def build_index(kit: Path) -> list[CatalogEntry]:
    enums = json.loads((kit / "schemas" / "enums.json").read_text())
    ptypes = enums.get("PropertyType", {})
    entries: list[CatalogEntry] = []

    commercial = _models_by_id(kit / "commercial-properties.csv", "PropertyId")
    for rec in _stream(kit / "data" / "commercial-property.jsonl", set(commercial)):
        a = rec.get("primaryAddress") or {}
        lat, lon, prov = _coords(a.get("latitude"), a.get("longitude"))
        street = " ".join(
            str(p) for p in (a.get("streetNumber"), a.get("streetName"), a.get("streetType")) if p
        )
        label = ptypes.get(str(rec.get("propertyType")))
        entries.append(
            CatalogEntry(
                key=f"commercial-{rec['id']}",
                kind="commercial",
                costar_id=rec["id"],
                sid=commercial[rec["id"]][0],
                model_ids=commercial[rec["id"]],
                address=street or f"CoStar property {rec['id']}",
                city=a.get("city"),
                state=a.get("state"),
                postcode=(a.get("postcode") or "")[:5] or None,
                lat=lat,
                lon=lon,
                coords_provenance=prov,
                type_label=None if label in (None, "Unknown") else label,
                name=rec.get("buildingName"),
            )
        )

    residential = _models_by_id(kit / "residential-listings.csv", "ListingId")
    seen: dict[tuple, CatalogEntry] = {}  # relistings of one home share address and scans
    for rec in _stream(kit / "data" / "residential-listings.jsonl", set(residential)):
        prop = rec.get("property") or {}
        a = prop.get("address") or {}
        address = a.get("fullStreetAddress") or f"CoStar listing {rec['id']}"
        dedupe = (address.lower(), (a.get("city") or "").lower())
        if dedupe in seen:
            for sid in residential[rec["id"]]:
                if sid not in seen[dedupe].model_ids:
                    seen[dedupe].model_ids.append(sid)
            continue
        lat, lon, prov = _coords(a.get("latitude"), a.get("longitude"))
        entry = CatalogEntry(
            key=f"residential-{rec['id']}",
            kind="residential",
            costar_id=rec["id"],
            sid=residential[rec["id"]][0],
            model_ids=list(residential[rec["id"]]),
            address=address,
            city=a.get("city"),
            state=a.get("state"),
            postcode=a.get("zip"),
            lat=lat,
            lon=lon,
            coords_provenance=prov,
            type_label=prop.get("mlsPropertyType"),
        )
        seen[dedupe] = entry
        entries.append(entry)
    return entries
