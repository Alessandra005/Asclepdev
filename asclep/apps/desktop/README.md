# Desktop app (spec section 14). Owner: Daniel.

Electron (electron-vite) + React 18 + TypeScript strict + Blueprint + TanStack Query + Zustand.

Start here:
1. `pnpm create @quick-start/electron` (React + TS template) in this folder.
2. Add `pnpm gen:api` -> `openapi-typescript http://localhost:8000/openapi.json -o src/renderer/api/schema.ts`.
3. Build the shell: left nav (Dashboard, Ask, Patient, Lab, Records, Audit, Admin*), Omnibar (Ctrl+K), dark theme.
4. Build against the mock services first; every view needs loading / empty / error states.
