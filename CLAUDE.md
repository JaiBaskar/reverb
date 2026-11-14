# REVERB — project rules
Read PRD.md, CONTEXT.md, SLICES.md (phases), WORKFLOW.md (ownership, git, prompts) first.

## Commands
- Backend setup: `cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Backend run: `cd backend && uvicorn app.main:app --port 8000`
- Backend checks: `cd backend && ruff check . && ruff format . && pytest -q`
- Frontend: `cd frontend && npm install && npm run dev` (http://localhost:5173, proxies `/api` to :8000)
- Frontend checks: `cd frontend && npm run build && npm run lint && npm test`
- Matterport Bundle SDK (3D floor tints): `cd frontend && npm run setup:matterport` (copies the licensed showcase bundle into git-ignored `public/matterport-bundle/`; never commit it). Without it the tour falls back to the Embed SDK with no 3D tint.
- Vite proxy target: `REVERB_API=http://localhost:8010 npm run dev` when :8000 is taken.

## Rules
- Secrets live in `.env` at the repo root (git-ignored; never commit, never echo). `data/` and `backend/.cache/` are git-ignored.
- Acoustic numbers come only from deterministic Python. LLMs never produce measurements or dB values.
- Every input/output carries provenance: verified | estimated | assumed | missing. Never fill a gap silently.
- Modeled audio is labelled a modeled approximation, never measured.
- Shapes shared by backend and frontend live in `contract/` (fixtures are real API responses). Change them in their own commit and tell the other person.
- Discovery: `backend/catalog/` indexes every CoStar-kit property with a Matterport scan (~5,100; cached in `data/cache/catalog/index.json`, delete to rebuild). `shortlist.json` only marks DEMO picks. Routers check `properties.service.is_known(sid)`, not the shortlist.
- Matterport rooms may omit `dimensions` or any field in it. Use `.get`; never index.
- Matterport lat/long arrive as strings. maplibre-gl v6 has named exports only (no default import).
- If `npm install` fails with root-owned cache files: `npm install --cache <some writable dir>`.
- Write failing tests first for calculations and data transforms; run the real app before calling a phase done.
- Pyroomacoustics: seed with `pra.random.seed(n)` (not `np.random.seed`) or IRs are not reproducible. Pure-specular rays (scattering 0) give RT60 40-50% above Sabine; we assume scattering 0.5. Below ~250 Hz the IR is modal and will not match Sabine.
- Web Audio: set `ConvolverNode.normalize = false` BEFORE assigning `.buffer`. One source feeding both rooms' convolvers keeps A/B switching on one playhead.
- MapLibre: call `setWorkerUrl` with `maplibre-gl/dist/maplibre-gl-worker.mjs?url` (Vite moves the bundle, so the default worker URL 404s and tiles never render), and `map.resize()` on container resize.
- API tests run offline: `backend/tests/test_api.py` monkeypatches `properties.service.fetch_model` with a recorded Matterport response.
- Noise Scout (Deep Agents): needs `OPENROUTER_API_KEY` (preferred, uses `openrouter:anthropic/claude-sonnet-5.5` + `haiku-5.5`) or `ANTHROPIC_API_KEY` in `.env`; override with `NOISE_SCOUT_MODEL` / `NOISE_SCOUT_SUBAGENT_MODEL`. A $0-limit OpenRouter key only runs `:free` models; tested working: coordinator `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free`, specialists `openrouter:nvidia/nemotron-3.5-super-vl:free` (~5 min per run; results cached in `data/cache/noise_scout/`). The LLM never supplies facts: findings must cite OSM ids returned by tools in that run, and dB claims are rejected (`noise_scout/validate.py`).
- Noise map: one MapLibre map (`features/map/PropertyMap.tsx` + `noiseLayers.ts`) draws properties and noise geometry; there is no separate noise map. Public Overpass is often slow or down: `noise/service.py` splits base/extra queries, tries 4 mirrors, and serves the last good cache on failure. Bump `SCHEMA_VERSION` when the report shape changes.
- UI is one journey (`frontend/src/ui/steps.ts` + `ui/journey.tsx`): Discover → Explore → Configure → Analyze → Audition → Compare → Decide. `App.tsx` computes each step's done flag; add new panels inside the step they belong to, essentials first and detail behind `<details>`.
- Noise location: Matterport geolocation (verified), else the CoStar record's coordinates (estimated, with a note) in `noise/router.py`, so a property without a usable scan still gets surroundings.
- Scan availability: `GET /properties/{sid}/viewer` (`properties/viewer.py`) checks visibility/state/publication via the Model API (cached in `backend/.cache/matterport/viewer/`); a 300-scan random sample of the catalog was 100% embeddable.
- Matterport 3D tour (A6): the browser gets only `MATTERPORT_SDK_KEY` (domain-restricted; injected by `vite.config.ts`). Model API key/token stay server-side. Model API positions are z-up; SDK/three.js is y-up: sdk `(x, y, z)` = model `(x, z, -y)` (verified on zvKHR9DHNjJ).
- SDK `Room.current` follows the camera, so during a fly-through it reports every room on the path; only trust it once `Sweep.current.sid` is non-empty. `Sweep.current.roomInfo` was wrong on zvKHR9DHNjJ; use `Room.current` or the Model API sweep->room map.
- Self-hosted bundle 26.5.4 stays in `appphase.loading` with its loading screen up although the view works; `revealBundleView` hides `#loading-gui` once the SDK reports a mode. Do not assign the iframe `src` twice (React StrictMode) or the Embed showcase can stay black.
