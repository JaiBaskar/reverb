"""Build a NoiseReport for a location: Overpass query, parse, exposure rules, JSON cache."""

import json
import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from noise import overpass
from noise.categories import CATEGORIES, MAX_RADIUS_M, Category
from noise.models import CategoryExposure, NoiseReport, NoiseSource, Provenance

Fetcher = Callable[[str], dict]

BASE_NOTES = [
    "Sources come from OpenStreetMap, which may be incomplete or out of date.",
    (
        "Exposure levels are relative, based only on distance to the nearest mapped "
        "source in each category. They are not decibels and not measurements."
    ),
]


def default_cache_dir() -> Path:
    root = (
        os.environ.get("REVERB_DATA_DIR")
        or Path(__file__).resolve().parents[2] / "data"
    )
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
) -> NoiseReport:
    sources = overpass.parse(payload, lat, lon)
    notes = list(BASE_NOTES)
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
        exposure=[exposure_for(c, sources) for c in CATEGORIES],
        notes=notes,
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
    """Cached per property. Failures return an error report (not cached) instead of raising."""
    cache_dir = cache_dir or default_cache_dir()
    path = _cache_path(cache_dir, sid, lat, lon)
    if not refresh and path.exists():
        cached = NoiseReport.model_validate_json(path.read_text())
        if abs(cached.lat - lat) < 1e-6 and abs(cached.lon - lon) < 1e-6:
            return cached
    fetch = fetcher or overpass.fetch
    try:
        payload = fetch(overpass.build_query(lat, lon))
    except overpass.OverpassError as exc:
        return error_report(lat, lon, sid, location_provenance, str(exc)[:300])
    report = build_report(payload, lat, lon, sid, location_provenance)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.model_dump(mode="json"), indent=1))
    return report
