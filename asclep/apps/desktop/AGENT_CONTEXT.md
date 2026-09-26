# Agent context: apps/desktop
Owner: Daniel. Spec sections given to agents: 0, 14, 15, 17, 18.
- Blueprint components only unless none exists. Dark theme default.
- All server calls through TanStack Query hooks using the generated OpenAPI types.
- Every AI text block: warning-colored left border + "AI draft" label until reviewed.
- Scribe: getUserMedia({video: true, audio: false}); frames in a max-10 in-memory ring buffer; never saved.
