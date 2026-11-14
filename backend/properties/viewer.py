"""Can this scan be shown as an interactive 3D model (Matterport Showcase)?"""

import json
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlencode

from pydantic import BaseModel

from properties.matterport import CACHE_DIR, MatterportError, graphql

STATUS_QUERY = (
    "query($id: ID!) { model(id: $id) { id visibility state publication { published url } } }"
)
SHOWCASE = "https://my.matterport.com/show/"
VIEWABLE = {"public", "unlisted"}


class Viewer(BaseModel):
    sid: str
    available: bool
    embed_url: str | None
    visibility: str | None = None
    state: str | None = None
    published: bool | None = None
    reason: str | None = None


def viewer_from_model(sid: str, model: dict) -> Viewer:
    """Plain Showcase embed. Adding applicationKey=MATTERPORT_SDK_KEY made Showcase hang on
    "Connecting" from localhost (key likely domain-restricted), so the SDK is not wired yet."""
    vis, state = model.get("visibility"), model.get("state")
    published = (model.get("publication") or {}).get("published")
    reason = None
    if state != "active":
        reason = f"The scan is {state or 'in an unknown state'} in Matterport."
    elif not published:
        reason = "The scan is not published in Matterport."
    elif vis not in VIEWABLE:
        reason = (
            f"The scan is {vis or 'not shared'}; only public or unlisted scans can be embedded."
        )
    params = {"m": sid, "play": 1, "qs": 1, "brand": 0}
    return Viewer(
        sid=sid,
        available=reason is None,
        embed_url=None if reason else f"{SHOWCASE}?{urlencode(params)}",
        visibility=vis,
        state=state,
        published=published,
        reason=reason,
    )


def _fetch_status(sid: str) -> dict:
    model = (graphql(STATUS_QUERY, {"id": sid}).get("data") or {}).get("model")
    if not model:
        raise MatterportError(f"Matterport does not share scan {sid} with this API key.")
    return model


def get_viewer(
    sid: str,
    *,
    cache_dir: Path | None = None,
    fetcher: Callable[[str], dict] | None = None,
) -> Viewer:
    """Status is cached per scan (it rarely changes)."""
    path = (cache_dir or CACHE_DIR / "viewer") / f"{sid}.json"
    if path.exists():
        model = json.loads(path.read_text())
    else:
        model = (fetcher or _fetch_status)(sid)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(model))
    return viewer_from_model(sid, model)
