from typing import Literal

from pydantic import BaseModel

Provenance = Literal["verified", "estimated", "assumed", "missing"]


class Fact(BaseModel):
    key: str
    label: str
    value: str | int | float | bool | None
    unit: str | None = None
    provenance: Provenance
    source: str | None = None
    note: str | None = None


class MaterialHint(BaseModel):
    surface: Literal["floor", "walls", "ceiling"]
    material_id: str
    reason: str
    provenance: Provenance = "verified"


class PropertyFacts(BaseModel):
    sid: str = ""
    status: Literal["ok", "unavailable"] = "ok"
    kind: Literal["residential", "commercial"] | None = None
    costar_id: int | None = None
    facts: list[Fact] = []
    material_hints: list[MaterialHint] = []
    notes: list[str] = []
    data_source: str = "CoStar hackathon data kit"
