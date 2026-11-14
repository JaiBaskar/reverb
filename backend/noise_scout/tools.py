"""Deterministic tools for the Noise Scout agent, plus the ledger of evidence they returned.

The agent may only cite OSM ids that a tool returned in this run (see validate.py). Distances
and bearings are computed here, never by the model.
"""

import json
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from langchain_core.tools import BaseTool, tool

from noise import geo
from noise.categories import BY_NAME
from noise.models import NoiseReport
from noise.overpass import USER_AGENT
from noise.overpass import fetch as overpass_fetch
from noise_scout.models import Evidence

OSM_API = "https://api.openstreetmap.org/api/0.6"
MAX_RESULTS = 8

# Extra source kinds beyond B1's categories: (Overpass selector, radius m, why it matters)
SEARCH_KINDS: dict[str, tuple[str, int, str]] = {
    "fire_station": ('nwr["amenity"="fire_station"]', 1500, "siren departures"),
    "hospital": ('nwr["amenity"="hospital"]', 1500, "ambulance sirens"),
    "police": ('nwr["amenity"="police"]', 1000, "sirens"),
    "rail_station": ('nwr["railway"~"^(station|halt)$"]', 1000, "trains, announcements"),
    "transit_stop": ('nwr["highway"="bus_stop"]', 250, "buses braking and idling"),
    "school": ('nwr["amenity"~"^(school|kindergarten|college)$"]', 400, "recess, drop-off"),
    "place_of_worship": ('nwr["amenity"="place_of_worship"]', 400, "bells, gatherings"),
    "restaurant": ('nwr["amenity"~"^(restaurant|fast_food|cafe)$"]', 200, "patrons, deliveries"),
    "sports": ('nwr["leisure"~"^(pitch|sports_centre|stadium|park)$"]', 400, "games, crowds"),
    "fuel": ('nwr["amenity"="fuel"]', 300, "traffic, compressors"),
    "commercial": ('nwr["landuse"~"^(commercial|retail)$"]', 300, "deliveries, HVAC"),
    "parking": ('nwr["amenity"="parking"]', 200, "car doors, alarms"),
}

ORIENTATION_NOTE = (
    "Room orientation relative to north is unknown (Matterport coordinates are not tied to "
    "compass directions), so no claim can be made about which rooms face a source."
)


class EvidenceLedger:
    """Everything the tools returned in one run, keyed by OSM id. Thread-safe."""

    def __init__(self) -> None:
        self._items: dict[str, Evidence] = {}
        self._lock = threading.Lock()

    def add(self, ev: Evidence) -> None:
        with self._lock:
            old = self._items.get(ev.id)
            if old is not None and old.tags and not ev.tags:
                ev = ev.model_copy(update={"tags": old.tags})
            self._items[ev.id] = ev

    def set_tags(self, osm_id: str, tags: dict[str, str]) -> None:
        with self._lock:
            if osm_id in self._items:
                self._items[osm_id] = self._items[osm_id].model_copy(update={"tags": tags})

    def get(self, osm_id: str) -> Evidence | None:
        return self._items.get(osm_id)

    def __contains__(self, osm_id: str) -> bool:
        return osm_id in self._items


