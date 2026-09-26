# Asclep desktop app: handoff context for Claude Code

This file carries the context from the planning session (Claude Cowork, ShellHacks 2026). Read it
before doing anything. The full spec is `docs/SPEC.md` at the repo root. The frontend plan is
*Asclep_Frontend_Kickoff.pdf* (8 pages, not in the repo; ask Daniel). `AGENT_CONTEXT.md` lists the spec sections agents get here.

## Who and what

- **Me:** Daniel Bencomo, Frontend & Data owner (spec section 4). I own `apps/desktop` only.
- **Team:** Ron (system design, contracts, auth/audit, merges `packages/contracts` + migrations),
  Brandon (AI: lab-tech, resident, Scribe VLM), Alessandra (backend routes, ontology, seed, mock EHRs).
- **Product:** Asclep, a clinical desktop layer over EHRs. Demo is one patient, Gregory Hale, end to
  end (spec section 17). Synthetic data only. No real PHI, ever.
- **Stack (locked, spec section 6):** Electron via electron-vite, React 18 + strict TS, Blueprint 6,
  TanStack Query (server data), Zustand (session + UI state), openapi-typescript types, Recharts,
  OpenSeadragon. pnpm. Ask before adding any other dependency.

## GitHub rule

- Team repo: `RonaldSierraDev/Asclepdev`. This project lives in `apps/desktop/` in that repo (spec 18.1 layout).
- **Use only the `MFMFUZE` GitHub account for ShellHacks work.** Never `dbencomo-svg`.
- Branch names `daniel/short-topic`. PRs under 400 lines. Never push or open a PR without asking me.

## Sponsor tracks (decided after prompts dropped; see docs/SPONSOR_TRACKS.md)

- **Microsoft "What's Missing?" (primary):** the core experience **cannot be a chatbot or depend on a
  chat window**. So the demo leads with finished tasks (records merge, lab review + sign, Scribe note).
  Ask is a one-shot cited lookup, not a chat thread. Never make chat the hero.
- **Assurant "Take Control of AI" (secondary):** privacy + transparency. Show where every AI step
  ran (`LocalProcessingPill`), consent records, "what the AI used" (citations), and the AI activity log
  in Audit. Nothing reaches the record without physician approval.
- Best Overall is automatic. Sperry/Waymo/Blackstone/State Farm do not fit.

## Visual direction

Light gray canvas, white cards, narrow black sidebar, compact 12px tables, minimal color. Status
color only via Blueprint intents. Dark theme via the user menu (spec 14.1 says dark default; the team
chose this light look, and the toggle keeps both). Tokens are in `src/renderer/styles.css`.

## Run it

```
corepack enable            # once, gives you pnpm
pnpm install
pnpm dev                   # Electron + hot reload; .env has VITE_USE_MOCKS=true
pnpm test                  # Vitest: CitationChip, ReviewPanel, dashboard empty state
pnpm typecheck && pnpm lint
pnpm test:e2e              # Playwright: builds in mock mode, walks demo steps 1-7 in Electron (~30 s)
pnpm gen:api               # when Ron's gateway serves /openapi.json on :8000
```

