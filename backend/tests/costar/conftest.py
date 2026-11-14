"""Hand-written records shaped like the CoStar kit. No real CoStar data is committed."""

import json

import pytest

ENUMS = {
    "BuildingConstructionMaterialType": {"0": "Unknown", "1": "Masonry", "5": "WoodFrame"},
    "PropertyType": {"11": "Multifamily", "16": "Homes"},
    "BuildingClass": {"0": "Unknown", "1": "A", "2": "B"},
    "ConstructionEventType": {"1": "GroundBreaking", "2": "ConstructionComplete"},
}


@pytest.fixture
def enums() -> dict:
    return ENUMS


@pytest.fixture
def listing() -> dict:
    return {
        "id": 111,
        "property": {"yearBuilt": 1920, "stories": 1, "sqftMax": 1628, "propertyType": 1},
        "resoValues": {
            "hasHardwoodFloors": True,
            "structure": {
                "yearBuilt": 1920,
                "stories": 1,
                "architecturalStyle": "California Bungalow",
            },
        },
    }


@pytest.fixture
def features() -> dict:
    return {
        "id": 111,
        "features": [
            {"name": "Wood Flooring", "subcategory1": "Flooring", "source": "Mls"},
            {"name": "Carpet", "subcategory1": "Flooring", "source": "MachineLearning"},
            {"name": "No Common Walls", "subcategory1": "Lot Details", "source": "Mls"},
            {"name": "Asphalt Roof", "subcategory1": "Home Design", "source": "Mls"},
        ],
    }


@pytest.fixture
def commercial() -> dict:
    return {
        "id": 222,
        "propertyType": 11,
        "buildingClass": 1,
        "buildingName": "Test Lofts",
        "grossBuildingAreaSquareFeet": 21000.0,
        "numStoriesAboveGrade": 5,
        "buildingConstructionMaterial": 0,
        "constructionEvents": [
            {"eventType": 1, "year": 2022, "month": 10},
            {"eventType": 2, "year": 2024, "month": 5},
        ],
        "structural": None,
        "propertyResidence": None,
        "propertyApartment": {"totalNumUnits": 39},
    }


@pytest.fixture
def kit(tmp_path, listing, features, commercial):
    """A miniature kit directory with the same layout as data/costar-kit/kit."""
    (tmp_path / "data").mkdir()
    (tmp_path / "schemas").mkdir()
    (tmp_path / "residential-listings.csv").write_text(
        "ListingId,ResidentialListingId,MatterportModelId,Address,City,State\n"
        "111,999,resSID,1 Test Ave,Los Angeles,CA\n"
    )
    (tmp_path / "commercial-properties.csv").write_text(
        "PropertyId,MatterportModelId,Address,City,State\n"
        "222,comSID,2 Test St,Los Angeles,CA\n"
        "333,,3 No Model St,Los Angeles,CA\n"
    )

    def jsonl(name, *recs):
        (tmp_path / "data" / name).write_text("".join(json.dumps(r) + "\n" for r in recs))

    jsonl("residential-listings.jsonl", {"id": 5, "property": {}}, listing)
    jsonl("residential-listing-features.jsonl", features)
    jsonl("commercial-property.jsonl", commercial)
    (tmp_path / "schemas" / "enums.json").write_text(json.dumps(ENUMS))
    return tmp_path
