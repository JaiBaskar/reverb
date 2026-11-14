import pytest

from acoustics.furniture import (
    FURNITURE,
    FurnitureItem,
    UnknownFurniture,
    default_furnishing,
    furniture_absorption,
)
from acoustics.report import analyze_room
from properties.models import Field, Room


def room(label="Living Room", w=5.0, d=4.0, h=3.0, area=None):
    f = lambda v: Field(value=v, provenance="verified")
    return Room(id="r1", label=label, label_confidence=None, area_m2=f(area or w * d),
                width_m=f(w), depth_m=f(d), height_m=f(h), usable=True, issues=[])  # fmt: skip


def test_every_furniture_item_has_six_band_absorption():
    for item in FURNITURE.values():
        assert len(item["sabins"]) == 6 and all(s >= 0 for s in item["sabins"])


def test_default_furnishing_follows_the_room_type():
    living = {i.id for i in default_furnishing("Living Room")}
    assert {"sofa", "rug"} <= living
    assert {i.id for i in default_furnishing("Bedroom")} >= {"bed"}
    assert default_furnishing("Hallway") == []
    assert all(i.provenance == "assumed" for i in default_furnishing("Living Room"))


def test_furniture_absorption_sums_items_times_count():
    items = [FurnitureItem(id="sofa", count=2), FurnitureItem(id="rug", count=1)]
    got = furniture_absorption(items)
    want = [2 * s + r for s, r in zip(FURNITURE["sofa"]["sabins"], FURNITURE["rug"]["sabins"])]
    assert got == pytest.approx(want)


def test_unknown_furniture_is_rejected():
    with pytest.raises(UnknownFurniture):
        furniture_absorption([FurnitureItem(id="piano_of_doom", count=1)])


def test_furniture_adds_absorption_and_shortens_rt60():
    empty = analyze_room("s", room())
    furnished = analyze_room("s", room(), furniture=default_furnishing("Living Room"))
    extra = furniture_absorption(default_furnishing("Living Room"))
    for e, f, x in zip(empty.absorption_sabins, furnished.absorption_sabins, extra):
        assert f == pytest.approx(e + x)
    assert all(f < e for f, e in zip(furnished.rt60_s, empty.rt60_s))
    assert [i.id for i in furnished.furniture] == [i.id for i in default_furnishing("Living Room")]
    assert not any("empty" in a for a in furnished.assumptions)
    assert any("empty" in a for a in empty.assumptions)


def test_l_shaped_outline_adds_wall_area_and_is_noted():
    # L-shape of 20 m2: a 5x4 box has 54 m2 of wall at 3 m; this outline has a longer perimeter.
    outline = [(0, 0), (6, 0), (6, 2), (2, 2), (2, 4), (0, 4)]  # area 12 + 4 = 16 -> scaled
    box = analyze_room("s", room(area=20.0))
    shaped = analyze_room("s", room(area=20.0), outline=outline)
    assert shaped.surfaces.walls_m2 > box.surfaces.walls_m2
    assert shaped.rt60_s[2] < box.rt60_s[2]
    assert shaped.geometry.wall_source == "outline"
    assert box.geometry.wall_source == "box"
    assert "outline" in (shaped.geometry.note or "")