Mock mode needs no backend. Demo users all use password `asclep-demo`: reyes (attending), okafor
(nurse), wu (not on Gregory's team), lab, admin. In DevTools, `__asclepMock.failNext = true` makes
the next request fail, which is useful for rehearsing error states.

## Layout

```
src/main/index.ts            Electron main. Camera permission: video yes, audio always denied.
src/preload/index.ts         Tiny bridge. The renderer talks to the gateway over HTTP only.
src/renderer/
  api/types.ts               Hand-written mirror of spec 15 (snake_case). Replace with schema.d.ts later.
  api/client.ts              gateway(): Bearer auth, error envelope -> GatewayError, 401 -> sign out.
  api/hooks.ts               All TanStack Query hooks + scribeApi. Query keys are scoped by user id.
  api/mock/                  In-memory gateway: seed (spec 16), RBAC, audit rows, Scribe windows.
  state/session.ts, ui.ts    Zustand. Memory only. Logout clears session, UI state and query cache.
  components/                AppShell, PatientSearch (Omnibar, Ctrl+K), PatientHeader, CitationChip,
                             SourceDrawer, AiDraftBlock, ReviewPanel, LocalProcessingPill,
                             QueryState (loading/empty/error), RelativeTime, RequirePatient
  tabs/                      login, dashboard, patient (+ ScribePanel, useScribeCapture), lab, ask,
                             audit, records (stub), admin (stub)
```

## What works now (verified with a Playwright walk of the demo path, no console errors)

1. Login (role-specific landing) → Dashboard (attention strip, schedule, tasks, recent, supply watch)
2. Gregory → Lab → Analyze → unverified finding (LUAD, 87%) + Resident report with citation chips
3. Citation chip → SourceDrawer with provenance → Confirm → green "Confirmed by Dr. Maya Reyes"
4. Patient → Request records → polls until merged → penicillin allergy tag, Riverside source,
   "New from Riverside" callout (gap wording, not "conflict")
5. Scribe: consent dialog → camera (video only, 1 fps, 10-frame RAM ring buffer, 512px JPEG, window
   every 10 s, drop if one is in flight, 30-min auto-stop) → live observations → Stop → AI draft
   note → Accept / Edit / Discard (attending only)
6. Ctrl+K patient search, Ctrl+1..5 tab switching, Ask cited answer, Audit with "ran on" column

## Rules (spec 18.4, apply to every change)

- Only edit files inside this project. Do not invent gateway routes. Write `SPEC-QUESTION` in a
  comment and ask me instead.
- Every AI output is a draft. Never set a finding status other than `pending_review` client-side.
  Status changes only after the gateway confirms (no optimistic updates on sign-off).
- Every data view handles loading, empty and error states (`QueryState`).
- Missing data is never a negative finding: allergy status `unknown` shows "Allergies: unknown".
- At least one Vitest test per new component. Strict TS, no `any`.

Auth shapes (`User`, `MeResponse`) and permission names mirror Ron's `services/api/app/auth/router.py`
and `services/api/app/rbac/permissions.py`. Keep them identical when those files change.

## Open SPEC-QUESTIONs (grep the code for `SPEC-QUESTION`)

| Question | Blocks | Ask |
|---|---|---|
| No public source-detail route for citations (`useSourceRecord` is mock-only) | SourceDrawer, Ask, Lab | Ron + Alessandra |
| Slide viewer: DZI/IIIF source, tile/heatmap coordinates (OpenSeadragon not wired yet) | Lab viewer | Ron + Brandon |
| `from_provider_id` for transcript requests: no provider list endpoint | Request records | Alessandra |
| Where the AI step ran (`ran_on`) is not in the audit DDL | Assurant story | Ron |
| How Dr. Wu opens Gregory to show "access denied" when `/patients` only lists his own patients (MRN lookup? break-the-glass?) | Demo step 9 | Ron |
| Markdown renderer for `answer_md` is not in the library list | Ask | Ron |
| Pending admin consent task data (Admin tab, demo step 3) | Admin tab | Ron + Alessandra |
| `/records-tree` response shape; no encounter list route (Records tab composes existing routes for now) | Records tab | Ron + Alessandra |
| Gateway has no CORS middleware; dev renderer runs on `http://localhost:5173` (packaged Electron sends `Origin: null`) | Every real API call | Ron |

## Next steps, in order

1. ~~Copy this folder into the repo (`apps/desktop/`) and add `AGENT_CONTEXT.md` (spec sections 13–17).~~ Done.
2. `pnpm gen:api` as soon as Ron's OpenAPI exists; swap `api/types.ts` to re-export generated types.
   Turn mocks off (`VITE_USE_MOCKS=false`) route by route as real endpoints land.
3. Admin tab: pending consent tasks + "Record consent" (needed for demo step 3 with two windows).
4. Lab: OpenSeadragon viewer + heatmap overlay + real tiles from `GET /files/{path}`.
5. ~~Patient sub-tabs: Labs (Recharts trend), Meds (inventory status), Notes, Findings, Sources.~~ Done (not yet walked in the running app).
6. ~~Records tab (Blueprint Tree), Audit filters (Table2 + DateRangeInput).~~ Done.
7. ~~One Playwright e2e over demo steps 1–7 (spec 18.5).~~ Done: `e2e/demo.spec.ts`.

## Scribe backend notes (Brandon's vlmlol prototype, reviewed earlier)

The frontend already follows the 10.5 window contract. Backend gaps to hold him to: local inference
only (remove the Hugging Face hosted default), camera only (the prototype starts the mic by default),
observable-only wording (the prototype's log guessed "head tilt may accompany discomfort or
fatigue"), timestamps when motion happened (not model reply time), and VLM on port 8300 (the
prototype's 8080 clashes with ehr-a).
