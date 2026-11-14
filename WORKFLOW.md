# REVERB — Working Solo Through Your Phases

Each person works alone through their own series in SLICES.md. One person, one Claude Code session at a time, one phase at a time. Two people never edit the same files.

## Ownership
| Area | Series A | Series B |
|---|---|---|
| Backend | `backend/properties/`, `backend/acoustics/`, `backend/ir/` | `backend/noise/`, `backend/suitability/`, `backend/costar/` |
| Frontend | `frontend/src/features/{map,rooms,numbers,audio}/` | `frontend/src/features/{noise,suitability,facts}/` |
| Shared (tiny, change carefully) | `contract/`, the router list in `backend/app/main.py`, `frontend/src/App.tsx` | same |
| Docs | PRD, CONTEXT, SLICES, CLAUDE.md: small commits, tell the other person | same |

A creates the scaffold in A1. B starts on B1 as soon as A pushes it (until then B can work in `backend/noise/` with its own tests). Adding a feature to a shared file should be one line (register a router, mount a panel).

## Git
- Repo: https://github.com/JaiBaskar/reverb.git. `.env` and `data/` are git-ignored; each person has their own `.env` and downloads the CoStar kit themselves.
- Branch per phase: `a/A1-properties`, `b/B1-noise`. Open a PR or merge to `main` when the phase passes its checks. Rebase on `main` before merging.
- Pull `main` at the start of each phase. If `contract/` changed, re-read it.
- Contract changes: own small commit, announce it in chat, the other person pulls it before continuing.

## Phase loop (one person, one phase)
1. Fresh Claude Code session. Name the phase.
2. Plan mode: proposed files and test cases, no edits.
3. Tests first for calculations and transforms.
4. Implement across backend and frontend, then run format, lint, typecheck, tests.
5. Run the real app and check the behavior in the browser.
6. Fresh-context review of the diff against the phase's acceptance criteria.
7. Commit atomically, merge, tell the other person.

## Prompt templates

**Start a phase (Series A example)**
```
Read PRD.md, CONTEXT.md and SLICES.md phase A2 only. I'm working Series A solo; stay in the A-owned directories in WORKFLOW.md.
Enter plan mode first: list the files you'll create or change and the test cases, with hand-calculated expected values, before writing code.
Then write the failing tests, implement the backend and the frontend panel, and run pytest, ruff, the typechecker and the frontend build.
Launch the app and check the behavior. Report what you verified and what you did not.
```

**Start a phase (Series B example)**
```
Read PRD.md, CONTEXT.md and SLICES.md phase B1 only. I'm working Series B solo; stay in the B-owned directories in WORKFLOW.md.
Plan mode first. Use a recorded Overpass response as a test fixture so tests don't depend on the network.
Implement GET /properties/{sid}/noise and the noise panel, then run the checks, launch the app and verify with the sample property.
```

**Use someone else's work before it lands**
```
Phase B3 needs the AcousticReport shape from A2. Use contract/fixtures/acoustic_report.json. Don't edit A-owned files; if the shape is wrong, propose a contract change instead.
```

**Contract change**
```
Propose a change to contract/ for <reason>. Show the old and new shape, which fixtures change, and who is affected. Don't edit anything outside contract/ until I confirm.
```

**Independent review (fresh session)**
```
Review the diff on branch <branch> against phase <id> in SLICES.md and the non-goals in PRD.md. Check calculations against independent values, missing-data handling, provenance labels, and unnecessary complexity. Don't edit files; list findings with file and line.
```

**Integration check (after pulling the other series)**
```
Pull main. Start backend and frontend, run the full 3-minute demo flow from PRD.md in the browser, and report every step that fails. Fix only integration bugs in files I own; list the rest for the other person.
```

**Correction capture**
```
That was wrong because <reason>. Add one short actionable rule to CLAUDE.md if it's likely to recur.
```

## Sync points
- A pushes the scaffold first (A1), then B pulls it.
- Every 60–90 minutes: both pull `main` and run the integration check.
- From -4h before the deadline: integration (A5). From -3h: video (B5) with feature freeze; bug fixes only.
