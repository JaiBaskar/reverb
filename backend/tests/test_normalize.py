import pytest

from properties.normalize import DEFAULT_CEILING_M, normalize_rooms


def raw(label, area=None, width=None, depth=None, height=None, conf=1.0, dims=True):
    r = {"id": "r", "classifications": [{"label": label, "confidence": conf}] if label else []}
    if dims:
        d = {"areaFloor": area, "width": width, "depth": depth, "height": height}
        r["dimensions"] = {k: v for k, v in d.items() if v is not None}
    return r


def by(rooms, i=0):
    return rooms[i]


def test_complete_room_is_all_verified_and_usable():
    [room] = normalize_rooms([raw("Living Room", 28.8, 5.0, 5.7, 2.67)])
    assert room.usable
    for f in (room.area_m2, room.width_m, room.depth_m, room.height_m):
        assert f.provenance == "verified"
    assert room.height_m.value == pytest.approx(2.67)


def test_missing_height_uses_median_of_verified_heights_marked_estimated():
    rooms = normalize_rooms(
        [
            raw("Living Room", 28.8, 5.0, 5.7, 2.6),
            raw("Kitchen", 13.0, 4.0, 3.2, 2.8),
            raw("Bedroom", 14.0, 3.5, 4.0, None),
        ]
    )
    h = rooms[2].height_m
    assert h.provenance == "estimated"
    assert h.value == pytest.approx(2.7)
    assert rooms[2].usable


def test_missing_height_and_no_other_heights_uses_default_assumed():
    [room] = normalize_rooms([raw("Bedroom", 14.0, 3.5, 4.0, None)])
    assert room.height_m.provenance == "assumed"
    assert room.height_m.value == DEFAULT_CEILING_M


def test_missing_depth_derived_from_area_and_width():
    [room] = normalize_rooms([raw("Bathroom", 8.0, 2.0, None, 2.7)])
    assert room.depth_m.provenance == "estimated"
    assert room.depth_m.value == pytest.approx(4.0)


def test_missing_both_width_and_depth_assumes_square_footprint():
    [room] = normalize_rooms([raw("Hallway", 16.0, None, None, 2.7)])
    assert room.width_m.provenance == "assumed"
    assert room.width_m.value == pytest.approx(4.0)
    assert room.depth_m.value == pytest.approx(4.0)


def test_missing_area_is_unusable_with_reason():
    [room] = normalize_rooms([raw("Void", dims=False)])
    assert not room.usable
    assert room.area_m2.provenance == "missing"
    assert any("area" in i for i in room.issues)


def test_void_label_is_unusable_even_with_dimensions():
    [room] = normalize_rooms([raw("Void", 20.0, 4.0, 5.0, 2.7)])
    assert not room.usable


def test_tiny_room_is_unusable():
    [room] = normalize_rooms([raw("Closet", 1.1, None, None, 2.7)])
    assert not room.usable


def test_unlabelled_room_gets_unknown_label():
    [room] = normalize_rooms([raw(None, 12.0, 3.0, 4.0, 2.7)])
    assert room.label == "Unlabelled"
