# REVERB — Product Requirements

Hear what your future studio could sound like before you move in.

## 1. Problem
Musicians, producers and audiophiles choose rentals without knowing how the rooms behave acoustically. Listings give square footage and photos, not reverberation, room modes or neighbourhood noise. Visiting every candidate is slow, and a bad room is expensive to discover after signing.

## 2. Target users
- Home-studio musicians and producers looking for a rental to record or mix in.
- Audiophiles looking for a critical-listening room.
- Niche on purpose: the product is a tool for these people, not a general real-estate app.

## 3. Product principles
- **The engine is the product.** All acoustic numbers come from deterministic Python. No LLM output is ever presented as a calculation or measurement.
- **Modeled, not measured.** Every IR, audio preview and score is labelled a modeled approximation.
- **Every input carries provenance:** `verified` (from CoStar/Matterport), `estimated` (derived by us from verified data), `assumed` (a default we chose, user-editable), `missing`.
- **AI is a researcher, not a calculator.** Deep Agents gather and cite noise-context evidence; they never invent decibels.

## 4. Core functionality (MVP)
1. **Property shortlist.** A curated set of Matterport/CoStar properties (extensible by adding a model ID). Map plus list. Property facts from CoStar where joined.
2. **Room geometry.** From the Matterport Model API: per-room `areaFloor`, `width`, `depth`, `height`, label and confidence. Missing values are filled by a flagged fallback (floor-plan edges or an assumed ceiling height) or the room is marked unusable.
3. **Acoustic engine** (per room): volume, surface areas, Sabine RT60 per octave band (125 Hz–4 kHz) from editable material assumptions, axial modes, Schroeder frequency, early-reflection delays.
4. **Synthetic IR.** Pyroomacoustics generates a room impulse response from the room geometry and absorption. The server returns a WAV. We check that the RT60 measured from the generated IR is consistent with the Sabine figure.
5. **Virtual audio A/B (the key moment).** The user uploads a dry recording, picks two rooms, and the browser convolves the audio with each IR using the Web Audio API (`ConvolverNode`). Wet/dry and volume controls. Original, Room A and Room B are switchable on the same playhead.
6. **Numbers and explanation.** A panel shows the underlying calculations. A deterministic, template-based explanation says why the rooms differ (for example, "Room A RT60 0.9 s at 500 Hz vs Room B 0.3 s because volume is 4× and surfaces are harder"). It is generated from the numbers, not by an LLM.
7. **Studio suitability.** Rule-based fit for vocals, instruments, production, mixing, critical listening and podcasting from RT60, Schroeder frequency and mode spacing. Output is a qualitative fit with the reasons, assumptions and missing data. It is not a decibel figure.
8. **Noise Scout (Deep Agents).** A research agent with sub-agents (transport, nightlife/commercial, aviation/industrial) calls deterministic tools (OpenStreetMap queries for roads by class, rail, airports, venues, industrial land use, construction) and writes a cited evidence report to a virtual filesystem. Output is a list of nearby sources with distance, bearing and source links, plus a relative exposure indication. It reports no indoor dB and no invented measurements.

**Tracing (LangChain track).** The Noise Scout runs are traced to LangSmith (project `reverb-noise-scout`) so the demo can show sub-agent delegation, tool calls and cited outputs. Tracing is for the app's own agent only and is configured through `LANGSMITH_*` variables in `.env`. It is untested until the first agent run.

## 5. User stories
- As a producer, I pick a property and two rooms and hear my own vocal take through each.
- As a mixer, I see whether a room's low-frequency modes and RT60 suit mixing, and why.
- As an audiophile, I see what noise sources sit near the building, with sources cited.
- As any user, I can tell which numbers are verified, estimated or assumed, and edit the assumptions.

