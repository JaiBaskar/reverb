"""Whole-house planning: which rooms are planned, and one failing room does not sink the rest."""

import json
from pathlib import Path

from properties.models import TourLayout
from properties.normalize import normalize_rooms
from treatment import house

FIX = Path(__file__).parents[1] / "fixtures"
RAW = json.loads((FIX / "matterport_zvKHR9DHNjJ.json").read_text())
TOUR = json.loads(
    (Path(__file__).parents[3] / "contract" / "fixtures" / "tour_zvKHR9DHNjJ.json").read_text()
)


class _Plan:
    def __init__(self, n):
        from treatment.placement import PlacedItem

        item = PlacedItem(key="fr1", product_id="panel_50", group="first_reflection", center=(0, 0, 1.2),
                          normal=(1, 0, 0), up=(0, 0, 1), width_m=0.6, height_m=1.2, depth_m=0.05,
                          wall=0, where="w", reason="r")  # fmt: skip
        self.items = [item] * n

        class P:
            mid_before_s, mid_after_s = 1.0, 0.4
            target_low_s = (0.1, 0.1, 0.15, 0.15, 0.15, 0.15)
            target_high_s = (0.4, 0.3, 0.25, 0.25, 0.25, 0.25)

        class R:
            area_m2, vision_status = 20.0, "unavailable"

        self.prediction, self.room = P(), R()


def test_house_plans_usable_outlined_rooms_and_isolates_failures(monkeypatch):
    rooms = normalize_rooms(RAW["rooms"])
    monkeypatch.setattr(house, "get_rooms", lambda sid: rooms)
    monkeypatch.setattr(house, "get_tour", lambda sid: TourLayout.model_validate(TOUR))
    house._CACHE.clear()
    living = "cdz3fkt38kae7tapstpt0eaeb"

    def fake(sid, room_id, objective, scenario, room=None, cache_only=False):
        assert cache_only  # whole-house plans never trigger new vision calls
        if room_id == living:
            raise RuntimeError("boom")
        return _Plan(2), None

    monkeypatch.setattr(house, "make_plan", fake)
    h = house.house_plan("zvKHR9DHNjJ", "mixing")
    by = {r.room_id: r for r in h.rooms}
    assert by[living].status == "error" and "boom" in by[living].reason
    ok = [r for r in h.rooms if r.status == "ok"]
    assert ok and all(r.item_count == 2 and r.items[0].key.endswith("-fr1") for r in ok)
    assert h.total_items == 2 * len(ok)
    skipped = [r for r in h.rooms if r.status == "skipped"]
    assert skipped and all(r.reason for r in skipped)
    assert all((r.area_m2 or 0) >= house.MIN_AREA_M2 for r in ok)
