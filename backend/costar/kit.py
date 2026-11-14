"""Read the CoStar kit (data/costar-kit/kit, git-ignored): CSV join and JSONL lookups."""

import csv
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def kit_dir() -> Path:
    return Path(os.environ.get("COSTAR_KIT_DIR") or ROOT / "data" / "costar-kit" / "kit")


def lookup(sid: str, kit: Path) -> tuple[str, int] | None:
    """Matterport model id -> ('residential', ListingId) or ('commercial', PropertyId)."""
    for kind, fname, key in (
        ("residential", "residential-listings.csv", "ListingId"),
        ("commercial", "commercial-properties.csv", "PropertyId"),
    ):
        with open(kit / fname, newline="") as f:
            for row in csv.DictReader(f):
                if row.get("MatterportModelId") == sid and row.get(key):
                    return kind, int(row[key])
    return None


def load(dataset: str, record_id: int, kit: Path) -> dict | None:
    """Stream data/<dataset>.jsonl and return the record whose id matches (files are large)."""
    needle = str(record_id)
    with open(kit / "data" / f"{dataset}.jsonl") as f:
        for line in f:
            if needle in line:
                rec = json.loads(line)
                if rec.get("id") == record_id:
                    return rec
    return None


def enums(kit: Path) -> dict:
    return json.loads((kit / "schemas" / "enums.json").read_text())
