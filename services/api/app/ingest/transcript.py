"""Transcript request/consent flow (spec §11, §13). Owner: Alessandra."""
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.ehr.hapi import HapiAdapter
from app.ingest.pipeline import land_bundle, process_raw_records


class RequestTranscriptPayload(BaseModel):
    """Matches spec §15 route table: POST /patients/{id}/transcripts {from_provider_id}."""
    patient_id: UUID
    from_provider_id: UUID


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
    # SPEC-QUESTION(Ron): §11 step 2 says "a task for the admin" gets created here too
    # (task.kind='review_transcript' per the task table's kind comment) — not wired
    # in yet since app/tasks/ doesn't exist. Flagging so it's not silently dropped.
    return {"transcript_request_id": request_id, "status": "requested"}


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
        return {"transcript_request_id": req["id"], "status": "denied"}

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
    if not source_patient_ref:
        raise LookupError(
            f"No known identity link for this patient at {provider['name']} yet. "
            f"Nothing to pull a transcript from."
        )

    # SPEC-QUESTION(Ron): §11 step 4 says the pull should be filtered to resources
    # newer than the last merged request from this provider (incremental). Doing a
    # full $everything fetch instead for MVP — raw_record's payload-hash dedup means
    # nothing gets duplicated downstream, so this is a performance simplification,
    # not a correctness gap.
    adapter = HapiAdapter(provider_id=req["from_provider_id"], base_url=provider["fhir_base_url"])
    bundle = adapter.fetch_everything(source_patient_ref)

    s.execute(text("UPDATE transcript_request SET status = 'fetched' WHERE id = :id"), {"id": req["id"]})

    landed_ids = land_bundle(s, source_system, bundle)
    counts = process_raw_records(s, source_system, landed_ids)
    total_imported = sum(counts.values())

    s.execute(
        text("""UPDATE transcript_request SET status = 'merged', resources_imported = :n,
                completed_at = now() WHERE id = :id"""),
        {"n": total_imported, "id": req["id"]},
    )
    # SPEC-QUESTION(Ron): §11 step 6 says the Resident generates a "What's new from
    # Dr. One" summary here, and step 7 creates a review_transcript task for the
    # requesting physician. Neither is wired in — Resident integration and app/tasks/
    # are outside this workstream's current scope.
    return {"transcript_request_id": req["id"], "status": "merged",
            "resources_imported": total_imported, "processed": counts}


def list_transcripts_for_patient(s: Session, p: Principal, patient_id: UUID) -> list[dict]:
    rel = s.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": p.user_id, "p": patient_id},
    ).scalar()
    if rel is None:
        raise PermissionError("You are not on this patient's care team.")
    rows = s.execute(
        text("SELECT * FROM transcript_request WHERE patient_id = :pid ORDER BY created_at DESC"),
        {"pid": patient_id},
    ).mappings().all()
    return [dict(r) for r in rows]