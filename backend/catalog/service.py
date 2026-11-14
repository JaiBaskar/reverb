"""Cached discovery index over the CoStar kit."""

import json
import os
from functools import lru_cache
from pathlib import Path

from catalog.build import build_index
from catalog.models import CatalogEntry
from costar import kit as kitmod


def cache_path() -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or kitmod.ROOT / "data"
    return Path(root) / "cache" / "catalog" / "index.json"


@lru_cache(maxsize=1)
def load_index() -> tuple[CatalogEntry, ...]:
    """Built once from the kit (about 20 s) and cached on disk; empty if the kit is absent."""
    path = cache_path()
    if path.exists():
        return tuple(CatalogEntry.model_validate(e) for e in json.loads(path.read_text()))
    kit = kitmod.kit_dir()
    if not (kit / "commercial-properties.csv").exists():
        return ()
    entries = build_index(kit)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([e.model_dump() for e in entries]))
    return tuple(entries)


@lru_cache(maxsize=1)
def known_model_ids() -> frozenset[str]:
    return frozenset(sid for e in load_index() for sid in e.model_ids)


def entry_for(sid: str) -> CatalogEntry | None:
    return next((e for e in load_index() if sid in e.model_ids), None)
