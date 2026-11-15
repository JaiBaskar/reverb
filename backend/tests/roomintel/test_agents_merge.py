"""Specialist agents (no network) and the deterministic merge of their answers."""

import math

import numpy as np
import pytest
import trimesh

from acoustics.materials import MATERIALS
from properties.models import Field, Room
from roomintel import agents, merge
from roomintel.agents import AgentRun
from roomintel.geometry import room_geometry
from roomintel.obstacles import build
from roomintel.panorama import ScanPosition, project
from roomintel.views import WallView, along_wall, plan_views, render

W, D, H = 4.0, 3.0, 2.5
POLY = [[0, 0], [W, 0], [W, D], [0, D]]
SCAN = ScanPosition(id="s1", position=(2.0, 1.5, 1.5), yaw_deg=0.0, room_id="r")


def _geo():
    f = lambda v: Field(value=v, provenance="verified")
    room = Room(id="r", label="Studio", label_confidence=None, area_m2=f(W * D), width_m=f(W),
                depth_m=f(D), height_m=f(H), usable=True, issues=[])  # fmt: skip
    return room_geometry(room, POLY, mesh=None)


def test_extract_json_tolerates_fences_and_prose():
    assert agents.extract_json('Sure!\n```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(ValueError):
        agents.extract_json("no json here")


def test_agent_without_key_is_unavailable(monkeypatch, tmp_path):
    for k in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "REVERB_VISION_MODEL"):
        monkeypatch.delenv(k, raising=False)
    run = agents.run_agent(
        "walls", agents.WallsReport, "p", {"W0": tmp_path / "x.jpg"}, tmp_path / "c.json"
    )
    assert run.status == "unavailable" and run.answer is None and not (tmp_path / "c.json").exists()


def test_agent_error_is_recorded_not_filled(monkeypatch, tmp_path):
    monkeypatch.setenv("REVERB_VISION_MODEL", "openrouter:any")

    def boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(agents, "_ask", boom)
    run = agents.run_agent(
        "walls", agents.WallsReport, "p", {"W0": tmp_path / "x.jpg"}, tmp_path / "c.json"
    )
    assert run.status == "error" and "provider down" in run.reason and run.answer is None


def test_wall_view_column_maps_back_to_the_wall():
    geo = _geo()
    views = plan_views(geo, [SCAN])
    v = next(v for v in views if v.wall == 2)  # the y = 3 wall, seen from the room centre
    wall = geo.walls[2]
    # a point 1.0 m along that wall projects to some column; that column maps back to 1.0 m
    p = np.array(wall.start) + (np.array(wall.end) - np.array(wall.start)) / wall.length_m * 1.0
    th = math.radians(v.yaw_deg)
    dx, dy = p[0] - SCAN.position[0], p[1] - SCAN.position[1]
    fwd = dx * math.cos(th) + dy * math.sin(th)
    left = -dx * math.sin(th) + dy * math.cos(th)
    x = 0.5 - left / fwd / (2 * math.tan(math.radians(v.hfov_deg) / 2))
    assert along_wall(v, SCAN, wall, x) == pytest.approx(1.0, abs=1e-6)


def test_render_samples_the_right_face():
    faces = {k: np.full((8, 8, 3), k * 40, dtype=np.uint8) for k in (1, 2, 3, 4)}
    img = render(SCAN, faces, yaw=0.0, hfov=60, w=16, h=8)
    assert (img[4, 8] == 40).all()  # straight ahead along the pano heading is face 1
    img = render(SCAN, faces, yaw=-90.0, hfov=60, w=16, h=8)
    assert (img[4, 8] == 80).all()  # 90 deg clockwise is face 2


def _walls_run(features, material="brick"):
    return AgentRun(agent="walls", status="ok", answer={
        "walls": [{"image": "W0", "material_id": material, "finish": "red brick", "confidence": 0.9, "features": features}],
        "surfaces": [{"surface": "floor", "material_id": "carpet", "finish": "grey carpet", "confidence": 0.8},
                     {"surface": "ceiling", "material_id": "carpet", "finish": "?", "confidence": 0.9}],
    })  # fmt: skip


