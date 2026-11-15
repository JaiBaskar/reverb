"""Overpass API client: build one query for all categories, fetch it, parse it."""

import re
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import httpx

from noise import geo
from noise.categories import AREA_CATEGORIES, CATEGORIES, Category
from noise.models import NoiseSource

ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
USER_AGENT = "reverb-noise-scout/0.1 (hackathon project)"
TIMEOUT_S = 60.0


class OverpassError(RuntimeError):
    pass


def build_query(
    lat: float,
    lon: float,
    timeout_s: int = 50,
    categories: tuple[Category, ...] = CATEGORIES,
    geometry: bool = True,
) -> str:
    """Ways and nodes come back with full geometry (or centre points if geometry=False);
    relations with a centre point."""
    geom_parts, rel_parts = [], []
    for cat in categories:
        for sel in cat.selectors:
            for el in sel.elements:
                stmt = f'{el}["{sel.key}"~"{sel.pattern}"](around:{cat.radius_m},{lat},{lon});'
                (rel_parts if el == "relation" else geom_parts).append(stmt)
    out = "out tags geom;" if geometry else "out tags center;"
    return (
        f"[out:json][timeout:{timeout_s}];\n"
        f"({' '.join(geom_parts)})->.g;\n.g {out}\n"
        f"({' '.join(rel_parts)})->.r;\n.r out tags center;\n"
    )


HEDGE_S = 8.0  # no answer from a mirror after this long: ask the next one too


def fetch(query: str, client: httpx.Client | None = None) -> dict:
    """POST the query to the mirrors and return the first good answer.

    Hedged: a mirror that fails moves on to the next at once, and one that has not answered
    within HEDGE_S gets company from the next mirror; the first success wins. Public Overpass
    mirrors are often refused, overloaded or slow, and one slow mirror used to cost a minute
    before the next was tried. Raises OverpassError if all fail.
    """
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT})
    errors: list[str] = []

    def one(url: str) -> dict:
        resp = client.post(url, data={"data": query})
        resp.raise_for_status()
        return resp.json()

    pool = ThreadPoolExecutor(max_workers=len(ENDPOINTS), thread_name_prefix="overpass")
    try:
        running: dict = {}
        todo = list(ENDPOINTS)
        while todo or running:
            if todo and (not running or len(running) < len(ENDPOINTS)):
                url = todo.pop(0)
                running[pool.submit(one, url)] = url
            done, _ = wait(running, timeout=HEDGE_S if todo else None, return_when=FIRST_COMPLETED)
            for fut in done:
                url = running.pop(fut)
                try:
                    return fut.result()
                except (httpx.HTTPError, ValueError) as exc:
                    errors.append(f"{url}: {type(exc).__name__}: {exc}")
            # nothing finished within HEDGE_S (or a mirror failed): the loop starts the next one
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        if own:
            client.close()
    raise OverpassError("; ".join(errors))


def classify(tags: dict[str, str]) -> tuple[Category, str] | None:
    for cat in CATEGORIES:
        for sel in cat.selectors:
            value = tags.get(sel.key)
            if value is not None and re.match(sel.pattern, value):
                return cat, f"{sel.key}={value}"
    return None


def _points(el: dict) -> list[tuple[float, float]]:
    if "lat" in el and "lon" in el:
        return [(el["lat"], el["lon"])]
    if el.get("geometry"):
        return [(p["lat"], p["lon"]) for p in el["geometry"] if p]
    if "center" in el:
        return [(el["center"]["lat"], el["center"]["lon"])]
    return []


MAX_VERTICES = 400


def _geometry(el: dict, category: str) -> dict | None:
    """GeoJSON geometry ([lon, lat]) for drawing; long ways are thinned to MAX_VERTICES."""
    if "lat" in el and "lon" in el:
        return {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
    pts = [[p["lon"], p["lat"]] for p in el.get("geometry") or [] if p]
    if len(pts) > MAX_VERTICES:
        step = len(pts) // MAX_VERTICES + 1
        pts = pts[::step] + [pts[-1]]
    if len(pts) >= 4 and pts[0] == pts[-1] and category in AREA_CATEGORIES:
        return {"type": "Polygon", "coordinates": [pts]}
    if len(pts) >= 2:
        return {"type": "LineString", "coordinates": pts}
    if "center" in el:
        return {"type": "Point", "coordinates": [el["center"]["lon"], el["center"]["lat"]]}
    return None


def parse(payload: dict, lat: float, lon: float) -> list[NoiseSource]:
    """Turn Overpass elements into sources: nearest point, distance, bearing.

    Deduplicates by OSM id, drops elements without coordinates or beyond their
    category radius, sorts nearest first.
    """
    found: dict[str, NoiseSource] = {}
    for el in payload.get("elements", []):
        match = classify(el.get("tags", {}))
        pts = _points(el)
        if match is None or not pts:
            continue
        cat, subtype = match
        plat, plon = geo.nearest_point(lat, lon, pts)
        dist = geo.haversine_m(lat, lon, plat, plon)
        if dist > cat.radius_m * 1.05:  # small slack for projection differences
            continue
        osm_id = f"{el['type']}/{el['id']}"
        brg = geo.bearing_deg(lat, lon, plat, plon)
        src = NoiseSource(
            id=osm_id,
            category=cat.name,
            subtype=subtype,
            name=el.get("tags", {}).get("name"),
            lat=round(plat, 7),
            lon=round(plon, 7),
            distance_m=round(dist, 1),
            bearing_deg=round(brg, 1),
            bearing_compass=geo.compass(brg),
            osm_url=f"https://www.openstreetmap.org/{osm_id}",
            osm_ids=[osm_id],
            geometry=_geometry(el, cat.name),
        )
        if osm_id not in found or src.distance_m < found[osm_id].distance_m:
            found[osm_id] = src
    return merge_named(sorted(found.values(), key=lambda s: s.distance_m))


def merge_named(sources: list[NoiseSource]) -> list[NoiseSource]:
    """Merge elements that share category, subtype and name (road segments) into one.

    Input must be sorted nearest first; the nearest element is kept as the source.
    Unnamed elements are never merged.
    """
    merged: dict[tuple, NoiseSource] = {}
    out: list[NoiseSource] = []
    for src in sources:
        if src.name is None:
            out.append(src)
            continue
        key = (src.category, src.subtype, src.name)
        if key in merged:
            kept = merged[key]
            kept.osm_ids.append(src.id)
            if src.geometry and src.geometry["type"] == "LineString" and kept.geometry:
                if kept.geometry["type"] == "LineString":
                    kept.geometry = {
                        "type": "MultiLineString",
                        "coordinates": [kept.geometry["coordinates"]],
                    }
                if kept.geometry["type"] == "MultiLineString":
                    kept.geometry["coordinates"].append(src.geometry["coordinates"])
        else:
            merged[key] = src
            out.append(src)
    return out
