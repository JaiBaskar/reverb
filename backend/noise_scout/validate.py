"""Server-side checks on the agent's draft. The LLM's words are never trusted for facts:
every finding must cite OSM ids a tool returned in this run, and decibel claims are rejected."""

import re

from langchain_core.messages import BaseMessage

from noise_scout.models import Finding, Rejected, ScoutDraft
from noise_scout.tools import EvidenceLedger

DECIBEL = re.compile(r"\b\d+(\.\d+)?\s*(-\s*\d+(\.\d+)?\s*)?(dB[A-Z]?|decibels?)\b", re.IGNORECASE)
DISTANCE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:m|meters|metres)\b")


def _distance_warnings(text: str, distances: list[float]) -> list[str]:
    warnings = []
    for match in DISTANCE.finditer(text):
        stated = float(match.group(1))
        if distances and not any(abs(stated - d) <= max(15.0, 0.2 * d) for d in distances):
            warnings.append(
                f"The text says {match.group(0)}, but the cited sources are at "
                + ", ".join(f"{d:.0f} m" for d in distances)
                + "; trust the source distances."
            )
    return warnings


def validate_draft(
    draft: ScoutDraft, ledger: EvidenceLedger
) -> tuple[list[Finding], list[Rejected]]:
    findings: list[Finding] = []
    rejected: list[Rejected] = []
    for f in draft.findings:
        text = f"{f.title} {f.detail}"
        if DECIBEL.search(text):
            rejected.append(
                Rejected(title=f.title, reason="states a decibel level, which we cannot know")
            )
            continue
        if not f.evidence:
            rejected.append(Rejected(title=f.title, reason="no evidence cited"))
            continue
        unknown = [e for e in f.evidence if e not in ledger]
        if unknown:
            rejected.append(
                Rejected(
                    title=f.title,
                    reason=f"cites {', '.join(unknown)}, which was not returned by any tool",
                )
            )
            continue
        evidence = [ledger.get(e) for e in dict.fromkeys(f.evidence)]
        distances = [e.distance_m for e in evidence if e.distance_m is not None]
        findings.append(
            Finding(
                title=f.title,
                detail=f.detail,
                category=f.category,
                significance=f.significance,
                evidence=evidence,
                warnings=_distance_warnings(text, distances),
            )
        )
    kept = []
    for advice in draft.recording_advice:
        if DECIBEL.search(advice):
            rejected.append(
                Rejected(title=f"Advice: {advice[:60]}", reason="states a decibel level")
            )
        else:
            kept.append(advice)
    draft.recording_advice = kept
    if DECIBEL.search(draft.summary):
        draft.summary = DECIBEL.sub("[level removed]", draft.summary)
    return findings, rejected


def subagents_used(messages: list[BaseMessage]) -> list[str]:
    names = set()
    for m in messages:
        for call in getattr(m, "tool_calls", None) or []:
            if call.get("name") == "task":
                name = (call.get("args") or {}).get("subagent_type")
                if name:
                    names.add(name)
    return sorted(names)


def count_tool_calls(messages: list[BaseMessage]) -> int:
    return sum(len(getattr(m, "tool_calls", None) or []) for m in messages)
