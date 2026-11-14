from pathlib import Path

import pytest

from costar import kit as kitmod
from costar.service import get_facts

REAL_KIT = Path(__file__).parents[3] / "data" / "costar-kit" / "kit"


def test_lookup(kit):
    assert kitmod.lookup("resSID", kit) == ("residential", 111)
    assert kitmod.lookup("comSID", kit) == ("commercial", 222)
    assert kitmod.lookup("nope", kit) is None


def test_load_streams_by_id(kit):
    assert kitmod.load("residential-listings", 111, kit)["id"] == 111
    assert kitmod.load("residential-listings", 404, kit) is None


def test_get_facts_residential_and_cache(kit, tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    pf = get_facts("resSID", kit_dir=kit, cache_dir=cache)
    assert pf.status == "ok" and pf.costar_id == 111
    calls = []
    monkeypatch.setattr(kitmod, "load", lambda *a, **k: calls.append(a))
    again = get_facts("resSID", kit_dir=kit, cache_dir=cache)
    assert again == pf and calls == []


def test_get_facts_commercial(kit, tmp_path):
    pf = get_facts("comSID", kit_dir=kit, cache_dir=tmp_path)
    assert pf.kind == "commercial" and pf.status == "ok"


def test_unavailable_without_kit(tmp_path):
    pf = get_facts("resSID", kit_dir=tmp_path / "absent", cache_dir=tmp_path / "c")
    assert pf.status == "unavailable" and pf.facts == [] and "kit" in pf.notes[0].lower()
    assert not (tmp_path / "c").exists()  # not cached


def test_unavailable_when_not_in_kit(kit, tmp_path):
    pf = get_facts("nope", kit_dir=kit, cache_dir=tmp_path)
    assert pf.status == "unavailable" and "not in the CoStar kit" in pf.notes[0]


@pytest.mark.skipif(not REAL_KIT.exists(), reason="CoStar kit not downloaded")
def test_real_kit_shortlist(tmp_path):
    res = get_facts("zvKHR9DHNjJ", kit_dir=REAL_KIT, cache_dir=tmp_path)
    by = {f.key: f for f in res.facts}
    assert by["year_built"].value == 1920 and by["hardwood_floors"].value is True
    com = get_facts("qRFURoCtFoy", kit_dir=REAL_KIT, cache_dir=tmp_path)
    by = {f.key: f for f in com.facts}
    assert by["floors"].value == 5 and by["year_built"].value == 2024
