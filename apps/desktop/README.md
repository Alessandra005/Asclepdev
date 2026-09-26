# Desktop app (spec section 14). Owner: Daniel.

Electron (electron-vite) + React 18 + TypeScript strict + Blueprint 6 + TanStack Query + Zustand + Recharts.

## Run it

Needs Git and Node 22 LTS (20.19+ also works). No backend, Docker or database: the app runs on a
built-in mock gateway with the synthetic spec 16 seed.

```
npm install -g pnpm  # once per machine; pnpm then switches itself to the pinned 10.28.0
cd apps/desktop
pnpm install         # first run downloads Electron, a few minutes
pnpm dev             # opens the Asclep window with hot reload
```

Sign in as `reyes@asclep.demo` / `asclep-demo`. Other demo users, same password: `okafor` (nurse),
`wu` (not on Gregory's care team), `lab`, `admin`. The login screen has a Demo user picker.

To rehearse the records-consent step in one window: as Dr. Reyes, open Gregory and click Request
records; sign out; sign in as `admin` and record consent on the Admin tab; sign back in as Dr. Reyes.

## Other commands

```
pnpm test            # Vitest unit tests
pnpm test:e2e        # builds, then Playwright walks demo steps 1-7 in Electron (~40 s)
pnpm typecheck && pnpm lint
pnpm gen:api         # or `make gen-api`; needs the gateway serving /openapi.json on :8000
```

In DevTools (Ctrl+Shift+I), `__asclepMock.failNext = true` makes the next request fail, for
rehearsing error states.

## Real gateway

Mocks are on unless `VITE_USE_MOCKS=false`. Copy `.env.example` to `.env` to change it, or use
`VITE_LIVE_ROUTES` to send only some routes to the gateway (see `docs/BACKEND_HANDOFF.md`).

## Troubleshooting

- **"Cannot reach the Asclep gateway" at login:** your `.env` has `VITE_USE_MOCKS=false`. Set it back
  to `true` (or delete `.env`). The real gateway can't serve the app end to end yet; see
  `docs/BACKEND_HANDOFF.md`.
- **`pnpm: command not found`:** run `npm install -g pnpm`. Using Corepack instead? On Windows,
  `corepack enable` needs an admin terminal (it writes to `C:\Program Files\nodejs`), and Node
  22.12–22.13 ship a Corepack that fails with "Cannot find matching keyid"; `npm install -g
  corepack@latest` fixes that.
- **`make: command not found` (Windows):** Git Bash has no `make`; run `pnpm dev` in `apps/desktop`
  instead of `make dev-desktop`.
- **Red squiggles in VS Code but `pnpm typecheck` passes:** VS Code is using its own TypeScript.
  Open `apps/desktop` as the folder, or run "TypeScript: Select TypeScript Version" → "Use
  Workspace Version".

See `CLAUDE.md` for context, conventions and next steps.
