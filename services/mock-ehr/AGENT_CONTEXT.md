# Mock EHR Agent Context

Follow `docs/SPEC.md` sections 0, 8, 16, and 18. This service owns HAPI compose
fragments, Synthea generation/loading, and synthetic golden FHIR fixtures only.
Use deterministic resource IDs and transaction PUT entries so reruns are safe.
Never add real or realistic personal data.