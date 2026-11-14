"""GET /properties/{sid}/noise."""

from fastapi import APIRouter, HTTPException

from catalog.service import entry_for
from noise.models import NoiseReport
from noise.service import get_noise_report
from properties.matterport import MatterportError
from properties.service import get_property, is_known

router = APIRouter(tags=["noise"])

COSTAR_NOTE = (
    "Property location from the CoStar record, because the Matterport scan has no usable "
    "geolocation."
)


@router.get("/properties/{sid}/noise", response_model=NoiseReport)
def property_noise(sid: str, refresh: bool = False) -> NoiseReport:
    """Matterport geolocation first (verified); the CoStar record's coordinates otherwise."""
    if not is_known(sid):
        raise HTTPException(404, f"{sid} is not a known property")
    matterport_error = None
    try:
        prop = get_property(sid)
        if prop.lat is not None and prop.lon is not None:
            return get_noise_report(prop.lat, prop.lon, sid, "verified", refresh=refresh)
    except MatterportError as e:
        matterport_error = e
    entry = entry_for(sid)
    if entry is None or entry.lat is None or entry.lon is None:
        if matterport_error is not None:
            raise HTTPException(502, str(matterport_error)) from matterport_error
        raise HTTPException(422, f"{sid} has no geolocation in Matterport or CoStar")
    report = get_noise_report(entry.lat, entry.lon, sid, "estimated", refresh=refresh)
    if COSTAR_NOTE not in report.notes:
        report = report.model_copy(update={"notes": [COSTAR_NOTE, *report.notes]})
    return report
