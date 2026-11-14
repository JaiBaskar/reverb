import json

import pytest

from catalog.build import build_index
from catalog.search import search


@pytest.fixture
def kit(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "schemas").mkdir()
    (tmp_path / "commercial-properties.csv").write_text(
        "PropertyId,MatterportModelId,Address,City,State\n"
        "10,mA1,1 Main St,Houston,TX\n"
        "10,mA2,1 Main St,Houston,TX\n"
        "11,,2 Side St,Houston,TX\n"  # no model: not in the catalog
    )
    (tmp_path / "residential-listings.csv").write_text(
        "ListingId,ResidentialListingId,MatterportModelId,Address,City,State\n"
        "20,200,mR1,5 Oak Ave,Los Angeles,CA\n"
        "21,200,mR1,5 Oak Ave,Los Angeles,CA\n"  # relisting of the same home and scan
        "22,201,mR2,9 Elm St,Los Angeles,CA\n"
    )
    commercial = {
        "id": 10,
        "propertyType": 5,
        "buildingName": "Main Tower",
        "numStoriesAboveGrade": 12,
        "primaryAddress": {
            "latitude": 29.75,
            "longitude": -95.36,
            "streetNumber": "1",
            "streetName": "Main",
            "streetType": "St",
            "city": "Houston",
            "state": "TX",
            "postcode": "77002",
        },
    }
    (tmp_path / "data" / "commercial-property.jsonl").write_text(json.dumps(commercial) + "\n")
    homes = [
        {
            "id": 20,
            "property": {
                "mlsPropertyType": "Single Family Residence",
                "address": {
                    "latitude": 34.09,
                    "longitude": -118.31,
                    "fullStreetAddress": "5 Oak Ave",
                    "city": "Los Angeles",
                    "state": "CA",
                    "zip": "90038",
                },
            },
        },
        {
            "id": 21,
            "property": {
                "mlsPropertyType": "Single Family Residence",
                "address": {
                    "latitude": 34.09,
                    "longitude": -118.31,
                    "fullStreetAddress": "5 Oak Ave",
                    "city": "Los Angeles",
                    "state": "CA",
                    "zip": "90038",
                },
            },
        },
        {
            "id": 22,
            "property": {
                "mlsPropertyType": "Condominium",
                "address": {
                    "latitude": None,
                    "longitude": None,
                    "fullStreetAddress": "9 Elm St",
                    "city": "Los Angeles",
                    "state": "CA",
                    "zip": "90004",
                },
            },
        },
    ]
    (tmp_path / "data" / "residential-listings.jsonl").write_text(
        "\n".join(json.dumps(h) for h in homes) + "\n"
    )
    (tmp_path / "schemas" / "enums.json").write_text(json.dumps({"PropertyType": {"5": "Office"}}))
    return tmp_path


def test_build_index_joins_csv_models_to_records(kit):
    idx = build_index(kit)
    by_key = {e.key: e for e in idx}
    office = by_key["commercial-10"]
    assert office.model_ids == ["mA1", "mA2"]
    assert office.sid == "mA1"
    assert (office.lat, office.lon) == (29.75, -95.36)
    assert office.address == "1 Main St"
    assert office.type_label == "Office"
    assert office.name == "Main Tower"
    assert office.coords_provenance == "verified"


def test_build_index_skips_properties_without_a_model_and_dedupes_relistings(kit):
    keys = {e.key for e in build_index(kit)}
    assert "commercial-11" not in keys
    homes = [e for e in build_index(kit) if e.kind == "residential"]
    assert sorted(e.address for e in homes) == ["5 Oak Ave", "9 Elm St"]


def test_missing_coordinates_are_marked_missing(kit):
    elm = next(e for e in build_index(kit) if e.address == "9 Elm St")
    assert elm.lat is None and elm.coords_provenance == "missing"


def test_search_matches_tokens_filters_and_ranks_demo_picks_first(kit):
    idx = build_index(kit)
    res = search(idx, q="oak los angeles", demo_sids=set())
    assert [e.address for e in res.results] == ["5 Oak Ave"]
    assert search(idx, city="Houston", demo_sids=set()).total == 1
    assert search(idx, kind="residential", demo_sids=set()).total == 2
    ranked = search(idx, demo_sids={"mR2"})
    assert ranked.results[0].sid == "mR2" and ranked.results[0].demo_pick


def test_search_limit_and_total(kit):
    res = search(build_index(kit), limit=1, demo_sids=set())
    assert res.total == 3 and len(res.results) == 1
