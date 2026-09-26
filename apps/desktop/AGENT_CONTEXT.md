# Agent context: apps/desktop
Owner: Daniel. Spec sections given to agents: 0, 6, 10.5, 13, 14, 15, 16, 17, 18.

| Section | Why |
|---|---|
| 0 | Product overview |
| 6 | Locked tech stack (dependency checks) |
| 10.5 | Scribe window contract |
| 13 | RBAC, care-team denial, audit rows the UI shows |
| 14 | Shell, tabs, dashboard, review panel, design tokens |
| 15 | Every route and type the renderer calls (`src/renderer/api`) |
| 16 | Mock gateway seed (`src/renderer/api/mock`) |
| 17 | The Gregory Hale demo path |
| 18 | Repo layout, conventions, agent rules (18.4 pasted into every session), testing |

- Blueprint components only unless none exists. Light theme by team decision; dark theme via the
  user menu toggle (spec 14.1 said dark default).
- All server calls through TanStack Query hooks (`src/renderer/api/hooks.ts`). Types are hand-written
  from spec 15 until `pnpm gen:api` can run against the gateway.
- Every AI text block: warning-colored left border + "AI draft" label until reviewed.
- Scribe: getUserMedia({video: true, audio: false}); frames in a max-10 in-memory ring buffer; never saved.
- Agents only edit files inside `apps/desktop/`. See `CLAUDE.md` for working rules and open SPEC-QUESTIONs.
