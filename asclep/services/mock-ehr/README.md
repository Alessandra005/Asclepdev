# Mock EHRs (spec sections 8 and 16). Owner: Alessandra.

Two HAPI FHIR R4 servers from docker-compose: `ehr-a` (Riverside Family Medicine, :8080) and `ehr-b` (Northside Oncology & Urology, :8081).

TODO:
- Synthea: 150 patients per EHR, seed 42 -> POST bundles.
- Hand-authored golden bundles in `data/seed/golden/` (Gregory Hale, Linda Morales, Priya Shah).
- Gregory's `ehr-a` records tagged `demo-transcript` so they are NOT pre-ingested.
