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
pnpm dev                   # Electron + hot reload; mock gateway unless VITE_USE_MOCKS=false (no .env needed)
pnpm test                  # Vitest: CitationChip, ReviewPanel, dashboard empty state
pnpm typecheck && pnpm lint
pnpm test:e2e              # Playwright: builds in mock mode, walks demo steps 1-7 in Electron (~30 s)
pnpm gen:api               # when Ron's gateway serves /openapi.json on :8000
```

Mock mode needs no backend. Demo users all use password `asclep-demo`: reyes (attending), okafor
(nurse), wu (not on Gregory's team), lab, admin. In DevTools, `__asclepMock.failNext = true` makes
the next request fail, which is useful for rehearsing error states.

`electron.vite.config.ts` and `e2e/demo.spec.ts` drop `ELECTRON_RUN_AS_NODE` (set by some Electron-hosted
terminals, e.g. Claude Code in VS Code), which would otherwise start Electron as plain Node.

Shared demo (two users at once): `pnpm demo:host` makes the main process serve the mock gateway over
HTTP (`src/main/demoServer.ts`, port 8787, `/demo/*`, CORS *, LAN-visible, synthetic data only).
Other apps pick "Shared with team" on the login screen (`DemoServerPicker`, saved per computer in
localStorage); `client.ts` then sends mocked calls there instead of the in-window mock. The host can
open extra windows (user menu or Ctrl+Shift+N). `__asclepMock.failNext` only affects the in-window mock.
e2e: `e2e/shared-demo.spec.ts`. Tests run with `ASCLEP_USER_DATA` set to a temp profile.

One-window mock demo (step 3): mock state lives in memory and survives sign-out (only the session, UI
state and query cache reset), so one window can play both roles. As Dr. Reyes click Request records,
then sign out → sign in as admin → Admin tab → Review → consent reference → Record consent → sign
out → sign in as reyes → Ctrl+K Gregory. The mock merges about 3.5 s after consent.

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
                             audit, records, admin (consent queue)
```

## What works now (verified with a Playwright walk of the demo path, no console errors)

1. Login (role-specific landing) → Dashboard (attention strip, schedule, tasks, recent, supply watch)
2. Gregory → Lab → Analyze → unverified finding (LUAD, 87%) + Resident report with citation chips
3. Citation chip → SourceDrawer with provenance → Confirm → green "Confirmed by Dr. Maya Reyes"
4. Patient → Request records ("Waiting for consent...") → admin records consent on the Admin tab
   (Review → consent reference → Record consent, or Deny) → Importing → merged → penicillin allergy
   tag, Riverside source, "New from Riverside" callout (gap wording, not "conflict")
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
| `from_provider_id` for transcript requests: no provider list endpoint | Request records | Alessandra |
| `/records-tree` exists live (`{folders:[{name, items[]}]}`); Records tab still composes other routes | Records tab | (ours to switch) |

Resolved (Sep 27): citations use `GET /sources/{Type:uuid}` in both modes; Dr. Wu reaches Gregory by
exact MRN and gets the Emergency access screen (`POST /patients/{id}/emergency-access`); consent queue
is `GET /admin/consent-tasks`; `answer_md` is rendered by `tabs/ask/answerParts.ts` (bold + inline
`[[obj:Type:uuid]]` chips, no markdown library); the Lab viewer stacks thumbnail + heatmap `<img>` blobs
from `/files` (same size, so no OpenSeadragon); the Lab tab lists `GET /patients/{id}/slides`;
`ran_on` is in audit rows; the gateway has CORS middleware. `scribeApi` in `hooks.ts` is dead code (LiveScribe replaced it).

Node: the shell may have Node 18; the app needs ≥20.19. Electron bundles Node 22, so gates run as
`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron node_modules/vitest/vitest.mjs run`
(same for `electron-vite/bin/electron-vite.js build` and `@playwright/test/cli.js test`).

## Next steps, in order

1. ~~Copy this folder into the repo (`apps/desktop/`) and add `AGENT_CONTEXT.md` (spec sections 13–17).~~ Done.
2. `pnpm gen:api` as soon as Ron's OpenAPI exists; swap `api/types.ts` to re-export generated types.
   Go live route by route with `VITE_LIVE_ROUTES` (see `docs/BACKEND_HANDOFF.md`), then `VITE_USE_MOCKS=false`.
3. ~~Admin tab: pending consent tasks + "Record consent".~~ Consent queue done. Left: role matrix and
   care teams (spec 14.2).
4. ~~Lab: heatmap overlay + real tiles from `GET /files/{path}`.~~ Done (stacked images; live once findings are seeded).
5. ~~Patient sub-tabs: Labs (Recharts trend), Meds (inventory status), Notes, Findings, Sources.~~ Done (not yet walked in the running app).
6. ~~Records tab (Blueprint Tree), Audit filters (Table2 + DateRangeInput).~~ Done.
7. ~~One Playwright e2e over demo steps 1–7 (spec 18.5).~~ Done: `e2e/demo.spec.ts`.
8. Left: Records tab → `/records-tree`, dashboard alert ack / task complete, Admin role matrix + care teams,
   live walk with `make dev-desktop-full` after Ron's reseed.

## Scribe backend notes (Brandon's vlmlol prototype, reviewed earlier)

The frontend already follows the 10.5 window contract. Backend gaps to hold him to: local inference
only (remove the Hugging Face hosted default), camera only (the prototype starts the mic by default),
observable-only wording (the prototype's log guessed "head tilt may accompany discomfort or
fatigue"), timestamps when motion happened (not model reply time), and VLM on port 8300 (the
prototype's 8080 clashes with ehr-a).
