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
- Add a property by adding its Matterport model ID to `shortlist.json`; it needs >=2 rooms with area, width, depth and height.
- Matterport rooms may omit `dimensions` or any field in it. Use `.get`; never index.
- Matterport lat/long arrive as strings. maplibre-gl v6 has named exports only (no default import).
- If `npm install` fails with root-owned cache files: `npm install --cache <some writable dir>`.
- Write failing tests first for calculations and data transforms; run the real app before calling a phase done.
