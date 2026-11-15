import math

import pytest

from roomintel.panorama import (
    ScanPosition,
    face_heading,
    floor_point,
    pixel_bearing,
    project,
    yaw_from_quaternion,
)

# The den of zvKHR9DHNjJ: pano sa0ccfc88azxsste162hiipwd and its room's floor corners.
Q = {"x": 0.0023836, "y": 0.0011664, "z": 0.2391808, "w": 0.9709714}
SCAN = ScanPosition(
    id="s", position=(0.479, 2.668, 1.52), yaw_deg=yaw_from_quaternion(Q), room_id="r"
)


def test_yaw_from_quaternion():
    assert SCAN.yaw_deg == pytest.approx(27.68, abs=0.05)


def test_faces_turn_clockwise():
    assert face_heading(30, 2) == 30 - 90 and face_heading(30, 4) == 30 - 270
    with pytest.raises(ValueError):
        face_heading(30, 5)


def test_known_corner_lands_where_it_shows_in_the_photo():
    # Ceiling corner (2.80, 4.91, 2.74) is visible on face 1 at about x 0.36, y 0.29.
    x, y = project(SCAN, 1, (2.80, 4.91, 2.74))
    assert x == pytest.approx(0.36, abs=0.02) and y == pytest.approx(0.29, abs=0.03)
    assert project(SCAN, 3, (2.80, 4.91, 2.74)) is None  # behind face 3


def test_project_and_floor_point_are_inverse():
    p = (1.9, 1.7, 0.02)
    x, y = project(SCAN, 1, p)
    back = floor_point(SCAN, 1, x, y, floor_z=0.02)
    assert back == pytest.approx(p[:2], abs=1e-6)
    assert floor_point(SCAN, 1, 0.5, 0.4, 0.0) is None  # above the horizon


def test_pixel_bearing_centre_and_edges():
    assert pixel_bearing(0, 1, 0.5) == pytest.approx(0)
    assert pixel_bearing(0, 1, 0.0) == pytest.approx(45)  # left edge is CCW
    assert pixel_bearing(0, 2, 0.5) == pytest.approx(-90)
    assert math.isclose(pixel_bearing(10, 1, 1.0), -35)
