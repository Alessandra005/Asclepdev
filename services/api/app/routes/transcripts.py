"""Transcript request routes (spec §11, §15)."""
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.ingest.transcript import (
    MergeTranscriptPayload,
    RequestTranscriptPayload,
    list_transcripts_for_patient,
)
from app.ontology.api import apply_action
from app.rbac.require import require

router = APIRouter(tags=["transcripts"])


class CreateTranscriptBody(BaseModel):
    from_provider_id: UUID


class ConsentBody(BaseModel):
    consent_ref: str
    granted: bool


@router.post("/patients/{patient_id}/transcripts")
def create_transcript_request(
    patient_id: UUID, body: CreateTranscriptBody,
    p: Principal = Depends(require("request_transcripts", patient_param="patient_id", object_type="TranscriptRequest")),
    s=Depends(get_session),
):
    payload = RequestTranscriptPayload(patient_id=patient_id, from_provider_id=body.from_provider_id)
    try:
        return apply_action(s, p, "request_transcript", payload)
    except PermissionError as exc:
        raise AsclepError("FORBIDDEN", str(exc))


@router.get("/patients/{patient_id}/transcripts")
def list_patient_transcripts(
    patient_id: UUID,
    p: Principal = Depends(require("request_transcripts", patient_param="patient_id", object_type="TranscriptRequest")),
    s=Depends(get_session),
):
    try:
        return {"items": list_transcripts_for_patient(s, p, patient_id)}
    except PermissionError as exc:
        raise AsclepError("FORBIDDEN", str(exc))


@router.post("/transcripts/{transcript_request_id}/consent")
def consent_transcript_request(
    transcript_request_id: UUID, body: ConsentBody,
    p: Principal = Depends(require("record_consent", object_type="TranscriptRequest")),
    s=Depends(get_session),
):
    payload = MergeTranscriptPayload(
        transcript_request_id=transcript_request_id, consent_ref=body.consent_ref, granted=body.granted,
    )
    try:
        return apply_action(s, p, "merge_transcript", payload)
    except LookupError as exc:
        raise AsclepError("NOT_FOUND", str(exc))
    except ValueError as exc:
        raise AsclepError("BAD_REQUEST", str(exc))