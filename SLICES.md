# REVERB — Phases

Two series, one per person. Each phase is a **vertical slice**: backend, frontend and tests for one demonstrable feature, so each series always has something working. Deadline 2 am, including video. Phases are in demo-value order; stop-and-cut rules at the bottom.

- **Series A — "Hear it":** property → rooms → acoustics → synthetic IR → A/B audio. This is the critical path for the demo.
- **Series B — "Understand it":** noise evidence → Noise Scout (Deep Agents) → studio suitability → CoStar property facts → demo and video.

Shared files are small on purpose: `contract/` (JSON shapes and fixtures), the backend router list in `backend/app/main.py`, and the frontend shell in `frontend/src/App.tsx`. Everything else is owned by one series (see WORKFLOW.md).

## Series A — Hear it

### A1 — Properties and rooms (also creates the scaffold)
- Repo scaffold: `backend/` (FastAPI, pytest, ruff), `frontend/` (Vite, React, TS, Tailwind), `contract/` with fixtures from the real sample model `zvKHR9DHNjJ`. Push within the first ~30 minutes so Series B can build on it.
- Matterport client, JSON cache, `shortlist.json`, `GET /properties`, `GET /properties/{sid}/rooms`. Missing fields are marked `missing`; a fallback ceiling height is marked `assumed`.
- Frontend: MapLibre map and list from `/properties`; room table with provenance badges; choose Room A and Room B.
- Done when: choosing the sample property shows its rooms with real dimensions. Each shortlisted property has at least 2 rooms with area, width, depth and height.

### A2 — Room acoustics
- `backend/acoustics/`: volume, surface areas, Sabine RT60 per octave band, Schroeder frequency, axial modes, early-reflection delays, editable material presets.
- Tests first, with hand-calculated cases (for example a 5×4×3 m room with uniform absorption).
- `POST /rooms/analyze` returns an `AcousticReport`; frontend numbers panel for the two chosen rooms.
- Done when: tests pass and the sample rooms show plausible RT60, modes and Schroeder frequency in the UI.

### A3 — Synthetic IR and A/B audio player (the demo moment)
- Backend: Pyroomacoustics shoebox IR from the room geometry and per-band absorption; `POST /rooms/ir` returns a WAV. Test: RT60 measured from the IR vs the Sabine value; record the result honestly.
- Frontend: upload a dry file; a `ConvolverNode` per room; Original / Room A / Room B on one playhead; wet/dry and volume; "modeled approximation" label.
- Go/no-go: if the two rooms do not sound clearly different, stop and fix before anything else.
- Verify with an `OfflineAudioContext` render that the output differs from the dry input.

### A4 — Editable assumptions and explanation
- Edit materials in the UI; numbers and audio re-run. Template-based "why these rooms differ" text built from the numbers (no LLM).
- Done when: changing a material visibly changes the numbers and audibly changes the sound.

### A5 — Integration and hardening (with B)
- Run the full demo flow with B's features merged; fix failures; error and missing-data states.

## Series B — Understand it

### B1 — Noise evidence (deterministic)
- `backend/noise/`: Overpass queries for roads by class, rail, aeroway, venues, industrial and construction, with distance and bearing from a lat/long; cached per property. Tests against a recorded fixture response.
- `GET /properties/{sid}/noise` returns a `NoiseReport` (sources, distances, links; no dB). Frontend noise panel and markers, using the sample property's coordinates.
- Done when: the sample property shows real nearby sources on the map and in a list.

### B2 — Noise Scout (Deep Agents)
- **In progress (2026-11-14):** built in `backend/noise_scout/` and `frontend/src/features/noise-scout/`; compiles and is unit-tested, but has NOT been run live yet (needs `ANTHROPIC_API_KEY` in `.env`). Earlier note: deferred until after the MVP; B1 already provides the cited, deterministic noise report.
- Deep Agent with three sub-agents (transport, nightlife/commercial, aviation/industrial), using B1's tools and a virtual filesystem for notes. Every claim needs a citation. Output validates against `NoiseReport`.
- LangSmith tracing on; confirm a trace appears. The B1 report must still render if the agent fails.
- Blocked on: an LLM provider key for the agent and a check of the Deep Agents API.
- Done when: the sample property shows a cited, traced agent report. Test it live before claiming it works.

### B3 — Studio suitability
- Rule-based fit per use case (vocal, instrument, production, mixing, critical listening, podcasting) from the `AcousticReport` shape, with configurable thresholds, reasons, assumptions and missing data. No decibels and no numeric score presented as a physical unit.
- Built against the `AcousticReport` fixture until A2 lands. Frontend fit cards per room.
- Done when: each room shows a fit per use case with its reasons.

### B4 — CoStar property facts
- `backend/costar/`: join `MatterportModelId` to the kit (residential and commercial); expose construction, year built, floors, hardwood flag and ceiling height as `verified` facts, and optional material hints.
- Frontend property facts card. Kit lives in `data/costar-kit/` (not committed).
- Done when: the sample property shows its CoStar facts with provenance.

### B5 — Demo, video and slides
- Choose the final shortlist and the demo rooms and the dry recording with A. Script the 3-minute story from PRD.md, record the video, make slides.

## Cut rules
- A is the critical path. If time runs short, cut in this order: B5 polish, B4, B2, B3, A4. Never cut A1–A3 or B1.
- If a phase takes much longer than planned, stop and cut its scope rather than pushing through.
- Rough timing: A1 by +1h, A2 by +3h, A3 by +6h (go/no-go), A4 by +8h. B1 by +3h, B2 by +6h, B3 by +8h, B4 by +9h. Integration from -4h before the deadline, video from -3h.
