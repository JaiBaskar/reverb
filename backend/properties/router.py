"""GET /properties/{sid}/viewer: the Matterport 3D model for a property, if it can be shown."""

from fastapi import APIRouter, HTTPException

from properties.matterport import MatterportError
from properties.service import is_known
from properties.viewer import Viewer, get_viewer

router = APIRouter(tags=["viewer"])


@router.get("/properties/{sid}/viewer", response_model=Viewer)
def property_viewer(sid: str) -> Viewer:
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")
    try:
        return get_viewer(sid)
    except MatterportError as e:
        return Viewer(sid=sid, available=False, embed_url=None, reason=str(e))
