import pytest

from noise import geo

# One degree of arc on a sphere of radius 6,371,008.8 m: 2*pi*R/360 = 111,195.08 m.
ONE_DEG_M = 111_195.08


@pytest.mark.parametrize("dest", [(0, 1), (1, 0), (0, -1), (-1, 0)])
def test_one_degree_from_origin(dest):
    assert geo.haversine_m(0, 0, *dest) == pytest.approx(ONE_DEG_M, abs=1)


def test_zero_distance():
    assert geo.haversine_m(34.1, -118.3, 34.1, -118.3) == 0


@pytest.mark.parametrize(
    ("dest", "expected"),
    [((1, 0), 0), ((0, 1), 90), ((-1, 0), 180), ((0, -1), 270)],
)
def test_cardinal_bearings(dest, expected):
    assert geo.bearing_deg(0, 0, *dest) == pytest.approx(expected, abs=1e-9)


@pytest.mark.parametrize(
    ("deg", "name"),
    [(0, "N"), (11.24, "N"), (11.26, "NNE"), (22.5, "NNE"), (45, "NE"), (90, "E"),
     (180, "S"), (270, "W"), (348.76, "N"), (359, "N"), (360, "N")],
)  # fmt: skip
def test_compass(deg, name):
    assert geo.compass(deg) == name


def test_nearest_point_on_segment_interior():
    # Horizontal segment at lat 0.001 from lon -1 to 1; nearest to origin is (0.001, 0).
    lat, lon = geo.nearest_point(0, 0, [(0.001, -1), (0.001, 1)])
    assert lat == pytest.approx(0.001)
    assert lon == pytest.approx(0, abs=1e-12)
    # 0.001 deg of latitude = 111.195 m
    assert geo.haversine_m(0, 0, lat, lon) == pytest.approx(111.195, abs=0.01)


def test_nearest_point_clamps_to_endpoint():
    assert geo.nearest_point(0, 0, [(0, 0.01), (0, 0.02)]) == pytest.approx((0, 0.01))


def test_nearest_point_single_vertex():
    assert geo.nearest_point(0, 0, [(0.5, 0.5)]) == (0.5, 0.5)