## 6. Technical architecture
- **Backend:** Python 3.12, FastAPI. Modules: `matterport` (GraphQL client), `costar` (kit join), `acoustics` (pure functions), `ir` (Pyroomacoustics), `noise_scout` (Deep Agents), `shortlist`.
- **Data:** no database. The CoStar kit is read from local files. Matterport results are cached as JSON per model ID. The shortlist is a config file of model IDs.
- **Frontend:** Vite, React, TypeScript, Tailwind, MapLibre (OpenStreetMap tiles), Web Audio API. No 3D in the MVP.
- **Contract:** shared JSON shapes (`Property`, `Room`, `AcousticReport`, `IrResponse`, `NoiseReport`) agreed first so both builders can work independently against fixtures.
- **Secrets:** loaded from `.env`. Matterport calls are server-side only.
- **Team workflow:** two people, each solo through their own phase series (SLICES.md) on separate branches and directories, sharing only `contract/`. See WORKFLOW.md.

## 7. Data sources and assumptions
| Data | Source | Provenance |
|---|---|---|
| Address, coordinates | Matterport `address`, `geolocation` | verified |
| Room area, width, depth, height | Matterport `rooms.dimensions` | verified when present |
| Floor plan, wall edges | Matterport `floors`, `assets.floorplans` | verified, fallback only |
| Construction, year built, floors, hardwood flag, ceiling height | CoStar kit join | verified when present |
| Surface materials and absorption | Our preset tables | assumed, editable |
| Noise-source locations | OpenStreetMap | verified from OSM, may be incomplete |
| Occupancy, furnishings | none | assumed empty room |

Known data gaps (observed on the sample model): some rooms have no height or depth, and some have only an area. "Void" rooms have no dimensions.

## 8. Success criteria
The 3-minute demo works end to end live:
1. Select a shortlisted property on the map.
2. Show two rooms with their dimensions and provenance badges.
3. Show calculated RT60, modes and Schroeder frequency.
4. Upload one dry recording.
5. Hear Original, Room A and Room B through real convolution.
6. Show the explanation of why they differ.
7. Show the cited Noise Scout report for the property.

## 9. Non-goals
No MCP server. No claim that modeled audio is measured. No indoor dB estimates or relative scores presented as decibels. No invented dimensions. No assumption that all properties have Matterport. No 3D visualization or reflection rendering in the MVP. No accounts, database, payments, or open search over all ~15,000 models. No Vexcel imagery in the MVP.

## 10. Risks and limitations
- **Shoebox approximation.** Pyroomacoustics ShoeBox is a rectangular model. Irregular rooms are approximated with an equivalent box (`width`, `depth`, `height`, scaled to match `areaFloor`). Say so in the UI.
- **Absorption assumptions dominate RT60.** Materials are not in the data, so results are only as good as the presets. Expose them and show the sensitivity.
- **Missing dimensions** reduce the usable room count. The shortlist must be checked for at least two complete rooms each.
- **Deep Agents integration is untested.** We have not yet run the library, chosen the LLM provider or confirmed its API key. The Noise Scout tools (Overpass queries) must work without the LLM so the report still renders if it fails.
- **OpenStreetMap coverage and rate limits.** Overpass can be slow or incomplete. Cache results per property.
- **Possible DOT noise data.** The BTS National Transportation Noise Map might offer modeled road/aviation levels. It is unverified and a stretch; do not rely on it.
- **Pyroomacoustics RIR accuracy and tail.** Image-source gives accurate early reflections but a sparse tail. A hybrid or ray-tracing setting may be needed. This is untested.
- **Time.** Deadline is 2 am with video. Slices are ordered by demo value so a working prefix always exists.

## 11. Three-minute demo story
1. (20s) The problem: you can't hear a rental before you sign.
2. (30s) Pick a property on the map; two rooms appear with verified/assumed badges.
3. (40s) Play the same dry vocal: original, Room A, Room B. The audience hears the difference.
4. (40s) Open the numbers: volume, RT60 by band, Schroeder frequency, modes, and the plain explanation.
5. (30s) Suitability for each use, with reasons and the missing data.
6. (20s) Noise Scout: sub-agents research the neighbourhood and return a cited report.
