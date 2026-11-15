"""Build a NoiseReport for a location: Overpass query, parse, exposure rules, JSON cache."""

import json
import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from noise import local, overpass
from noise.categories import BASE_CATEGORIES, CATEGORIES, EXTRA_CATEGORIES, MAX_RADIUS_M, Category
from noise.models import CategoryExposure, NoiseReport, NoiseSource, Provenance

log = logging.getLogger(__name__)
Fetcher = Callable[[str], dict]
SCHEMA_VERSION = 2  # bump when the report shape or categories change, to refresh caches

BASE_NOTES = [
    "Sources come from OpenStreetMap, which may be incomplete or out of date.",
    (
        "Exposure levels are relative, based only on distance to the nearest mapped "
        "source in each category. They are not decibels and not measurements."
    ),
]


def default_cache_dir() -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or Path(__file__).resolve().parents[2] / "data"
    return Path(root) / "cache" / "noise"


def exposure_for(cat: Category, sources: list[NoiseSource]) -> CategoryExposure:
    mine = [s for s in sources if s.category == cat.name]
    nearest = min((s.distance_m for s in mine), default=None)
    if nearest is None:
        level, reason = "none", f"No mapped source within {cat.radius_m} m."
    elif nearest <= cat.high_within_m:
        level, reason = (
            "high",
            f"Nearest at {nearest:.0f} m (within {cat.high_within_m} m).",
        )
    elif nearest <= cat.moderate_within_m:
        level = "moderate"
        reason = f"Nearest at {nearest:.0f} m (within {cat.moderate_within_m} m)."
    else:
        level = "low"
        reason = f"Nearest at {nearest:.0f} m (beyond {cat.moderate_within_m} m)."
    return CategoryExposure(
        category=cat.name,
        label=cat.label,
        radius_m=cat.radius_m,
        count=len(mine),
        nearest_m=nearest,
        level=level,
        reason=reason,
    )


def build_report(
    payload: dict,
    lat: float,
    lon: float,
    sid: str | None,
    location_provenance: Provenance,
    categories: tuple[Category, ...] = CATEGORIES,
    extra_notes: list[str] | None = None,
) -> NoiseReport:
    queried = {c.name for c in categories}
    sources = [s for s in overpass.parse(payload, lat, lon) if s.category in queried]
    notes = list(BASE_NOTES) + list(extra_notes or [])
    if payload.get("osm3s", {}).get("timestamp_osm_base"):
        notes.append(f"OSM data as of {payload['osm3s']['timestamp_osm_base']}.")
    if payload.get("remark"):
        notes.append(f"Overpass remark: {payload['remark']}")
    return NoiseReport(
        sid=sid,
        lat=lat,
        lon=lon,
        location_provenance=location_provenance,
        radius_m=MAX_RADIUS_M,
        generated_at=datetime.now(UTC),
        sources=sources,
        exposure=[exposure_for(c, sources) for c in categories],
        notes=notes,
        schema_version=SCHEMA_VERSION,
        categories_queried=[c.name for c in categories],
    )


def error_report(
    lat: float, lon: float, sid: str | None, location_provenance: Provenance, err: str
) -> NoiseReport:
    return NoiseReport(
        sid=sid,
        lat=lat,
        lon=lon,
        location_provenance=location_provenance,
        radius_m=MAX_RADIUS_M,
        generated_at=datetime.now(UTC),
        sources=[],
        exposure=[],
        notes=[f"Noise sources unavailable: OpenStreetMap query failed ({err})."],
        status="error",
    )


def _cache_path(cache_dir: Path, sid: str | None, lat: float, lon: float) -> Path:
    key = sid or f"{lat:.5f}_{lon:.5f}"
    return cache_dir / f"{key}.json"


def get_noise_report(
    lat: float,
    lon: float,
    sid: str | None = None,
    location_provenance: Provenance = "verified",
    *,
    cache_dir: Path | None = None,
    fetcher: Fetcher | None = None,
    refresh: bool = False,
) -> NoiseReport:
    """Cached per property. Two Overpass queries: the base categories with full geometry and
    the extra categories as points. If the extras fail the base is still returned (extras
    marked unavailable); if everything fails, an earlier cache is served with a note, else
    an error report (not cached)."""
    cache_dir = cache_dir or default_cache_dir()
    path = _cache_path(cache_dir, sid, lat, lon)
    # /noise and /noise-risk for the same property arrive together: fetch once.
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(str(path), threading.Lock())
    with lock:
        return _get_noise_report(lat, lon, sid, location_provenance, path, fetcher, refresh)


_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _get_noise_report(lat, lon, sid, location_provenance, path, fetcher, refresh) -> NoiseReport:
    cached = None
    if path.exists():
        candidate = NoiseReport.model_validate_json(path.read_text())
        if abs(candidate.lat - lat) < 1e-6 and abs(candidate.lon - lon) < 1e-6:
            cached = candidate
    complete = cached is not None and {c.name for c in CATEGORIES} <= set(cached.categories_queried)
    if cached and not refresh and cached.schema_version >= SCHEMA_VERSION and complete:
        return cached

    if fetcher is None:  # the local extract answers in milliseconds; Overpass is the fallback
        try:
            found = local.payload_near(lat, lon)
        except Exception:  # a broken or half-built index must not break noise lookups
            log.exception("local OSM index failed")
            found = None
        if found is not None:
            payload, note = found
            return build_report(payload, lat, lon, sid, location_provenance, CATEGORIES, [note])

    fetch = fetcher or overpass.fetch
    # The two queries run at the same time (they used to run one after the other).
    with ThreadPoolExecutor(max_workers=2) as pool:
        base_f = pool.submit(fetch, overpass.build_query(lat, lon, categories=BASE_CATEGORIES))
        extra_f = pool.submit(
            fetch,
            overpass.build_query(
                lat, lon, timeout_s=40, categories=EXTRA_CATEGORIES, geometry=False
            ),
        )
    try:
        payload = base_f.result()
    except overpass.OverpassError as exc:
        if cached is not None:
            note = f"Refresh failed ({str(exc)[:120]}); showing data cached earlier."
            return cached.model_copy(update={"notes": [*cached.notes, note]})
        return error_report(lat, lon, sid, location_provenance, str(exc)[:300])
    categories, notes = BASE_CATEGORIES, []
    try:
        extra = extra_f.result()
        payload = {
            **payload,
            "elements": [*payload.get("elements", []), *extra.get("elements", [])],
        }
        categories = BASE_CATEGORIES + EXTRA_CATEGORIES
    except overpass.OverpassError as exc:
        names = ", ".join(c.label.lower() for c in EXTRA_CATEGORIES)
        notes.append(f"Extra categories unavailable this time ({str(exc)[:80]}): {names}.")
    report = build_report(payload, lat, lon, sid, location_provenance, categories, notes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.model_dump(mode="json"), indent=1))
    return report
