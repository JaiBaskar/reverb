import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "backend" / ".cache" / "matterport"
ENDPOINT = "https://api.matterport.com/api/models/graph"

load_dotenv(ROOT / ".env")

MODEL_QUERY = """
query Model($id: ID!) { model(id: $id) {
  id name
  address { address locality administrativeArea postalCode }
  geolocation { lat long }
  rooms { id classifications { label confidence }
          dimensions(units: metric) { areaFloor width depth height } }
} }
"""


# Tour geometry for the 3D view: room wall polygons (model space, metres, z up) and the tour
# sweeps ("locations") with the room each belongs to. Kept separate from MODEL_QUERY so the
# room/acoustics cache and fixtures are unchanged.
TOUR_QUERY = """
query Tour($id: ID!) { model(id: $id) {
  id
  floors { id label sequence }
  rooms { id
          boundary { edges { id type vertices { id position { x y } } } } }
  locations { id position { x y z } floor { id sequence } room { id } }
} }
"""


class MatterportError(RuntimeError):
    pass


def fetch_model(sid: str, *, use_cache: bool = True) -> dict:
    """Return the raw Matterport model, cached on disk per model ID."""
    return _cached_query(sid, MODEL_QUERY, f"{sid}.json", use_cache)


def fetch_tour_geometry(sid: str, *, use_cache: bool = True) -> dict:
    """Return room boundaries and tour sweep locations, cached on disk per model ID."""
    return _cached_query(sid, TOUR_QUERY, f"{sid}.tour.json", use_cache)


def _cached_query(sid: str, query: str, cache_name: str, use_cache: bool) -> dict:
    cache = CACHE_DIR / cache_name
    if use_cache and cache.exists():
        return json.loads(cache.read_text())

    body = graphql(query, {"id": sid})
    model = (body.get("data") or {}).get("model")
    if not model:
        raise MatterportError(f"model {sid} not found or not shared: {body.get('errors')}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(model))
    return model


def graphql(query: str, variables: dict) -> dict:
    """POST one query to the Matterport Model API with basic auth."""
    key, token = os.environ.get("MATTERPORT_API_KEY"), os.environ.get("MATTERPORT_API_TOKEN")
    if not key or not token:
        raise MatterportError("MATTERPORT_API_KEY / MATTERPORT_API_TOKEN not set in .env")
    try:
        resp = httpx.post(
            ENDPOINT, auth=(key, token), json={"query": query, "variables": variables}, timeout=60
        )
    except httpx.HTTPError as e:
        raise MatterportError(f"Matterport unreachable: {e}") from e
    if resp.status_code != 200:
        raise MatterportError(f"Matterport HTTP {resp.status_code}")
    return resp.json()
