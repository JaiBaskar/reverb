# REVERB — project rules
Read PRD.md, CONTEXT.md, SLICES.md (phases), WORKFLOW.md (ownership, git, prompts) first.

## Commands
- Backend setup: `cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Backend run: `cd backend && uvicorn app.main:app --port 8000`
- Backend checks: `cd backend && ruff check . && ruff format . && pytest -q`
- Frontend: `cd frontend && npm install && npm run dev` (http://localhost:5173, proxies `/api` to :8000)
- Frontend checks: `cd frontend && npm run build && npm run lint`

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
