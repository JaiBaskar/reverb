import pytest
from pydantic import ValidationError

from acoustics.report import analyze_room
from properties.custom import CustomRoom, custom_room_to_room


def test_custom_room_fields_are_user_provided():
    room = custom_room_to_room(CustomRoom(label="Garage", width_m=6.0, depth_m=5.0, height_m=2.8))
    assert room.usable and room.label == "Garage"
    for f in (room.width_m, room.depth_m, room.height_m, room.area_m2):
        assert f.provenance == "user"
    assert room.area_m2.value == pytest.approx(30.0)
    assert room.id.startswith("custom:")


def test_custom_room_analysis_uses_exact_box_and_notes_user_input():
    room = custom_room_to_room(CustomRoom(width_m=5.0, depth_m=4.0, height_m=3.0))
    rep = analyze_room("sid", room)
    assert rep.geometry.volume_m3 == pytest.approx(60.0)
    assert rep.geometry.equivalent_width_m == pytest.approx(5.0)
    assert rep.geometry.note is None  # a user box is not an approximation of a scan
    assert any("entered by the user" in a for a in rep.assumptions)


@pytest.mark.parametrize(
    "dims",
    [
        {"width_m": 0.2, "depth_m": 4, "height_m": 3},  # too small to model
        {"width_m": 5, "depth_m": 400, "height_m": 3},  # not a room
        {"width_m": 5, "depth_m": 4, "height_m": 1.0},  # below standing height
    ],
)
def test_implausible_dimensions_are_rejected(dims):
    with pytest.raises(ValidationError):
        CustomRoom(**dims)


def test_same_dimensions_give_the_same_id():
    a = custom_room_to_room(CustomRoom(width_m=5, depth_m=4, height_m=3))
    b = custom_room_to_room(CustomRoom(width_m=5, depth_m=4, height_m=3))
    assert a.id == b.id
