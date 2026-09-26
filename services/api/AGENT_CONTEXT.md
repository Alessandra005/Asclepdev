# Backend & Data Agent Context

Follow `docs/SPEC.md` sections 0, 7A, 8, 11, 12, 13, 15, 16, and 18.

Owned paths for this workstream are `app/routes/`, `app/ontology/`, `app/ehr/`,
`app/alerts/`, `app/ingest/`, and the API tests. Do not edit `packages/contracts/`,
migrations, auth, audit, or another owner's service. Clinical-table access belongs
inside `app/ontology/`; routes remain thin and use `require()` plus audit logging.