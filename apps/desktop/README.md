# Desktop app (spec section 14). Owner: Daniel.

Electron (electron-vite) + React 18 + TypeScript strict + Blueprint 6 + TanStack Query + Zustand + Recharts.

```
corepack enable
pnpm install
pnpm dev        # or `make dev-desktop` from the repo root; uses the in-memory mock gateway
pnpm test       # Vitest
pnpm gen:api    # or `make gen-api`; needs the gateway serving /openapi.json on :8000
```

Mock mode (`.env`: `VITE_USE_MOCKS=true`) needs no backend. Demo login: `reyes@asclep.demo` /
`asclep-demo` (also okafor, wu, lab, admin). Every view handles loading / empty / error states.
See `CLAUDE.md` for context, conventions and next steps.