def fetch_osm_tags(osm_id: str) -> dict[str, str]:
    kind, num = osm_id.split("/")
    resp = httpx.get(f"{OSM_API}/{kind}/{num}.json", headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    elements = resp.json().get("elements", [])
    return elements[0].get("tags", {}) if elements else {}


@dataclass
class ScoutContext:
    sid: str
    address: str | None
    lat: float
    lon: float
    noise: NoiseReport
    facts: list[dict]
    cache_dir: Path
    ledger: EvidenceLedger = field(default_factory=EvidenceLedger)
    overpass: Callable[[str], dict] = overpass_fetch
    osm_tags: Callable[[str], dict] = fetch_osm_tags


def _cached_json(path: Path, produce: Callable[[], object]) -> object:
    if path.exists():
        return json.loads(path.read_text())
    value = produce()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return value


def build_tools(ctx: ScoutContext) -> list[BaseTool]:
    """Tools bound to one property and one evidence ledger."""

    @tool
    def get_property_context() -> str:
        """Address, coordinates and CoStar building facts (year built, construction, stories)
        for the property, plus the relative exposure levels per noise category."""
        return json.dumps(
            {
                "address": ctx.address,
                "lat": ctx.lat,
                "lon": ctx.lon,
                "building_facts": ctx.facts,
                "exposure_by_category": [e.model_dump() for e in ctx.noise.exposure],
                "notes": [ORIENTATION_NOTE, *ctx.noise.notes],
            }
        )

    @tool
    def list_noise_sources(category: str) -> str:
        """Mapped noise sources in one category, nearest first, with distance (m), compass
        bearing from the property and OSM id. Categories: airport, heliport, rail, road_major,
        road_minor, construction, venue, industrial."""
        if category not in BY_NAME:
            return f"Unknown category '{category}'. Use one of: {', '.join(BY_NAME)}."
        out = []
        for s in ctx.noise.sources:
            if s.category != category:
                continue
            ev = Evidence(
                id=s.id,
                name=s.name,
                kind=s.category,
                subtype=s.subtype,
                distance_m=s.distance_m,
                bearing_compass=s.bearing_compass,
                osm_url=s.osm_url,
                source_tool="list_noise_sources",
            )
            ctx.ledger.add(ev)
            row = ev.model_dump(exclude={"tags", "source_tool", "distance_note"})
            row["category"] = row.pop("kind")
            out.append(row)
            if len(out) >= MAX_RESULTS:
                break
        if not out:
            cat = BY_NAME[category]
            return f"No mapped {cat.label.lower()} within {cat.radius_m} m."
        return json.dumps(out)

    @tool
    def get_osm_tags(osm_id: str) -> str:
        """All OpenStreetMap tags of one feature (e.g. maxspeed, lanes, opening_hours,
        railway usage). Only for OSM ids already returned by list_noise_sources or
        search_nearby."""
        if not re.fullmatch(r"(node|way|relation)/\d+", osm_id):
            return "osm_id must look like 'way/123'."
        if osm_id not in ctx.ledger:
            return f"{osm_id} was not returned by list_noise_sources or search_nearby."
        try:
            tags = _cached_json(
                ctx.cache_dir / "tags" / f"{osm_id.replace('/', '_')}.json",
                lambda: ctx.osm_tags(osm_id),
            )
        except Exception as exc:  # noqa: BLE001 - report tool failures to the agent
            return f"Could not fetch tags for {osm_id}: {type(exc).__name__}"
        ctx.ledger.set_tags(osm_id, tags)
        return json.dumps(tags)

    @tool
    def search_nearby(kind: str) -> str:
        """Find other potential noise sources near the property from OpenStreetMap, nearest
        first, with distance and bearing. Kinds: fire_station, hospital, police, rail_station,
        transit_stop, school, place_of_worship, restaurant, sports, fuel, commercial,
        parking."""
        if kind not in SEARCH_KINDS:
            return f"Unknown kind '{kind}'. Use one of: {', '.join(SEARCH_KINDS)}."
        selector, radius, why = SEARCH_KINDS[kind]
        query = (
            f"[out:json][timeout:25];({selector}(around:{radius},{ctx.lat},{ctx.lon}););"
            "out tags center;"
        )
        try:
            payload = _cached_json(
                ctx.cache_dir / "search" / f"{ctx.sid}_{kind}.json",
                lambda: ctx.overpass(query),
            )
        except Exception as exc:  # noqa: BLE001
            return f"OpenStreetMap search failed: {type(exc).__name__}"
        found = []
        for el in payload.get("elements", []):
            point = (el.get("lat"), el.get("lon")) if "lat" in el else None
            if point is None and "center" in el:
                point = (el["center"]["lat"], el["center"]["lon"])
            if point is None:
                continue
            dist = geo.haversine_m(ctx.lat, ctx.lon, *point)
            brg = geo.bearing_deg(ctx.lat, ctx.lon, *point)
            osm_id = f"{el['type']}/{el['id']}"
            tags = el.get("tags", {})
            found.append(
                Evidence(
                    id=osm_id,
                    name=tags.get("name"),
                    kind=kind,
                    subtype=None,
                    distance_m=round(dist, 1),
                    bearing_compass=geo.compass(brg),
                    osm_url=f"https://www.openstreetmap.org/{osm_id}",
                    tags=tags,
                    source_tool="search_nearby",
                    distance_note=None if el["type"] == "node" else "to the feature's centre",
                )
            )
        found.sort(key=lambda e: e.distance_m or 0)
        found = found[:MAX_RESULTS]
        for ev in found:
            ctx.ledger.add(ev)
        if not found:
            return f"No {kind.replace('_', ' ')} mapped within {radius} m."
        return json.dumps(
            {
                "why_it_can_matter": why,
                "radius_m": radius,
                "results": [
                    ev.model_dump(exclude={"source_tool", "subtype"}, exclude_none=True)
                    for ev in found
                ],
            }
        )

    return [get_property_context, list_noise_sources, get_osm_tags, search_nearby]
