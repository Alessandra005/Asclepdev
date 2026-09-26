# Agent context: services/api (gateway)

Owners: Ron (auth/, rbac/, audit/, migrations/) and Alessandra (routes/, ontology/ implementation, ingest/, alerts/, ehr/).
Spec sections given to agents: 0, 7, 7A, 8, 11, 12, 13, 15, 18.

Rules:
- Every route MUST depend on `require(...)` from app.rbac.require (or be listed in PUBLIC_PATHS). tests/test_routes_require.py fails otherwise.
- No SQL against clinical tables outside app/ontology/.
- Errors are raised as AsclepError(code, message, status) so they render in the spec's error format.
- Do not edit migrations/ or packages/contracts; write `# SPEC-QUESTION:` and stop.
