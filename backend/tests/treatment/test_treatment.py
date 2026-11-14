"""Treatment engine on a synthetic rectangular studio (no network)."""

import math

import pytest

from acoustics.physics import SABINE_CONSTANT, air_m, eyring_absorption_for, eyring_rt60
from acoustics.products import PRODUCTS
from properties.models import Field, Room
from roomintel.geometry import room_geometry
from roomintel.panorama import ScanPosition
from treatment.objectives import OBJECTIVES, targets
from treatment.optimizer import delta_absorption, optimise, predict, treated_level
from treatment.placement import candidates, monitoring_layout, wall_names, wall_reflections
from treatment.viewpoint import choose

W, D, H = 5.0, 4.0, 2.7
POLY = [[0, 0], [W, 0], [W, D], [0, D]]
DRYWALL = [0.29, 0.10, 0.05, 0.04, 0.07, 0.09]


def _geo(poly=POLY):
    f = lambda v: Field(value=v, provenance="verified")
    room = Room(id="r", label="Studio", label_confidence=None, area_m2=f(W * D), width_m=f(W),
                depth_m=f(D), height_m=f(H), usable=True, issues=[])  # fmt: skip
    return room_geometry(room, poly, mesh=None)


def _inside(p, margin=0.0):
    return margin <= p[0] <= W - margin and margin <= p[1] <= D - margin


def test_layout_is_symmetric_on_the_long_axis():
    geo = _geo()
    lay = monitoring_layout(geo)
    assert lay is not None and lay.kind == "monitoring"
    (s1, s2), lis = lay.sources, lay.listener
    # long axis is x (5 m): speakers share an x, symmetric about the room's centre line y = 2
    assert s1[0] == pytest.approx(s2[0]) and (s1[1] + s2[1]) / 2 == pytest.approx(D / 2)
    assert lis[1] == pytest.approx(D / 2)
    spacing = math.dist(s1, s2)
    assert math.dist(s1, lis) == pytest.approx(spacing, abs=1e-6)  # equilateral
    front = min(lis[0], W - lis[0])
    # 38 % of the length, unless the triangle needs more room in front of the speakers
    assert front == pytest.approx(max(0.38 * W, 0.4 + spacing * math.sqrt(3) / 2), abs=0.01)
    assert all(_inside(p, 0.3) for p in (*lay.sources, lis))
    assert set(lay.source_names) == {"left speaker", "right speaker"}


def test_reflection_point_obeys_the_mirror_law():
    geo = _geo()
    lay = monitoring_layout(geo)
    for r in wall_reflections(geo, lay, 0.04):
        if r.wall is None:
            assert r.point[2] == pytest.approx(H)
            continue
        src = lay.sources[lay.source_names.index(r.source)]
        p, L = r.point, lay.listener
        w = geo.walls[r.wall]
        n = w.inward
        # angle of incidence equals angle of reflection about the wall normal
        a = (src[0] - p[0]) * n[0] + (src[1] - p[1]) * n[1]
        b = (L[0] - p[0]) * n[0] + (L[1] - p[1]) * n[1]
        ta = math.hypot(src[0] - p[0], src[1] - p[1])
        tb = math.hypot(L[0] - p[0], L[1] - p[1])
        assert a / ta == pytest.approx(b / tb, abs=1e-6)
        assert r.level_db < 0 and r.delay_ms > 0


def test_side_wall_names_follow_the_listener():
    geo = _geo()
    lay = monitoring_layout(geo)
    names = set(wall_names(geo, lay).values())
    assert names == {"front wall", "rear wall", "left wall", "right wall"}


def test_candidates_are_on_walls_inside_the_room_and_never_overlap():
    geo = _geo()
    lay = monitoring_layout(geo)
    c = candidates(geo, lay, DRYWALL[3], allow_diffusion=True)
    assert len(c.corners) == 4
    wall_items = [*c.first_reflection, *c.front_wall, *c.rear_wall_absorb, *c.slots]
    for i in wall_items:
        assert _inside(i.center, -0.01)
        assert i.center[2] - i.height_m / 2 >= 0  # not below the floor
    for a in wall_items:
        for b in wall_items:
            if a is not b and a.wall == b.wall:
                assert math.dist(a.center, b.center) >= 0.6 - 1e-6, (a.key, b.key)


