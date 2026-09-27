# Backend handoff: what the desktop app needs from the gateway

Owner: Daniel. For Ron (gateway, auth, audit) and Alessandra (routes, ontology).
The frontend's source of truth for shapes is `src/renderer/api/types.ts`. Anything below that
disagrees with the gateway is a bug in one of us; tell Daniel which side should change.

## 1. CORS (blocks every real call)

The renderer runs on `http://localhost:5173` in dev, and a packaged Electron app sends `Origin: null`.
In `services/api/app/main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "null"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-Id"],  # the error callout shows it; spec 15 puts it in audit rows
)
```

## 2. Going live one route at a time

Mocks stay on (`VITE_USE_MOCKS=true`), and paths listed in `VITE_LIVE_ROUTES` go to the real
gateway (`*` = one path segment). Auth goes first, so mocked routes still get a valid session.
They accept the gateway JWT and read its `role` claim.

```
VITE_LIVE_ROUTES=/auth/login,/me
VITE_LIVE_ROUTES=/auth/login,/me,/patients,/patients/*,/patients/*/summary
```

When everything is live, set `VITE_USE_MOCKS=false`. `make gen-api` then replaces the hand-written
types with ones generated from `/openapi.json`.

## 3. Already aligned

- `POST /auth/login` → `{access_token, user: {id, full_name, role}}`
- `GET /me` → `{user_id, role, permissions[]}`, with permission names from `rbac/permissions.py`
- Error envelope `{error: {code, message, request_id}}` and the spec 15 codes; a 401 signs the user out

## 4. Shapes the UI expects where spec 15 only names the route

All lists are `{items, next_cursor}`. Every clinical object carries
`provenance: {source_system, source_ref, ingested_at}`.

| Route | Item fields the UI reads |
|---|---|
| `GET /patients/{id}` | `id, name, age, sex, mrn, allergies[{substance, provenance}], allergy_status ('recorded' \| 'none_known' \| 'unknown'), sources[{source_system, label, status}]` |
| `GET /patients/{id}/summary` | `conditions[], medications[], allergies[], last_encounter{date, reason, provenance} \| null, new_from_sources[{text, source_system, kind: 'gap' \| 'conflict'}]` |
| `GET /patients/{id}/observations?category=laboratory` | observation table columns: `id, category, loinc_code, display, value_num, value_text, unit, ref_low, ref_high, interpretation ('N' \| 'H' \| 'L' \| 'HH' \| 'LL' \| null), effective_at` |
| `GET /patients/{id}/medications` | `id, medication (display name), status, dosage_text, effective_at, inventory{status: 'in_stock' \| 'low' \| 'backordered', on_hand, expected_restock_at} \| null` |
| `GET /patients/{id}/notes` | `id, kind, title, body, author_name, effective_at, is_legal_record, status` |
| `GET /patients/{id}/findings` | `Finding` in types.ts: model label + confidence are never rewritten; review sets `final_label, review_note, reviewed_by (name), reviewed_at` |
| `GET /patients/{id}/transcripts` | `TranscriptRequest`, newest first (the UI reads the first item as the latest): `id, patient_id, from_provider (display name), status, consent_ref, resources_imported, created_at, completed_at`. `status` uses the DDL values `'requested' \| 'consented' \| 'fetched' \| 'merged' \| 'denied'`. The UI polls every 2 s while the latest is requested, consented or fetched |
| `POST /patients/{id}/transcripts {from_provider_id}` | One `TranscriptRequest` (the UI then reads the newest item of the list). A new request after a merge must stay allowed: spec 11 step 4 pulls only resources newer than the last merged request from that provider. Mock-only demo choice, not a spec rule: the mock returns the patient's open or merged request instead of creating another, and creates a new one only after `denied` |
| `POST /transcripts/{id}/consent {consent_ref, granted}` | The updated `TranscriptRequest` (`consented` or `denied`). Errors the UI shows: 403 `FORBIDDEN_ROLE` for non-admins, 404, 409 `CONFLICT` when the status is no longer `requested`, 422 `VALIDATION_ERROR` for a blank `consent_ref` (a denial needs one too, since the body always carries it). Set `completed_at` on merge or denial |
| `GET /audit?patient_id&action&from&to` | `id, at, actor_name, actor_kind, on_behalf_of, action, object_type, patient_name, allowed, ran_on` |

`null` means "the source did not say". The UI never turns it into a negative ("None", "Normal",
"In stock").

## 5. Known gaps (SPEC-QUESTIONs in the code)

- **Audit rows:** the `audit_log` table stores `actor_user_id`, `patient_id` and a `deny` action. The UI
  needs names (`actor_name`, `on_behalf_of`, `patient_name`), an `allowed` flag, and `ran_on` (where the AI
  step ran, for the Assurant track). There's also no column for which user an AI step acted for. Suggestion: join names in the route, and add
  `on_behalf_of_user_id` and `ran_on` columns.
- **Citations:** there's no route to fetch the record a citation points to (the mock uses `/__mock/sources/{id}`).
- **`/records-tree`** response shape, and an encounter list route.
- **`from_provider_id`** for transcript requests: there's no provider list, so the UI sends `'riverside'`.
- **Admin consent queue** (Admin tab, demo step 3): spec 11 says the gateway creates "a task for the
  admin", but no route lists those tasks. The route name is Ron's call. The UI needs
  `{items: ConsentTask[], next_cursor}` with every status, newest first (it splits pending from recently
  decided). `ConsentTask` is a `TranscriptRequest` plus `patient_name, patient_mrn, requested_by_name`:
  demographics only, since admins cannot read clinical data. **Done:** `GET /admin/consent-tasks`
  (gateway and mock).
- **Dr. Wu's access-denied path** (demo step 9), and the slide tile/heatmap source for OpenSeadragon.
