"""Noise sources from local OpenStreetMap extracts: a property's surroundings in milliseconds.

Public Overpass takes 30-180 s per property and refuses heavy users. Instead, each region's
extract (.osm.pbf, in data/osm/) is read ONCE by `python -m noise.local build`: every element that
matches a noise category (noise.categories, same rules as the Overpass queries) inside the
region's box is stored in SQLite with an R*Tree index, in Overpass's own JSON shape. A property
lookup then reads the elements within each category's radius and goes through the same parser
(overpass.parse) as an Overpass answer, so reports are identical in shape and rules.

Regions cover every catalog property plus a 5 km margin (the largest category radius).
"""

import json
import logging
import math
import os
import sqlite3
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from noise import overpass
from noise.categories import CATEGORIES

log = logging.getLogger(__name__)

EARTH_M_PER_DEG = 111_320.0
# (south, west, north, east): catalog extent + ~5 km.
REGIONS: dict[str, dict] = {
    "los_angeles": {"pbf": "LosAngeles.osm.pbf", "bbox": (33.71, -118.66, 34.36, -118.07)},
    "houston": {"pbf": "texas-latest.osm.pbf", "bbox": (29.48, -95.77, 30.12, -95.02)},
}
KEYS = sorted({sel.key for c in CATEGORIES for sel in c.selectors})


def osm_dir() -> Path:
    root = os.environ.get("REVERB_DATA_DIR") or Path(__file__).resolve().parents[2] / "data"
    return Path(root) / "osm"


def db_path(region: str) -> Path:
    return osm_dir() / f"{region}_noise.sqlite"


def _inside(bbox, lat: float, lon: float) -> bool:
    s, w, n, e = bbox
    return s <= lat <= n and w <= lon <= e


def _keep_tags(tags: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in tags.items() if k in KEYS or k == "name"}


# ---- build ----


def _schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        DROP TABLE IF EXISTS src; DROP TABLE IF EXISTS idx; DROP TABLE IF EXISTS meta;
        CREATE TABLE src (id INTEGER PRIMARY KEY, osm_id TEXT, category TEXT, element TEXT);
        CREATE VIRTUAL TABLE idx USING rtree(id, minlat, maxlat, minlon, maxlon);
        CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
        """
    )


def build_region(region: str, pbf: Path | None = None, out: Path | None = None) -> dict:
    """Read the region's extract once and store its noise sources. Returns counts."""
    import osmium

    cfg = REGIONS[region]
    pbf = pbf or osm_dir() / cfg["pbf"]
    out = out or db_path(region)
    bbox = cfg["bbox"]
    tmp = out.with_suffix(".building")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    _schema(con)
    counts: dict[str, int] = {}
    t0 = time.time()

    def put(osm_id: str, category: str, el: dict, pts: list[tuple[float, float]]) -> None:
        if not any(_inside(bbox, la, lo) for la, lo in pts):
            return
        cur = con.execute(
            "INSERT INTO src (osm_id, category, element) VALUES (?, ?, ?)",
            (osm_id, category, json.dumps(el, separators=(",", ":"))),
        )
        lats, lons = [p[0] for p in pts], [p[1] for p in pts]
        con.execute(
            "INSERT INTO idx VALUES (?, ?, ?, ?, ?)",
            (cur.lastrowid, min(lats), max(lats), min(lons), max(lons)),
        )
        counts[category] = counts.get(category, 0) + 1

    fp = (
        osmium.FileProcessor(str(pbf))
        .with_locations()
        .with_areas(osmium.filter.KeyFilter(*KEYS))
        .with_filter(osmium.filter.KeyFilter(*KEYS))
    )
    for obj in fp:
        tags = {t.k: t.v for t in obj.tags}
        match = overpass.classify(tags)
        if match is None:
            continue
        cat = match[0].name
        if obj.is_node():
            if not obj.location.valid():
                continue
            la, lo = obj.location.lat, obj.location.lon
            el = {
                "type": "node",
                "id": obj.id,
                "lat": round(la, 7),
                "lon": round(lo, 7),
                "tags": _keep_tags(tags),
            }
            put(f"node/{obj.id}", cat, el, [(la, lo)])
        elif obj.is_way():
            pts = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
            if not pts:
                continue
            geom = [{"lat": round(la, 7), "lon": round(lo, 7)} for la, lo in pts]
            el = {"type": "way", "id": obj.id, "tags": _keep_tags(tags), "geometry": geom}
            put(f"way/{obj.id}", cat, el, pts)
        elif obj.is_area() and not obj.from_way():
            # multipolygon relation (e.g. an airport): Overpass returns these with a centre point
            pts = [(n.lat, n.lon) for ring in obj.outer_rings() for n in ring if n.location.valid()]
            if not pts:
                continue
            rid = obj.orig_id()
            centre = {
                "lat": round(sum(p[0] for p in pts) / len(pts), 7),
                "lon": round(sum(p[1] for p in pts) / len(pts), 7),
            }
            el = {"type": "relation", "id": rid, "tags": _keep_tags(tags), "center": centre}
            put(f"relation/{rid}", cat, el, pts)
    stamp = datetime.fromtimestamp(pbf.stat().st_mtime, UTC).strftime("%Y-%m-%d")
    con.executemany(
        "INSERT INTO meta VALUES (?, ?)",
        [
            ("source", pbf.name),
            ("data_date", stamp),
            ("built", datetime.now(UTC).isoformat(timespec="seconds")),
        ],
    )
    con.execute("CREATE INDEX src_cat ON src(category)")
    con.commit()
    con.close()
    tmp.replace(out)
    return {"region": region, "seconds": round(time.time() - t0, 1), "counts": counts}


# ---- query ----


def payload_near(lat: float, lon: float) -> tuple[dict, str] | None:
    """Overpass-shaped answer for a point, from the local index; None if no region covers it."""
    region = next(
        (r for r, c in REGIONS.items() if _inside(c["bbox"], lat, lon) and db_path(r).exists()),
        None,
    )
    if region is None:
        return None
    con = sqlite3.connect(f"file:{db_path(region)}?mode=ro", uri=True)
    try:
        meta = dict(con.execute("SELECT k, v FROM meta"))
        elements = []
        coslat = max(0.2, math.cos(math.radians(lat)))
        for cat in CATEGORIES:
            dlat = cat.radius_m * 1.05 / EARTH_M_PER_DEG
            dlon = dlat / coslat
            rows = con.execute(
                "SELECT s.element FROM idx i JOIN src s ON s.id = i.id "
                "WHERE i.maxlat >= ? AND i.minlat <= ? AND i.maxlon >= ? AND i.minlon <= ? AND s.category = ?",
                (lat - dlat, lat + dlat, lon - dlon, lon + dlon, cat.name),
            )
            elements.extend(json.loads(r[0]) for r in rows)
    finally:
        con.close()
    note = f"Sources from a local OpenStreetMap extract ({meta.get('source')}, data as of {meta.get('data_date')})."
    return {"elements": elements, "osm3s": {"timestamp_osm_base": meta.get("data_date")}}, note


if __name__ == "__main__":  # python -m noise.local build [region ...]
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2 or sys.argv[1] != "build":
        sys.exit("usage: python -m noise.local build [los_angeles houston]")
    for r in sys.argv[2:] or list(REGIONS):
        print(build_region(r), flush=True)