def test_a_doorway_blocks_placement():
    geo = _geo()
    lay = monitoring_layout(geo)
    for w in geo.walls:  # make every wall one big opening
        w.strips = [0.0] * len(w.strips or [0] * 40)
    c = candidates(geo, lay, DRYWALL[3], allow_diffusion=True)
    assert not c.first_reflection and not c.slots and not c.corners
    assert any("opening" in n for n in c.notes)


def test_sabine_bookkeeping_for_a_wall_panel():
    geo = _geo()
    lay = monitoring_layout(geo)
    c = candidates(geo, lay, DRYWALL[3], True)
    panel = c.slots[0]
    d = delta_absorption(panel, DRYWALL)
    p = PRODUCTS[panel.product_id]
    assert d[3] == pytest.approx((p.alpha[3] - DRYWALL[3]) * 0.72)
    vol = W * D * H
    surf = 2 * W * D + 2 * (W + D) * H
    base = [10.0] * 6
    rt = predict(base, vol, [panel], DRYWALL, surf)
    # Eyring with air absorption, by hand
    a_bar = (10 + d[3]) / surf
    assert rt[3] == pytest.approx(
        SABINE_CONSTANT * vol / (-surf * math.log(1 - a_bar) + 4 * air_m(1000) * vol)
    )


def test_treated_reflection_level():
    assert treated_level(-5.0, 1.0) == pytest.approx(-5 + 10 * math.log10(0.05))


def test_optimiser_hits_the_target_and_is_deterministic():
    geo = _geo()
    lay = monitoring_layout(geo)
    obj = OBJECTIVES["mixing"]
    vol = W * D * H
    tg = targets(obj, vol, [125, 250, 500, 1000, 2000, 4000])
    s = W * D * 2 + 2 * (W + D) * H
    base = [s * a for a in DRYWALL]  # bare drywall box: very live
    c = candidates(geo, lay, DRYWALL[3], True)
    best, ranked = optimise(c, obj, tg, base, vol, DRYWALL, s)
    best2, _ = optimise(c, obj, tg, base, vol, DRYWALL, s)
    assert [i.key for i in best.items] == [i.key for i in best2.items]
    before = eyring_rt60(vol, base[3], s, 1000)
    assert before > tg[3][1] and best.rt60_s[3] < before
    assert best.rfz_misses == 0  # mixing needs the reflection-free zone
    assert best.score <= min(r.score for r in ranked)


def test_a_dead_room_gets_no_absorption():
    geo = _geo()
    lay = monitoring_layout(geo)
    obj = OBJECTIVES["recording"]
    vol = W * D * H
    tg = targets(obj, vol, [125, 250, 500, 1000, 2000, 4000])
    s = W * D * 2 + 2 * (W + D) * H
    base = [
        eyring_absorption_for(0.25, vol, s, f) for f in (125, 250, 500, 1000, 2000, 4000)
    ]  # 0.25 s: under 0.3 s
    c = candidates(geo, lay, DRYWALL[3], True)
    best, _ = optimise(c, obj, tg, base, vol, DRYWALL, s)
    absorbers = [i for i in best.items if PRODUCTS[i.product_id].kind != "diffuser"]
    assert not absorbers


def test_ebu_target_scales_with_volume():
    obj = OBJECTIVES["mixing"]
    small = targets(obj, 40, [500])[0]
    big = targets(obj, 200, [500])[0]
    assert sum(big) > sum(small)
    assert (small[0] + small[1]) / 2 == pytest.approx(0.25 * (0.4) ** (1 / 3))


def test_viewpoint_sees_items_from_a_real_scan():
    geo = _geo()
    lay = monitoring_layout(geo)
    c = candidates(geo, lay, DRYWALL[3], True)
    items = [*c.first_reflection, *c.corners[:2]]
    scans = [ScanPosition(id="a", position=(1.0, 1.0, 1.5), yaw_deg=0, room_id="r"),
             ScanPosition(id="out", position=(9.0, 9.0, 1.5), yaw_deg=0, room_id="r")]  # fmt: skip
    vp = choose(geo, scans, items)
    assert vp.scan_id == "a" and vp.items_in_view
    assert choose(geo, [], items) is None
