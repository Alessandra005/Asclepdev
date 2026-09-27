"""Transcript request/consent flow (spec §11, §13). Owner: Alessandra."""
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.ehr.hapi import HapiAdapter
from app.ingest.pipeline import land_bundle, process_raw_records
from app.ontology.api import create_task


class RequestTranscriptPayload(BaseModel):
    """Matches spec §15 route table: POST /patients/{id}/transcripts {from_provider_id}."""
    patient_id: UUID
    from_provider_id: UUID


# The desktop has no provider list yet, so it sends a short key (docs/BACKEND_HANDOFF.md). Spec 16 providers.
PROVIDER_KEYS = {"riverside": "ehr-a", "northside": "ehr-b"}
PROVIDER_LABELS = {"ehr-a": "Riverside Family Medicine", "ehr-b": "Northside Oncology & Urology"}


def resolve_provider_id(s: Session, key_or_id: str) -> UUID:
    """A provider UUID, or a short key like 'riverside'. LookupError when neither matches."""
    try:
        return UUID(key_or_id)
    except ValueError:
        pass
    name = PROVIDER_KEYS.get(key_or_id.strip().lower())
    pid = s.execute(text("SELECT id FROM provider WHERE name = :n"), {"n": name}).scalar() if name else None
    if pid is None:
        raise LookupError(f"Unknown provider '{key_or_id}'.")
    return pid


_VIEW_SQL = """SELECT t.*, pr.name AS provider_name,
                      p.given_name || ' ' || p.family_name AS patient_name, p.mrn AS patient_mrn,
                      u.full_name AS requested_by_name
               FROM transcript_request t
               JOIN provider pr ON pr.id = t.from_provider_id
               JOIN patient p ON p.id = t.patient_id
               LEFT JOIN app_user u ON u.id = t.requested_by"""


def _view(row, with_task: bool = False) -> dict:
    """The desktop's TranscriptRequest (plus ConsentTask fields for the admin queue)."""
    out = {k: row[k] for k in ("id", "patient_id", "status", "consent_ref", "resources_imported",
                               "created_at", "completed_at")}
    out["from_provider"] = PROVIDER_LABELS.get(row["provider_name"], row["provider_name"])
    if with_task:  # demographics only: admins cannot read clinical data (spec 13)
        out |= {k: row[k] for k in ("patient_name", "patient_mrn", "requested_by_name")}
    return out


def get_request(s: Session, request_id: UUID) -> dict:
    return _view(s.execute(text(_VIEW_SQL + " WHERE t.id = :id"), {"id": request_id}).mappings().one())


def list_consent_tasks(s: Session) -> list[dict]:
    """Every request, newest first; the Admin tab splits pending from recently decided."""
    rows = s.execute(text(_VIEW_SQL + " ORDER BY t.created_at DESC LIMIT 100")).mappings().all()
    return [_view(r, with_task=True) for r in rows]


class MergeTranscriptPayload(BaseModel):
    """Matches spec §15 route table: POST /transcripts/{id}/consent {consent_ref, granted}."""
    transcript_request_id: UUID
    consent_ref: str
    granted: bool


def request_transcript(s: Session, p: Principal, payload: RequestTranscriptPayload) -> dict:
    """Step 1-2 of spec §11's flow. status='requested'."""
    rel = s.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": p.user_id, "p": payload.patient_id},
    ).scalar()
    if rel is None:
        raise PermissionError("You are not on this patient's care team.")

    request_id = s.execute(
        text("""INSERT INTO transcript_request (patient_id, requested_by, from_provider_id, status)
                VALUES (:pid, :uid, :provider, 'requested') RETURNING id"""),
        {"pid": payload.patient_id, "uid": p.user_id, "provider": payload.from_provider_id},
    ).scalar()
    # Step 2's "task for the admin" is the consent queue itself: GET /admin/consent-tasks lists every
    # open request, so no separate task row is needed.
    return get_request(s, request_id)


