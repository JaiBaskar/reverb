"""Optional photorealistic pass over the treated-room render (image-generation model).

The deterministic render (the plan drawn in the Matterport scan at its calculated positions)
is the source of truth. This pass only restyles it: the model receives the original view, the
render and the plan as written instructions, and is told to keep every item exactly where it is
in the render and to change nothing else. The result is labelled an AI visualization, shown
next to the render, never instead of it.

Needs OPENROUTER_API_KEY; the model is REVERB_IMAGE_MODEL (an OpenRouter model id that can
output images). Without a key the endpoint reports itself unavailable.
"""

import base64
import os

import httpx
from pydantic import BaseModel

from treatment.service import TreatmentPlan

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-2.5-flash-image"
MAX_IMAGE_BYTES = 8_000_000


class PhotorealStatus(BaseModel):
    available: bool
    model: str | None
    reason: str | None


class PhotorealResult(BaseModel):
    image: str  # data URI
    model: str
    label: str
    prompt: str


_KEY_CHECK: dict[str, tuple[float, str | None]] = {}
KEY_CHECK_TTL_S = 300


def _spend_problem(key: str) -> str | None:
    """Why this key cannot pay for an image model (OpenRouter GET /key), or None if it can.
    Image-output models are paid; a key at its spending limit is refused (HTTP 403)."""
    import time

    hit = _KEY_CHECK.get(key)
    if hit and time.time() - hit[0] < KEY_CHECK_TTL_S:
        return hit[1]
    try:
        r = httpx.get(
            "https://openrouter.ai/api/v1/key",
            headers={"Authorization": f"Bearer {key}"},
            timeout=10,
        )
        d = (r.json() or {}).get("data") or {}
        if r.status_code != 200:
            why = f"OpenRouter did not accept the key (HTTP {r.status_code})."
        elif d.get("limit") is not None and (d.get("limit_remaining") or 0) <= 0:
            why = (
                f"The OpenRouter key's spending limit is ${d.get('limit'):g} and it has "
                f"${max(0.0, d.get('limit_remaining') or 0):.2f} left; image models are paid. "
                "Raise the limit and add credit to enable it."
            )
        else:
            why = None
    except (httpx.HTTPError, ValueError):
        why = "Could not reach OpenRouter to check the key."
    _KEY_CHECK[key] = (time.time(), why)
    return why


def status() -> PhotorealStatus:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key and (why := _spend_problem(key)):
        return PhotorealStatus(available=False, model=None, reason=why)
    if not key:
        return PhotorealStatus(
            available=False, model=None,
            reason="No OPENROUTER_API_KEY in .env: the treated room is shown as a 3D render only.",
        )  # fmt: skip
    return PhotorealStatus(
        available=True, model=os.environ.get("REVERB_IMAGE_MODEL", DEFAULT_MODEL), reason=None
    )


def instructions(plan: TreatmentPlan) -> str:
    lines = [f"- {g.count} x {g.product}: {g.why.lower()}." for g in plan.groups]
    visible = set(plan.viewpoint.items_in_view) if plan.viewpoint else set()
    where = [f"  - {i.where}" for i in plan.items if i.key in visible]
    return (
        "Image 1 is a photo of a real room. Image 2 is the same view with acoustic treatment drawn "
        "as plain grey and wooden blocks at exact, calculated positions.\n"
        "Make image 2 look like a photograph of the room with that treatment professionally "
        "installed: fabric-wrapped panels, corner bass traps, a suspended ceiling cloud and wooden "
        "diffusers where the blocks are.\n"
        "Strict rules: keep every treatment item at exactly the position, size and angle of its "
        "block in image 2; do not add, remove, move or resize any item; keep the room's walls, "
        "windows, doors, furniture, lighting, colours and camera perspective identical to image 1; "
        "no people, no text.\n"
        "The plan:\n"
        + "\n".join(lines)
        + ("\nItems in this view:\n" + "\n".join(where) if where else "")
    )


def _data_uri_ok(uri: str) -> bool:
    if not uri.startswith("data:image/"):
        return False
    try:
        return len(base64.b64decode(uri.split(",", 1)[1], validate=False)) <= MAX_IMAGE_BYTES
    except (ValueError, IndexError):
        return False


def generate(plan: TreatmentPlan, before: str, render: str) -> PhotorealResult:
    st = status()
    if not st.available:
        raise RuntimeError(st.reason)
    if not (_data_uri_ok(before) and _data_uri_ok(render)):
        raise ValueError("before and render must be image data URIs under 8 MB")
    prompt = instructions(plan)
    resp = httpx.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={
            "model": st.model,
            "modalities": ["image", "text"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": before}},
                        {"type": "image_url", "image_url": {"url": render}},
                    ],
                }
            ],
        },
        timeout=180,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"image model HTTP {resp.status_code}: {resp.text[:300]}")
    msg = ((resp.json().get("choices") or [{}])[0]).get("message") or {}
    images = msg.get("images") or []
    url = ((images[0] if images else {}).get("image_url") or {}).get("url")
    if not url or not url.startswith("data:image/"):
        raise RuntimeError("the image model returned no image")
    return PhotorealResult(
        image=url,
        model=st.model,
        label="AI visualization made from the 3D render; positions follow the render, details are generated.",
        prompt=prompt,
    )
