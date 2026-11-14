import pytest

from costar.facts import commercial_facts, residential_facts


def fact(pf, key):
    return next(f for f in pf.facts if f.key == key)


FIXED = {"construction", "year_built", "floors", "hardwood_floors", "ceiling_height_m"}


def test_residential(listing, features):
    pf = residential_facts(listing, features)
    assert pf.kind == "residential"
    assert FIXED <= {f.key for f in pf.facts}
    assert fact(pf, "year_built").value == 1920
    assert fact(pf, "year_built").provenance == "verified"
    assert fact(pf, "floors").value == 1
    assert fact(pf, "hardwood_floors").value is True
    assert fact(pf, "architectural_style").value == "California Bungalow"
    assert fact(pf, "construction").provenance == "missing"
    ceil = fact(pf, "ceiling_height_m")
    assert ceil.value is None and ceil.provenance == "missing"
    assert fact(pf, "building_area_m2").value == pytest.approx(151.2, abs=0.1)  # 1628 sqft
    assert fact(pf, "no_common_walls").value is True


def test_residential_flooring_ignores_machine_learning_features(listing, features):
    pf = residential_facts(listing, features)
    assert fact(pf, "flooring").value == "Wood Flooring"  # 'Carpet' came from MachineLearning
    assert [(h.surface, h.material_id) for h in pf.material_hints] == [("floor", "hardwood")]


def test_residential_without_features_record(listing):
    pf = residential_facts(listing, None)
    assert fact(pf, "hardwood_floors").value is True
    assert all(f.key != "flooring" for f in pf.facts)


def test_residential_hardwood_absent_is_missing_not_false(listing):
    listing["resoValues"].pop("hasHardwoodFloors")
    f = fact(residential_facts(listing, None), "hardwood_floors")
    assert f.value is None and f.provenance == "missing"


def test_commercial(commercial, enums):
    pf = commercial_facts(commercial, enums)
    assert pf.kind == "commercial"
    assert FIXED <= {f.key for f in pf.facts}
    assert fact(pf, "year_built").value == 2024  # ConstructionComplete beats GroundBreaking
    assert fact(pf, "floors").value == 5
    assert fact(pf, "construction").provenance == "missing"  # enum 0 = Unknown
    assert fact(pf, "hardwood_floors").provenance == "missing"
    assert fact(pf, "property_type").value == "Multifamily"
    assert fact(pf, "building_class").value == "A"
    assert fact(pf, "units").value == 39
    assert pf.material_hints == []


def test_commercial_groundbreaking_only(commercial, enums):
    commercial["constructionEvents"] = [{"eventType": 1, "year": 2022}]
    f = fact(commercial_facts(commercial, enums), "year_built")
    assert f.value == 2022 and "ground" in (f.note or "").lower()


def test_commercial_material_and_ceiling(commercial, enums):
    commercial["buildingConstructionMaterial"] = 5
    commercial["structural"] = {"ceilingHeightFeet": 10, "ceilingHeightInches": 6}
    pf = commercial_facts(commercial, enums)
    assert fact(pf, "construction").value == "WoodFrame"
    assert fact(pf, "construction").provenance == "verified"
    ceil = fact(pf, "ceiling_height_m")
    assert ceil.value == pytest.approx(3.20, abs=0.005)  # 126 in * 0.0254
    assert ceil.provenance == "verified"


def test_residence_ceiling_height(commercial, enums):
    commercial["propertyResidence"] = {"ceilingHeightMainInFeet": 9}
    assert fact(commercial_facts(commercial, enums), "ceiling_height_m").value == pytest.approx(
        2.743,
        abs=0.005,  # 9 ft, rounded to cm
    )
