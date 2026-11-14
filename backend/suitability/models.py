from typing import Literal

from pydantic import BaseModel, Field

CheckStatus = Literal["pass", "caution", "fail"]
FitLevel = Literal["good", "workable", "poor"]


class Check(BaseModel):
    id: str
    label: str
    status: CheckStatus
    reason: str
    treatable: bool = Field(
        description="True if acoustic treatment or furnishing can change it (reverberation)"
    )


class Fit(BaseModel):
    use_case: str
    label: str
    level: FitLevel = Field(description="As modeled: empty room with the assumed materials")
    shape_level: FitLevel | None = Field(
        description="From the checks treatment cannot change (size, height, bass modes)"
    )
    checks: list[Check]


class SuitabilityReport(BaseModel):
    sid: str
    room_id: str
    label: str
    fits: list[Fit]
    assumptions: list[str]
    missing: list[str]
    method: str
