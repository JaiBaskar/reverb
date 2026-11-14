"""GET /properties/{sid}/noise."""

from fastapi import APIRouter, HTTPException, Query

from noise.models import NoiseReport, Provenance
from noise.service import get_noise_report

router = APIRouter(tags=["noise"])

# Stopgap until A1's properties module lands; then look coordinates up there.
# Coordinates from the Matterport Model API geolocation (verified).
FALLBACK_LOCATIONS: dict[str, tuple[float, float, Provenance]] = {
    "zvKHR9DHNjJ": (34.0934917, -118.3171000, "verified"),  # 5836 La Mirada Ave, LA
}


def resolve_location(sid: str) -> tuple[float, float, Provenance] | None:
    return FALLBACK_LOCATIONS.get(sid)


@router.get("/properties/{sid}/noise", response_model=NoiseReport)
def property_noise(
    sid: str,
    lat: float | None = Query(None, ge=-90, le=90, description="Matterport latitude"),
    lon: float | None = Query(
        None, ge=-180, le=180, description="Matterport longitude"
    ),
    refresh: bool = False,
) -> NoiseReport:
    if lat is not None and lon is not None:
        loc: tuple[float, float, Provenance] | None = (lat, lon, "verified")
    else:
        loc = resolve_location(sid)
    if loc is None:
        raise HTTPException(404, f"No coordinates known for property {sid}")
    return get_noise_report(loc[0], loc[1], sid, loc[2], refresh=refresh)
