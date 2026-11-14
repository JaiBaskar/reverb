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


class MatterportError(RuntimeError):
    pass


def fetch_model(sid: str, *, use_cache: bool = True) -> dict:
    """Return the raw Matterport model, cached on disk per model ID."""
    cache = CACHE_DIR / f"{sid}.json"
    if use_cache and cache.exists():
        return json.loads(cache.read_text())

    body = graphql(MODEL_QUERY, {"id": sid})
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