def merge_transcript(s: Session, p: Principal, payload: MergeTranscriptPayload) -> dict:
    """Steps 3-7 of spec §11's flow, triggered by POST /transcripts/{id}/consent.
    granted=False -> denied. granted=True -> consented -> fetched -> merged, all
    synchronous (spec §15: long-running calls are synchronous with a timeout)."""
    req = s.execute(
        text("SELECT * FROM transcript_request WHERE id = :id"), {"id": payload.transcript_request_id}
    ).mappings().first()
    if not req:
        raise LookupError(f"Transcript request {payload.transcript_request_id} not found")
    if req["status"] != "requested":
        raise ValueError(f"Transcript request is already '{req['status']}', not requested.")

    if not payload.granted:
        s.execute(
            text("UPDATE transcript_request SET status = 'denied', consent_ref = :ref WHERE id = :id"),
            {"ref": payload.consent_ref, "id": req["id"]},
        )
        return get_request(s, req["id"])

    s.execute(
        text("UPDATE transcript_request SET status = 'consented', consent_ref = :ref WHERE id = :id"),
        {"ref": payload.consent_ref, "id": req["id"]},
    )

    provider = s.execute(
        text("SELECT fhir_base_url, name, kind FROM provider WHERE id = :id"),
        {"id": req["from_provider_id"]},
    ).mappings().first()
    if not provider:
        raise LookupError(f"Provider {req['from_provider_id']} not found")
    source_system = provider.get("name") or provider["kind"]

    source_patient_ref = s.execute(
        text("""SELECT source_patient_ref FROM patient_identity
                WHERE patient_id = :pid AND source_system = :src AND active"""),
        {"pid": req["patient_id"], "src": source_system},
    ).scalar()
    adapter = HapiAdapter(provider_id=req["from_provider_id"], base_url=provider["fhir_base_url"])
    if not source_patient_ref:
        # First pull from this provider: find the patient there by name + birth date (spec 8 identity rule).
        pt = s.execute(text("SELECT given_name, family_name, birth_date FROM patient WHERE id = :id"),
                       {"id": req["patient_id"]}).mappings().one()
        matches = adapter.search_patient(pt["family_name"], pt["given_name"], pt["birth_date"])
        if not matches:
            raise LookupError(f"{provider['name']} has no record of this patient.")
        source_patient_ref = matches[0]["id"]

    # Spec 11 step 4: only resources newer than the last merge from this provider (nothing is re-requested).
    since = s.execute(
        text("""SELECT max(completed_at) FROM transcript_request WHERE patient_id = :pid
                AND from_provider_id = :prov AND status = 'merged'"""),
        {"pid": req["patient_id"], "prov": req["from_provider_id"]},
    ).scalar()
    bundle = adapter.fetch_everything(source_patient_ref, since=since)

    s.execute(text("UPDATE transcript_request SET status = 'fetched' WHERE id = :id"), {"id": req["id"]})

    landed_ids = land_bundle(s, source_system, bundle)
    counts = process_raw_records(s, source_system, landed_ids)
    total_imported = sum(counts.values())

    s.execute(
        text("""UPDATE transcript_request SET status = 'merged', resources_imported = :n,
                completed_at = now() WHERE id = :id"""),
        {"n": total_imported, "id": req["id"]},
    )
    # Step 7: the requesting physician reviews what arrived. Step 6's "what's new" is the summary's
    # new_from_sources, built from the merged rows (level 1 facts; see routes/patients.py).
    label = PROVIDER_LABELS.get(provider["name"], provider["name"]).split(" ")[0]
    create_task(s, req["requested_by"], req["patient_id"], "review_transcript", f"Review {label} records", req["id"])
    return get_request(s, req["id"])


def list_transcripts_for_patient(s: Session, p: Principal, patient_id: UUID) -> list[dict]:
    rel = s.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": p.user_id, "p": patient_id},
    ).scalar()
    if rel is None:
        raise PermissionError("You are not on this patient's care team.")
    rows = s.execute(text(_VIEW_SQL + " WHERE t.patient_id = :pid ORDER BY t.created_at DESC"),
                     {"pid": patient_id}).mappings().all()
    return [_view(r) for r in rows]