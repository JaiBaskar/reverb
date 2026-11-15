"""Fitting candidate items around the building and furniture (synthetic room, no network)."""

import numpy as np

from properties.models import Field, Room
from roomintel.geometry import room_geometry
from roomintel.obstacles import FurnitureObject, Obstacles
from treatment.fit import building_conflict, fit_item
from treatment.placement import Blocker, PlacedItem

W, D, H = 5.0, 4.0, 2.7
POLY = [[0, 0], [W, 0], [W, D], [0, D]]


def _geo():
    f = lambda v: Field(value=v, provenance="verified")
    room = Room(id="r", label="Studio", label_confidence=None, area_m2=f(W * D), width_m=f(W),
                depth_m=f(D), height_m=f(H), usable=True, issues=[])  # fmt: skip
    return room_geometry(room, POLY, mesh=None)


def _wall_points(y=0.0, x=(0, W), step=0.04):
    """The y = 0 wall as a dense sheet of building points."""
    xs, zs = np.meshgrid(np.arange(x[0], x[1], step), np.arange(0, H, step))
    return np.c_[xs.ravel(), np.full(xs.size, y), zs.ravel()]


def _panel(x=2.0, z=1.2, group="coverage"):
    return PlacedItem(key="p", product_id="panel_50", group=group, center=(x, 0.025, z), normal=(0, 1, 0),
                      up=(0, 0, 1), width_m=0.6, height_m=1.2, depth_m=0.05, wall=0, where="w", reason="r")  # fmt: skip


def _obs(building, furniture=None, objects=()):
    f = np.zeros((0, 3)) if furniture is None else furniture
    return Obstacles(building, f, np.zeros(len(f), int), list(objects))


def test_flat_wall_is_fine():
    geo = _geo()
    it, why = fit_item(_panel(), geo, _obs(_wall_points()), [], [])
    assert why is None and it.status == "ok" and it.center == _panel().center


def test_door_casing_pushes_the_panel_along_the_wall():
    geo = _geo()
    # a 10 cm deep casing sticking out of the wall at x = 1.9..2.1
    xs, zs = np.meshgrid(np.arange(1.9, 2.1, 0.02), np.arange(0, 2.2, 0.04))
    casing = np.c_[xs.ravel(), np.full(xs.size, 0.06), zs.ravel()]
    obs = _obs(np.r_[_wall_points(), casing])
    assert building_conflict(_panel(), obs.building, geo)
    it, why = fit_item(_panel(), geo, obs, [], [])
    assert why is None and it.status == "moved" and "casing" in it.adjustment
    assert abs(it.center[0] - 2.0) >= 0.39  # clear of the casing
    assert building_conflict(it, obs.building, geo) is None


def test_no_wall_behind_means_it_is_moved_off_the_opening():
    geo = _geo()
    obs = _obs(
        _wall_points(x=(0, 1.5))
        if False
        else np.r_[_wall_points(x=(0, 1.5)), _wall_points(x=(2.6, W))]
    )
    it, _ = fit_item(_panel(x=2.0), geo, obs, [], [])
    assert it is not None and (
        it.center[0] + 0.3 <= 1.5 + 1e-6
        or it.center[0] - 0.3 >= 2.6 - 1e-6
        or it.product_id == "panel_50_square"
    )


def test_first_reflection_panel_must_keep_covering_its_point():
    geo = _geo()
    # wall missing over 1.2..2.8: no position within reach still covers x = 2.0
    obs = _obs(np.r_[_wall_points(x=(0, 1.2)), _wall_points(x=(2.8, W))])
    it, why = fit_item(_panel(group="first_reflection"), geo, obs, [], [])
    assert it is None and "no solid wall" in why


def test_agent_window_is_a_no_go_rectangle():
    geo = _geo()
    geo.walls[0].no_go.append((1.6, 2.4, 0.9, 2.1, "window"))
    assert "window" in building_conflict(_panel(), np.zeros((0, 3)), geo)
    it, _ = fit_item(_panel(), geo, _obs(_wall_points()), [], [])
    assert (
        it.status in ("moved", "replaced") and building_conflict(it, np.zeros((0, 3)), geo) is None
    )


def test_furniture_against_the_wall_lifts_the_panel_when_it_can():
    geo = _geo()
    sofa = FurnitureObject(id="f1", min=(1.0, 0.0, 0.0), max=(3.0, 0.9, 0.75), points=500, mounting="floor",
                           label="green sofa", named_by="furniture_agent")  # fmt: skip
    pts = np.c_[np.random.default_rng(0).uniform(1.0, 3.0, 6000), np.random.default_rng(1).uniform(0.0, 0.9, 6000),
                np.random.default_rng(2).uniform(0.0, 0.75, 6000)]  # fmt: skip
    obs = Obstacles(_wall_points(), pts, np.zeros(len(pts), int), [sofa])
    it, _ = fit_item(_panel(group="first_reflection"), geo, obs, [], [])
    assert it.status == "moved" and it.center[2] - it.height_m / 2 >= 0.74 and not it.blocked_by


def test_furniture_that_cannot_be_avoided_is_flagged_not_hidden():
    geo = _geo()
    shelf = FurnitureObject(id="f1", min=(0.0, 0.0, 0.0), max=(W, 0.4, 2.2), points=900, mounting="floor",
                            label="bookcase", named_by="furniture_agent")  # fmt: skip
    rng = np.random.default_rng(0)
    pts = np.c_[rng.uniform(0, W, 20000), rng.uniform(0.0, 0.4, 20000), rng.uniform(0, 2.2, 20000)]
    obs = Obstacles(_wall_points(), pts, np.zeros(len(pts), int), [shelf])
    it, _ = fit_item(_panel(group="first_reflection"), geo, obs, [], [])
    assert it.status == "blocked" and it.blocked_by[0].label == "bookcase"


def test_art_on_the_wall_is_avoided_when_possible():
    geo = _geo()
    art = Blocker(
        id="a", label="artwork", kind="wall_object", min=(1.8, 0.0, 1.0), max=(2.2, 0.06, 1.6)
    )
    it, _ = fit_item(_panel(), geo, _obs(_wall_points()), [art], [])
    assert it.status in ("moved", "replaced") and not it.blocked_by
    assert "artwork" in it.adjustment
