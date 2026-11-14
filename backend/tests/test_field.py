import math

import numpy as np
import pytest

from acoustics.field import (
    barron_c50,
    default_source,
    grid_inside,
    room_field,
)

SQUARE = [(0.0, 0.0), (5.0, 0.0), (5.0, 4.0), (0.0, 4.0)]
L_SHAPE = [(0, 0), (6, 0), (6, 2), (2, 2), (2, 4), (0, 4)]
RT = [0.9, 0.8, 0.7, 0.6, 0.55, 0.5]
ALPHA = {"floor": [0.15, 0.11, 0.10, 0.07, 0.06, 0.07], "walls": [0.29, 0.10, 0.05, 0.04, 0.07, 0.09],
         "ceiling": [0.29, 0.10, 0.05, 0.04, 0.07, 0.09]}  # fmt: skip


def field(poly=SQUARE, **kw):
    return room_field(poly, height=2.7, rt60=RT, alpha=ALPHA, step=0.25, **kw)


def test_grid_keeps_only_points_inside_the_outline():
    xs, ys, inside = grid_inside(L_SHAPE, 0.5)
    pts = [(x, y) for x, y, ok in zip(xs.ravel(), ys.ravel(), inside.ravel()) if ok]
    assert pts and all(not (x > 2.01 and y > 2.01) for x, y in pts)  # the notch is excluded


def test_barron_c50_falls_with_distance_and_rises_with_less_reverb():
    near, far = barron_c50(1.0, 0.6, 50.0), barron_c50(4.0, 0.6, 50.0)
    assert near > far
    assert barron_c50(3.0, 0.3, 50.0) > barron_c50(3.0, 1.2, 50.0)


def test_default_source_is_inside_and_one_metre_from_the_longest_wall():
    sx, sy = default_source(SQUARE)
    assert 0 < sx < 5 and 0 < sy < 4
    assert min(sy, 4 - sy) == pytest.approx(1.0)  # longest walls are the 5 m ones


def test_field_shapes_and_nulls_outside():
    f = field(L_SHAPE)
    n = f.nx * f.ny
    for values in (f.c50_db, f.bass_spread_db, f.reflection_db):
        assert len(values) == n
    assert any(v is None for v in f.c50_db)  # the notch
    finite = [v for v in f.c50_db if v is not None]
    assert all(math.isfinite(v) for v in finite)


def test_symmetric_room_gives_a_symmetric_field():
    f = field(SQUARE, source=(2.5, 2.0))
    g = np.array([np.nan if v is None else v for v in f.bass_spread_db]).reshape(f.ny, f.nx)
    assert np.allclose(g, g[:, ::-1], equal_nan=True, atol=1e-6)
    assert np.allclose(g, g[::-1, :], equal_nan=True, atol=1e-6)


def test_reflections_are_strongest_near_walls():
    f = field(SQUARE, source=(2.5, 2.0))
    g = np.array([np.nan if v is None else v for v in f.reflection_db]).reshape(f.ny, f.nx)
    centre = g[f.ny // 2, f.nx // 2]
    edge = np.nanmax(g[:, 1])
    assert edge > centre


def test_best_spot_is_away_from_walls_and_source():
    f = field(SQUARE)
    bx, by = f.best_spot
    assert min(bx, 5 - bx, by, 4 - by) >= 0.6 - 1e-9
    assert math.dist(f.best_spot, f.source) >= 1.0


def test_field_is_deterministic():
    assert field(L_SHAPE) == field(L_SHAPE)


def test_reflection_level_matches_a_hand_calculation():
    # Source (2.5, 2), receiver (2.5, 0.5), both 1.2 m high; walls alpha 0.04 at 1 kHz.
    # Only the y=0 wall reflects within 1.7 m of extra path: image (2.5, -2) at 2.5 m vs the
    # direct 1.5 m. The other walls' paths are over 3.7 m longer and do not count.
    f = field(SQUARE, source=(2.5, 2.0))
    got = f.reflection_db[2 * f.nx + 10]
    want = 10 * math.log10((0.96 / 2.5**2) / (1 / 1.5**2))
    assert got == pytest.approx(want, abs=0.01)


def test_points_with_no_early_wall_reflection_get_the_floor_value():
    f = field(SQUARE, source=(2.5, 2.0))
    assert f.reflection_db[8 * f.nx + 10] == -20.0  # 1.5 m from the source, mid-room
