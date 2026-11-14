"""GET /properties/{sid}/noise."""

from fastapi import APIRouter, HTTPException

from noise.models import NoiseReport
from noise.service import get_noise_report
from properties.matterport import MatterportError
from properties.service import get_property, is_known

router = APIRouter(tags=["noise"])


@router.get("/properties/{sid}/noise", response_model=NoiseReport)
def property_noise(sid: str, refresh: bool = False) -> NoiseReport:
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")
    try:
        prop = get_property(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
    if prop.lat is None or prop.lon is None:
        raise HTTPException(422, f"{sid} has no Matterport geolocation")
    # Matterport geolocation is the source of the coordinates, hence verified.
    return get_noise_report(prop.lat, prop.lon, sid, "verified", refresh=refresh)
