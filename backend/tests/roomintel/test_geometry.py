import numpy as np
import pytest
import trimesh

from properties.models import Field, Room
from roomintel.geometry import room_geometry


def _room(w=4.0, d=3.0, h=2.5, h_prov="verified"):
    f = lambda v, p="verified": Field(value=v, provenance=p)
    return Room(id="r", label="Studio", label_confidence=None, area_m2=f(w * d), width_m=f(w),
                depth_m=f(d), height_m=f(h, h_prov), usable=True, issues=[])  # fmt: skip


def _shell(w=4.0, d=3.0, h=2.5, door=(1.0, 1.9)):
    """Floor, ceiling and four 5 cm walls; the y=0 wall has a doorway from door[0] to door[1]."""
    t = 0.05
    parts = [
        trimesh.creation.box(
            [w, d, t], trimesh.transformations.translation_matrix([w / 2, d / 2, -t / 2])
        ),
        trimesh.creation.box(
            [w, d, t], trimesh.transformations.translation_matrix([w / 2, d / 2, h + t / 2])
        ),
        trimesh.creation.box(
            [t, d, h], trimesh.transformations.translation_matrix([-t / 2, d / 2, h / 2])
        ),
        trimesh.creation.box(
            [t, d, h], trimesh.transformations.translation_matrix([w + t / 2, d / 2, h / 2])
        ),
        trimesh.creation.box(
            [w, t, h], trimesh.transformations.translation_matrix([w / 2, d + t / 2, h / 2])
        ),
    ]
    for x0, x1 in ((0, door[0]), (door[1], w)):
        parts.append(trimesh.creation.box([x1 - x0, t, h], trimesh.transformations.translation_matrix([(x0 + x1) / 2, -t / 2, h / 2])))  # fmt: skip
    return trimesh.util.concatenate(parts)


POLY = [[0, 0], [4, 0], [4, 3], [0, 3]]


def test_rectangle_walls_corners_and_normals():
    g = room_geometry(_room(), POLY, mesh=None)
    assert g.source == "outline" and g.area_m2 == pytest.approx(12)
    assert [round(w.length_m, 3) for w in g.walls] == [4, 3, 4, 3]
    assert all(c.convex and c.interior_angle_deg == pytest.approx(90) for c in g.corners)
    # inward normals point to the centre
    for w in g.walls:
        mid = np.add(w.start, w.end) / 2
        assert np.linalg.norm(mid + np.array(w.inward) - (2, 1.5)) < np.linalg.norm(mid - (2, 1.5))


def test_clockwise_outline_is_normalised():
    g = room_geometry(_room(), POLY[::-1], mesh=None)
    assert all(c.convex for c in g.corners)


def test_l_shape_has_one_reflex_corner():
    poly = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]
    g = room_geometry(_room(), poly, mesh=None)
    assert sum(not c.convex for c in g.corners) == 1
    assert g.area_m2 == pytest.approx(12)


def test_mesh_verifies_height_and_finds_the_doorway():
    g = room_geometry(_room(h=2.5), POLY, mesh=_shell())
    assert g.source == "mesh+outline"
    assert g.height.provenance == "verified" and g.floor_z == pytest.approx(0, abs=0.03)
    door_wall = g.walls[0]  # (0,0) -> (4,0)
    assert len(door_wall.openings) == 1
    a, b = door_wall.openings[0]
    assert a == pytest.approx(1.0, abs=0.26) and b == pytest.approx(1.9, abs=0.26)
    assert all(not w.openings and w.coverage > 0.9 for w in g.walls[1:])


def test_mesh_height_wins_when_matterport_disagrees():
    g = room_geometry(_room(h=3.2), POLY, mesh=_shell(h=2.5))
    assert g.height.value == pytest.approx(2.5, abs=0.05) and g.height.provenance == "estimated"
    assert any("mesh puts it" in n for n in g.notes)


def test_no_outline_falls_back_to_estimated_rectangle():
    g = room_geometry(_room(w=5, d=4), None, mesh=None)
    assert g.source == "box" and g.polygon_provenance == "estimated"
    assert any("no wall outline" in n for n in g.notes)


def test_no_geometry_at_all_raises_instead_of_guessing():
    r = _room()
    r.width_m = Field(value=None, provenance="missing")
    with pytest.raises(ValueError):
        room_geometry(r, None, mesh=None)
