from acoustics.advice import advise, parallel_wall_pairs
from acoustics.field import room_field
from acoustics.furniture import default_furnishing
from acoustics.report import analyze_room
from properties.models import Field, Room

SQUARE = [(0.0, 0.0), (5.0, 0.0), (5.0, 4.0), (0.0, 4.0)]


def room(label="Living Room"):
    f = lambda v: Field(value=v, provenance="verified")
    return Room(id="r1", label=label, label_confidence=None, area_m2=f(20.0), width_m=f(5.0),
                depth_m=f(4.0), height_m=f(2.7), usable=True, issues=[])  # fmt: skip


def insight(furniture):
    rep = analyze_room("s", room(), furniture=furniture, outline=SQUARE)
    alpha = {m.surface: m.alpha for m in rep.materials}
    fld = room_field(SQUARE, 2.7, rep.rt60_s, alpha)
    return rep, fld, advise(rep, fld, SQUARE)


def test_rectangle_has_two_parallel_wall_pairs():
    pairs = parallel_wall_pairs(SQUARE)
    assert sorted(round(p.separation_m, 2) for p in pairs) == [4.0, 5.0]


def test_advice_covers_placement_reverb_bass_reflections_and_flutter():
    _, _, adv = insight(default_furnishing("Living Room"))
    kinds = {a.kind for a in adv}
    assert {"placement", "reverb", "bass", "reflections", "flutter", "furniture"} <= kinds
    assert all("dB(A)" not in a.detail for a in adv)


def test_empty_room_advice_says_furniture_is_not_counted():
    _, _, adv = insight(None)
    furn = next(a for a in adv if a.kind == "furniture")
    assert "empty" in furn.detail.lower()


def test_furniture_share_is_reported():
    _rep, _, adv = insight(default_furnishing("Living Room"))
    furn = next(a for a in adv if a.kind == "furniture")
    assert "%" in furn.detail
