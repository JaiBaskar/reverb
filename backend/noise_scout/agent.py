"""The Noise Scout Deep Agent: a coordinator plus three specialist sub-agents.

The LLMs read deterministic tool output and write prose; every claim is validated
server-side (validate.py) before it reaches the UI.
"""

import os

from deepagents import SubAgent, create_deep_agent
from langchain_core.tools import BaseTool

from noise_scout.models import ScoutDraft

DEFAULTS = {
    "openrouter": (
        "openrouter:anthropic/claude-sonnet-5.5",
        "openrouter:anthropic/claude-haiku-5.5",
    ),
    "anthropic": ("anthropic:claude-sonnet-5-5", "anthropic:claude-haiku-5-5"),
}


def models() -> tuple[str, str]:
    """(coordinator, specialist) model strings. Explicit env vars win; otherwise use
    OpenRouter when its key is set, else Anthropic directly."""
    provider = "openrouter" if os.environ.get("OPENROUTER_API_KEY") else "anthropic"
    main, sub = DEFAULTS[provider]
    return (
        os.environ.get("NOISE_SCOUT_MODEL", main),
        os.environ.get("NOISE_SCOUT_SUBAGENT_MODEL", sub),
    )


RULES = """
Hard rules:
- You have NO noise measurements. Never state decibel levels, dB(A), loudness numbers or
  indoor sound levels, and never invent measurements.
- Only use facts returned by your tools. Cite the OSM id (like `way/123`) for every source.
- Use distances and compass bearings exactly as the tools report them.
- Room orientation inside the building is unknown: never claim which rooms face a source.
- "Significance" is a relative judgment for someone recording music, not a measurement.
"""

TRANSPORT_PROMPT = f"""You are the transport analyst for a property's noise research.
Investigate road, rail, transit and emergency-vehicle noise around the property.
Steps: call list_noise_sources for road_major, road_minor and rail; call search_nearby for
rail_station, transit_stop, fire_station, hospital and police; call get_osm_tags on the nearest
few relevant features to learn maxspeed, lanes, road class, railway usage or service.
Return a concise markdown list: one bullet per notable source with its OSM id, distance,
bearing, the tags that matter, and why it matters for recording (e.g. sirens, buses idling,
traffic speed). End with what you could not determine.
{RULES}"""

NIGHTLIFE_PROMPT = f"""You are the nightlife and commercial analyst for a property's noise
research. Investigate bars, clubs, venues, restaurants, construction, schools, places of
worship, sports and commercial activity.
Steps: call list_noise_sources for venue and construction; call search_nearby for restaurant,
school, place_of_worship, sports, commercial and parking; call get_osm_tags on the nearest
relevant features, especially to read opening_hours (when venues are loud) and construction
details. Return a concise markdown list: one bullet per notable source with its OSM id,
distance, bearing, relevant tags (quote opening_hours exactly) and why it matters for
recording. End with what you could not determine.
{RULES}"""

AVIATION_PROMPT = f"""You are the aviation and industrial analyst for a property's noise
research. Investigate airports, heliports, industrial land and works, and fuel stations.
Steps: call list_noise_sources for airport, heliport and industrial; call search_nearby for
fuel; call get_osm_tags on what you find (e.g. aerodrome type, helipad use). If nothing is
mapped nearby, say so plainly - that is a useful finding. Return a concise markdown list with
OSM ids, distances, bearings and why each matters. End with what you could not determine.
{RULES}"""

MAIN_PROMPT = f"""You are Noise Scout, a research coordinator helping a musician judge whether a
property is quiet enough to record and mix in. You research the noise around ONE property.

Process:
1. Call get_property_context.
2. Delegate to all three specialists with the task tool, in parallel, giving each the address
   and coordinates: transport-analyst, nightlife-commercial-analyst,
   aviation-industrial-analyst.
3. Save each specialist's report with write_file to /findings/<specialist-name>.md.
4. Combine them into the final structured report: the most important findings first, each
   with the OSM ids that support it in `evidence`; practical recording advice grounded in the
   findings (for example, timing sessions around venue opening hours, or that sirens are
   likely from a nearby fire station); and the data gaps.
Building facts (construction, year built) may inform advice about sound insulation, but say
it is general guidance, not a measurement.
{RULES}"""


def build_agent(context_tools: list[BaseTool], research_tools: list[BaseTool]):
    main_model, subagent_model = models()

    def specialist(name: str, description: str, prompt: str) -> SubAgent:
        return {
            "name": name,
            "description": description,
            "system_prompt": prompt,
            "tools": research_tools,
            "model": subagent_model,
        }

    return create_deep_agent(
        model=main_model,
        tools=context_tools,
        system_prompt=MAIN_PROMPT,
        subagents=[
            specialist(
                "transport-analyst",
                "Researches roads, rail, transit and emergency-vehicle noise near the property.",
                TRANSPORT_PROMPT,
            ),
            specialist(
                "nightlife-commercial-analyst",
                "Researches bars, venues, restaurants, construction, schools and commercial "
                "noise near the property, including opening hours.",
                NIGHTLIFE_PROMPT,
            ),
            specialist(
                "aviation-industrial-analyst",
                "Researches airports, heliports, industrial sites and works near the property.",
                AVIATION_PROMPT,
            ),
        ],
        response_format=ScoutDraft,
        name="noise-scout",
    )
