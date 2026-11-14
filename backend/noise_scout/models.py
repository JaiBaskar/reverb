"""Noise Scout shapes: what the LLM drafts, and the validated result the API returns."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Significance = Literal["low", "moderate", "high"]


class DraftFinding(BaseModel):
    """One claim drafted by the agent. Validated server-side before anyone sees it."""

    title: str = Field(description="Short headline, e.g. 'Busy arterial 80 m south'")
    detail: str = Field(
        description="1-3 sentences on why this matters for recording. No decibel levels."
    )
    category: str = Field(description="Noise category, e.g. road_major, rail, venue, emergency")
    significance: Significance = Field(
        description="Relative judgment for a recording musician, not a measurement"
    )
    evidence: list[str] = Field(
        description="OSM ids (like 'way/123' or 'node/456') returned by tools that support this"
    )


class ScoutDraft(BaseModel):
    """Structured output of the Noise Scout agent."""

    summary: str = Field(description="3-5 sentence overview for a musician. No decibel levels.")
    findings: list[DraftFinding]
    recording_advice: list[str] = Field(
        description="Practical advice grounded in the findings (e.g. timing around venue hours)"
    )
    data_gaps: list[str] = Field(description="What could not be determined from the tools")


class Evidence(BaseModel):
    id: str
    name: str | None = None
    kind: str
    subtype: str | None = None
    distance_m: float | None = None
    bearing_compass: str | None = None
    osm_url: str
    tags: dict[str, str] = {}
    source_tool: str
    distance_note: str | None = None


class Finding(BaseModel):
    title: str
    detail: str
    category: str
    significance: Significance
    evidence: list[Evidence]
    warnings: list[str] = []


class Rejected(BaseModel):
    title: str
    reason: str


class TraceInfo(BaseModel):
    project: str | None = None
    run_id: str | None = None
    url: str | None = None


class NoiseScoutResult(BaseModel):
    sid: str
    status: Literal["ok", "not_run", "unavailable", "error"]
    generated_at: datetime
    model: str | None = None
    subagent_model: str | None = None
    summary: str | None = None
    findings: list[Finding] = []
    recording_advice: list[str] = []
    data_gaps: list[str] = []
    rejected: list[Rejected] = []
    subagents_used: list[str] = []
    tool_calls: int = 0
    files: dict[str, str] = {}
    trace: TraceInfo = TraceInfo()
    notes: list[str] = []
