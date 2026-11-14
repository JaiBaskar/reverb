import json
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "overpass_sample.json"
SAMPLE_LAT, SAMPLE_LON = 34.0934917, -118.3171000  # Matterport geolocation


@pytest.fixture
def overpass_sample() -> dict:
    return json.loads(FIXTURE.read_text())