def test_walls_merge_features_become_metres_and_heights():
    geo = _geo()
    v = WallView(wall=0, scan_id="s1", yaw_deg=-90.0, hfov_deg=90.0, width=1024, height=640)
    feat = {
        "kind": "window",
        "x_start": 0.25,
        "x_end": 0.75,
        "y_top": 0.3,
        "y_bottom": 0.6,
        "covering": "blinds",
        "confidence": 0.9,
    }
    found = merge.walls_found(_walls_run([feat]), geo, [v], {"s1": SCAN})
    w0 = found[0]
    assert w0.material_id == "brick"
    f = w0.features[0]
    assert f.category == "building"
    # wall 0 is y = 0, 1.5 m from the scan; x 0.25..0.75 at 90 deg FOV spans +/-0.75 m around x = 2
    assert f.along == pytest.approx((1.25, 2.75), abs=1e-6)
    assert f.z[0] < f.z[1] and 0 <= f.z[0] and f.z[1] <= H
    surf = merge.surfaces_found(_walls_run([]))
    assert surf["floor"][0] == "carpet" and "ceiling" not in surf  # carpet is not a ceiling finish


def test_wall_absorption_counts_glass_and_open_doorways():
    geo = _geo()
    v = WallView(wall=0, scan_id="s1", yaw_deg=-90.0, hfov_deg=90.0, width=1024, height=640)
    door = {
        "kind": "open_doorway",
        "x_start": 0.25,
        "x_end": 0.75,
        "y_top": 0.0,
        "y_bottom": 1.0,
        "covering": "none",
        "confidence": 0.9,
    }
    found = merge.walls_found(
        _walls_run([door], material="painted_drywall"), geo, [v], {"s1": SCAN}
    )
    extra, notes = merge.wall_absorption(geo, found, "painted_drywall")
    f = found[0].features[0]
    area = (f.along[1] - f.along[0]) * (f.z[1] - f.z[0])
    base = MATERIALS["painted_drywall"]["alpha"]
    assert extra[3] == pytest.approx(area * (1.0 - base[3]))
    assert notes and "open doorway" in notes[0]


def test_low_confidence_or_unknown_ids_are_not_used():
    geo = _geo()
    v = WallView(wall=0, scan_id="s1", yaw_deg=-90.0, hfov_deg=90.0, width=1024, height=640)
    run = _walls_run([{"kind": "window", "x_start": 0.2, "x_end": 0.4, "y_top": 0.2, "y_bottom": 0.5, "covering": "none", "confidence": 0.3}],
                     material="marble")  # fmt: skip
    w0 = merge.walls_found(run, geo, [v], {"s1": SCAN})[0]
    assert w0.material_id is None and w0.features == []


def test_furniture_covering_picks_the_table_entry():
    assert merge.piece_id("sofa", "leather") == "sofa_leather"
    assert merge.piece_id("sofa", "fabric") == "sofa"
    assert merge.piece_id("curtains", "plastic") is None  # blinds are not drapes
    assert merge.piece_id("lamp", "metal") is None


def test_piece_floor_point_comes_from_the_scan_pose():
    x, y = project(SCAN, 1, (3.9, 1.5, 0.0))
    run = AgentRun(agent="furniture", status="ok", answer={"pieces": [
        {"kind": "sofa", "covering": "fabric", "label": "sofa", "count": 1, "image": "S1F1",
         "x_start": x - 0.05, "x_end": x + 0.05, "floor_y": y, "top_y": None, "confidence": 0.9}]})  # fmt: skip
    p = merge.pieces_found(run, {"S1": SCAN}, 0.0, lambda a, b: True)[0]
    assert p.position == pytest.approx((3.9, 1.5), abs=1e-6) and p.furniture_id == "sofa"
    assert merge.furniture_items([p])[0].provenance == "observed"


def _box(size, at):
    return trimesh.creation.box(size, trimesh.transformations.translation_matrix(at))


def test_obstacles_separate_furniture_from_the_building():
    shell = trimesh.util.concatenate([
        _box([W, D, 0.05], [W / 2, D / 2, -0.025]), _box([W, D, 0.05], [W / 2, D / 2, H + 0.025]),
        _box([0.05, D, H], [-0.025, D / 2, H / 2]), _box([0.05, D, H], [W + 0.025, D / 2, H / 2]),
        _box([W, 0.05, H], [W / 2, -0.025, H / 2]), _box([W, 0.05, H], [W / 2, D + 0.025, H / 2]),
    ])  # fmt: skip
    sofa = _box([2.0, 0.9, 0.8], [2.0, 2.5, 0.4])
    lamp = _box([0.3, 0.3, 0.3], [1.0, 1.0, 2.2])
    full = trimesh.util.concatenate([shell, sofa, lamp])
    obs = build(shell, full, POLY, 0.0, H)
    kinds = sorted(o.mounting for o in obs.objects)
    assert kinds == ["ceiling", "floor"]
    sofa_obj = next(o for o in obs.objects if o.mounting == "floor")
    assert sofa_obj.min[0] == pytest.approx(1.0, abs=0.1) and sofa_obj.max[2] == pytest.approx(
        0.8, abs=0.1
    )
