import json
import os
import tempfile
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


class ExpiredAsset(MatterportError):
    """A signed asset URL is no longer valid (HTTP 403/410): re-query for a fresh one."""


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
    write_atomic(cache, json.dumps(model).encode())
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


# Imagery and mesh. Asset URLs are signed and expire, so this query is cached briefly; the
# downloaded files are cached for good.
ASSETS_QUERY = """
query Assets($id: ID!) { model(id: $id) {
  id
  matterpak: bundle(id: "mp:matterpak") { availability }
  assets { meshes(formats: ["obj"], resolutions: ["50k"]) { url filename status } }
  panoLocations { id position { x y z } rotation { x y z w }
                  anchor { id room { id } }
                  skybox(resolution: "2k") { status children } }
} }
"""
ASSET_TTL_S = 30 * 60


def fetch_assets(sid: str, fresh: bool = False) -> dict:
    """Panorama locations (with signed skybox face URLs) and the 50k OBJ mesh URL."""
    import time

    cache = CACHE_DIR / f"{sid}.assets.json"
    if not fresh and cache.exists() and time.time() - cache.stat().st_mtime < ASSET_TTL_S:
        return json.loads(cache.read_text())
    return _cached_query(sid, ASSETS_QUERY, f"{sid}.assets.json", use_cache=False)


def write_atomic(dest: Path, data: bytes) -> None:
    """Write a cache file so no reader ever sees it half-written (temp file, then rename):
    concurrent requests for one model share its cached meshes and answers."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=f".{dest.name}.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def download(url: str, dest: Path) -> Path:
    """Fetch a signed asset URL once; the file is kept in the cache."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    try:
        resp = httpx.get(url, timeout=120, follow_redirects=True)
    except httpx.HTTPError as e:
        raise MatterportError(f"asset download failed: {e}") from e
    if resp.status_code in (403, 410):
        raise ExpiredAsset(f"asset URL expired (HTTP {resp.status_code})")
    if resp.status_code != 200:
        raise MatterportError(f"asset download HTTP {resp.status_code}")
    write_atomic(dest, resp.content)
    return dest


def mesh_path(sid: str) -> Path | None:
    """Local copy of the model's 50k OBJ mesh (Matterport's defurnished shell), or None."""
    dest = CACHE_DIR / "mesh" / f"{sid}_50k.obj"
    if dest.exists():
        return dest
    for fresh in (False, True):
        meshes = ((fetch_assets(sid, fresh).get("assets") or {}).get("meshes")) or []
        ok = [m for m in meshes if m.get("status") == "available" and m.get("url")]
        if not ok:
            return None
        try:
            return download(ok[0]["url"], dest)
        except ExpiredAsset:
            if fresh:
                raise
    return None


def skybox_faces(sid: str, pano_id: str, faces=(1, 2, 3, 4, 5)) -> dict[int, Path]:
    """Local copies of one panorama's 2k skybox faces (0 = up, 1-4 = sides, 5 = down)."""

    def dest(f: int) -> Path:
        return CACHE_DIR / "pano" / f"{sid}_{pano_id}_{f}.jpg"

    for fresh in (False, True):
        missing = [f for f in faces if not dest(f).exists()]
        if not missing:
            break
        loc = next(
            (p for p in fetch_assets(sid, fresh).get("panoLocations") or [] if p["id"] == pano_id),
            None,
        )
        children = ((loc or {}).get("skybox") or {}).get("children") or []
        if len(children) != 6:
            raise MatterportError(f"panorama {pano_id} has no skybox faces")
        try:
            for f in missing:
                download(children[f], dest(f))
            break
        except ExpiredAsset:
            if fresh:
                raise
    return {f: dest(f) for f in faces}


class _RangeFile:
    """A read-only, seekable view of a remote file using HTTP range requests, so zipfile can
    read the MatterPak's directory and one member without downloading the whole archive."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        self.client = httpx.Client(follow_redirects=True, timeout=120)
        r = self.client.get(url, headers={"Range": "bytes=0-0"})
        if r.status_code in (403, 410):
            raise ExpiredAsset(f"asset URL expired (HTTP {r.status_code})")
        if r.status_code != 206:
            raise MatterportError(
                f"MatterPak does not support range requests (HTTP {r.status_code})"
            )
        self.size = int(r.headers["content-range"].split("/")[1])

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        data = self.client.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}).content
        self.pos += len(data)
        return data


def furnished_mesh_path(sid: str) -> Path | None:
    """The MatterPak's full (furnished) OBJ, fetched alone from the remote zip and cached.
    None when the model has no unlocked MatterPak."""
    import zipfile

    dest = CACHE_DIR / "mesh" / f"{sid}_furnished.obj"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    q = 'query($id: ID!) { model(id: $id) { mp: bundle(id: "mp:matterpak") { availability assets { url } } } }'
    for attempt in range(2):
        mp = ((graphql(q, {"id": sid}).get("data") or {}).get("model") or {}).get("mp") or {}
        if mp.get("availability") != "unlocked" or not mp.get("assets"):
            return None
        try:
            z = zipfile.ZipFile(_RangeFile(mp["assets"][0]["url"]))  # type: ignore[arg-type]
        except ExpiredAsset:
            if attempt:
                raise
            continue
        objs = [i for i in z.infolist() if i.filename.endswith(".obj")]
        if not objs:
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(dest, z.read(max(objs, key=lambda i: i.file_size)))
        return dest
    return None
