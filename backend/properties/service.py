import json

from properties.matterport import ROOT, fetch_model
from properties.models import Property, Room
from properties.normalize import normalize_rooms


def shortlist_ids() -> list[str]:
    return json.loads((ROOT / "shortlist.json").read_text())["properties"]


def is_known(sid: str) -> bool:
    """A curated demo pick or any property with a Matterport scan in the CoStar kit."""
    if sid in shortlist_ids():
        return True
    from catalog.service import known_model_ids  # local import: catalog imports this module

    return sid in known_model_ids()


def _to_property(model: dict, rooms: list[Room]) -> Property:
    addr = model.get("address") or {}
    geo = model.get("geolocation") or {}
    return Property(
        sid=model["id"],
        name=model.get("name") or model["id"],
        address=addr.get("address"),
        city=addr.get("locality"),
        state=addr.get("administrativeArea"),
        lat=float(geo["lat"]) if geo.get("lat") else None,
        lon=float(geo["long"]) if geo.get("long") else None,
        usable_room_count=sum(r.usable for r in rooms),
        room_count=len(rooms),
    )


def get_rooms(sid: str) -> list[Room]:
    return normalize_rooms(fetch_model(sid)["rooms"])


def get_property(sid: str) -> Property:
    model = fetch_model(sid)
    return _to_property(model, normalize_rooms(model["rooms"]))


def list_properties() -> list[Property]:
    return [get_property(sid) for sid in shortlist_ids()]
