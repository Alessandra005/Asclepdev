"""Transcript request routes (spec §11, §15). Responses are the desktop's TranscriptRequest / ConsentTask."""
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.ingest.transcript import (
    MergeTranscriptPayload,
    RequestTranscriptPayload,
    list_consent_tasks,
    list_transcripts_for_patient,
    resolve_provider_id,
)
from app.ontology.api import apply_action
from app.rbac.require import require

router = APIRouter(tags=["transcripts"])


class CreateTranscriptBody(BaseModel):
    from_provider_id: str  # provider UUID, or a short key such as "riverside"


class ConsentBody(BaseModel):
    consent_ref: str
    granted: bool


@router.post("/patients/{patient_id}/transcripts")
def create_transcript_request(
    patient_id: UUID, body: CreateTranscriptBody,
    p: Principal = Depends(require("request_transcripts", patient_param="patient_id",
                                   object_type="TranscriptRequest", action="create")),
    s=Depends(get_session),
):
    try:
        provider_id = resolve_provider_id(s, body.from_provider_id)
        return apply_action(s, p, "request_transcript",
                            RequestTranscriptPayload(patient_id=patient_id, from_provider_id=provider_id))
    except LookupError as exc:
        raise AsclepError("VALIDATION_ERROR", str(exc))
    except PermissionError as exc:
        raise AsclepError("FORBIDDEN", str(exc))


@router.get("/patients/{patient_id}/transcripts")
def list_patient_transcripts(
    patient_id: UUID,
    p: Principal = Depends(require("request_transcripts", patient_param="patient_id", object_type="TranscriptRequest")),
    s=Depends(get_session),
):
    try:
        return {"items": list_transcripts_for_patient(s, p, patient_id), "next_cursor": None}
    except PermissionError as exc:
        raise AsclepError("FORBIDDEN", str(exc))


@router.get("/admin/consent-tasks")
def consent_tasks(p: Principal = Depends(require("record_consent", object_type="TranscriptRequest")),
                  s=Depends(get_session)):
    """Spec 11 step 2's "task for the admin": the Admin tab's consent queue (docs/BACKEND_HANDOFF.md)."""
    return {"items": list_consent_tasks(s), "next_cursor": None}


@router.post("/transcripts/{transcript_request_id}/consent")
def consent_transcript_request(
    transcript_request_id: UUID, body: ConsentBody,
    p: Principal = Depends(require("record_consent", object_type="TranscriptRequest", action="sign")),
    s=Depends(get_session),
):
    if not body.consent_ref.strip():
        raise AsclepError("VALIDATION_ERROR", "A consent reference is required.")
    payload = MergeTranscriptPayload(
        transcript_request_id=transcript_request_id, consent_ref=body.consent_ref.strip(), granted=body.granted,
    )
    try:
        return apply_action(s, p, "merge_transcript", payload)
    except LookupError as exc:
        raise AsclepError("NOT_FOUND", str(exc))
    except ValueError as exc:  # already decided
        raise AsclepError("CONFLICT", str(exc))
    except (OSError, RuntimeError) as exc:  # the source EHR is down or refused the pull; nothing was committed
        raise AsclepError("UPSTREAM_UNAVAILABLE", "The source EHR did not respond. Try again.") from exc
