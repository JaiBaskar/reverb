"""Noise Scout endpoints: GET returns the cached run (or not_run); POST runs the agent."""

from fastapi import APIRouter, HTTPException

from noise_scout.models import NoiseScoutResult
from noise_scout.service import cached_result, run_scout
from properties.matterport import MatterportError
from properties.service import shortlist_ids

router = APIRouter(tags=["noise-scout"])


def _check(sid: str) -> None:
    if sid not in shortlist_ids():
        raise HTTPException(404, f"{sid} is not in shortlist.json")


@router.get("/properties/{sid}/noise-scout", response_model=NoiseScoutResult)
def get_scout(sid: str) -> NoiseScoutResult:
    _check(sid)
    return cached_result(sid)


@router.post("/properties/{sid}/noise-scout", response_model=NoiseScoutResult)
def post_scout(sid: str) -> NoiseScoutResult:
    _check(sid)
    try:
        return run_scout(sid)
    except MatterportError as e:
        raise HTTPException(502, str(e)) from e
