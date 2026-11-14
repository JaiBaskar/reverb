"""CoStar property facts for a Matterport model id, cached per property."""

import os
from pathlib import Path

from costar import kit as kitmod
from costar.facts import commercial_facts, residential_facts
from costar.models import PropertyFacts


def default_cache_dir() -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or kitmod.ROOT / "data"
    return Path(root) / "cache" / "costar"


def _unavailable(sid: str, note: str) -> PropertyFacts:
    return PropertyFacts(sid=sid, status="unavailable", notes=[note])


def get_facts(
    sid: str, *, kit_dir: Path | None = None, cache_dir: Path | None = None
) -> PropertyFacts:
    kit = kit_dir or kitmod.kit_dir()
    cache = (cache_dir or default_cache_dir()) / f"{sid}.json"
    if cache.exists():
        return PropertyFacts.model_validate_json(cache.read_text())
    if not (kit / "residential-listings.csv").exists():
        return _unavailable(
            sid, f"CoStar kit not found at {kit.name}/; download it into data/costar-kit/kit."
        )
    joined = kitmod.lookup(sid, kit)
    if joined is None:
        return _unavailable(sid, f"{sid} is not in the CoStar kit.")
    kind, cid = joined
    if kind == "residential":
        listing = kitmod.load("residential-listings", cid, kit)
        if listing is None:
            return _unavailable(sid, f"Listing {cid} is in the CSV but not in the data.")
        features = kitmod.load("residential-listing-features", cid, kit)
        facts = residential_facts(listing, features, sid)
    else:
        prop = kitmod.load("commercial-property", cid, kit)
        if prop is None:
            return _unavailable(sid, f"Property {cid} is in the CSV but not in the data.")
        facts = commercial_facts(prop, kitmod.enums(kit), sid)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(facts.model_dump_json(indent=1))
    return facts
