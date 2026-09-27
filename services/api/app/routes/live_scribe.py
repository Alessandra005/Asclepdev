"""LiveScribing routes: visual + conversational scribing stored in MongoDB. Owner: Brandon.

SPEC-QUESTION(Ron, Alessandra): new routes, not yet in spec 15. They sit under /patients/{patient_id} so
require() enforces the care team and writes the audit row, like every other route.

Flow: start (patient info copied to Mongo) -> window every 10 s (frames + audio -> Resident -> transcript and
observations appended) -> stop (Resident flags actions = possible symptoms) -> the attending checks which
actions go in the report -> report draft -> accept / edit / discard. Nothing AI-made is final until then.
"""
import re
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.config import settings
from app.db import get_session
from app.errors import AsclepError
from app.live_scribe.store import LiveScribeStore, get_store, mongo_errors, patient_document
from app.rbac.permissions import scope_for
from app.rbac.require import require
from asclep_contracts import LiveScribeReviewResult, LiveScribeWindowResult

router = APIRouter(tags=["live-scribe"])

BASE = "/patients/{patient_id}/live-scribe-sessions"
RESIDENT_TIMEOUT = 180.0  # the local VLM is slow on a laptop GPU
CLOCK = re.compile(r"^\d{2}:\d{2}:\d{2}$")


class StartRequest(BaseModel):
    consent_ref: str


class ReportRequest(BaseModel):
    included_action_ids: list[str]


class ReviewRequest(BaseModel):
    action: Literal["accept", "edit", "discard"]
    body: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _clock(secs: float) -> str:
    s = max(0, int(secs))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _user_name(session: Session, user_id: UUID) -> str | None:
    return session.execute(text("SELECT full_name FROM app_user WHERE id = :u"), {"u": str(user_id)}).scalar()


def _resident(path: str, **kwargs: Any) -> dict[str, Any]:
    try:
        r = httpx.post(f"{settings.resident_url}{path}", timeout=RESIDENT_TIMEOUT, **kwargs)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise AsclepError("UPSTREAM_UNAVAILABLE", "The Scribe model is not responding. Try again.") from exc
    return r.json()


def _load(store: LiveScribeStore, patient_id: UUID, session_id: UUID, p: Principal,
          permission: str = "start_scribe") -> dict[str, Any]:
    with mongo_errors():
        doc = store.get_session(str(session_id))
    if not doc or doc["patient_id"] != str(patient_id):
        raise AsclepError("NOT_FOUND", "LiveScribing session not found.")
    if scope_for(permission, p.role) == "own" and doc["started_by"] != str(p.user_id):
        raise AsclepError("NOT_FOUND", "LiveScribing session not found.")
    return doc


def _view(doc: dict[str, Any], full: bool = True) -> dict[str, Any]:
    out = {
        "id": doc["_id"],
        "patient_id": doc["patient_id"],
        "patient": doc["patient"],
        "consent_ref": doc["consent_ref"],
        "started_by_name": doc.get("started_by_name"),
        "started_at": doc["started_at"],
        "ended_at": doc.get("ended_at"),
        "end_reason": doc.get("end_reason"),
        "status": doc["status"],
        "windows_analyzed": doc.get("windows_analyzed", 0),
        "summary": doc.get("summary"),
        "counts": {k: len(doc.get(k, [])) for k in ("observations", "transcript", "actions")},
    }
    if full:
        out |= {k: doc.get(k, []) for k in ("observations", "transcript", "actions")}
        out["report"] = doc.get("report")
    return out


def _report_body(doc: dict[str, Any], actions: list[dict[str, Any]], reviewer: str) -> str:
    pt, started, ended = doc["patient"], doc["started_at"], doc.get("ended_at")
    duration = _clock((ended - started).total_seconds()) if ended else "unknown"
    picked = [a for a in actions if a["included"]]
    lines = [
        "Visit scribing report (LiveScribing)",
        f"Patient: {pt['name']}, MRN {pt['mrn']}",
        f"Visit: {started:%Y-%m-%d %H:%M} UTC, duration {duration}, {doc.get('windows_analyzed', 0)} windows, "
        f"consent {doc['consent_ref']}",
        "",
        f"Possible symptoms (selected by {reviewer})",
        *([f"- {a['action']} [{', '.join(a['times'])}] ({a['source']}, {a['confidence']} confidence)"
           for a in picked] or ["- None selected."]),
        "",
        "Visit summary (AI draft)",
        f"- {doc.get('summary') or 'No summary.'}",
        "",
        "Conversation",
        f"- {len(doc.get('transcript', []))} transcript lines are stored with LiveScribing session {doc['_id']}.",
    ]
    return "\n".join(lines)


@router.post(BASE)
def start_session(
    patient_id: UUID,
    body: StartRequest,
    p: Principal = Depends(require("start_scribe", patient_param="patient_id", object_type="ScribeSession",
                                   action="create")),
    session: Session = Depends(get_session),
    store: LiveScribeStore = Depends(get_store),
):
    if not body.consent_ref.strip():
        raise AsclepError("VALIDATION_ERROR", "consent_ref is required to start LiveScribing.")
    row = session.execute(
        text("SELECT id, mrn, given_name, family_name, birth_date, sex, source_system FROM patient WHERE id = :p"),
        {"p": str(patient_id)},
    ).mappings().first()
    if not row:
        raise AsclepError("NOT_FOUND", "Patient not found.")
    patient = patient_document(dict(row))
    doc = {
        "_id": str(uuid4()),
        "patient_id": str(patient_id),
        "patient": {"id": patient["_id"], **{k: patient[k] for k in ("mrn", "name", "birth_date", "sex")}},
        "consent_ref": body.consent_ref.strip(),
        "started_by": str(p.user_id),
        "started_by_name": _user_name(session, p.user_id),
        "started_at": _now(),
        "ended_at": None,
        "end_reason": None,
        "status": "active",
        "windows_analyzed": 0,
        "observations": [],
        "transcript": [],
        "actions": [],
        "summary": None,
        "report": None,
    }
    with mongo_errors():
        store.upsert_patient(patient)  # keep the Mongo copy of the patient current
        store.create_session(doc)
    return _view(doc)


@router.post(BASE + "/{session_id}/window")
def add_window(
    patient_id: UUID,
    session_id: UUID,
    window_start: str = Form(...),
    window_end: str = Form(...),
    frame_times: str | None = Form(None),
    frames: list[UploadFile] | None = File(None),
    audio: UploadFile | None = File(None),
    p: Principal = Depends(require("start_scribe", patient_param="patient_id", object_type="ScribeSession",
                                   action="update")),
    store: LiveScribeStore = Depends(get_store),
):
    if not (CLOCK.match(window_start) and CLOCK.match(window_end)):
        raise AsclepError("VALIDATION_ERROR", "window_start and window_end must be HH:MM:SS.")
    doc = _load(store, patient_id, session_id, p)
    if doc["status"] != "active":
        raise AsclepError("CONFLICT", "This LiveScribing session has ended.")
    # PRIVACY: frames and audio pass through in memory to the Resident; never stored or logged here.
    files = [("frames", (f"f{i}.jpg", f.file.read(), "image/jpeg")) for i, f in enumerate(frames or [])]
    if audio:
        files.append(("audio", ("audio.webm", audio.file.read(), audio.content_type or "audio/webm")))
    data = {"session_id": str(session_id), "window_start": window_start, "window_end": window_end}
    if frame_times:
        data["frame_times"] = frame_times
    result = LiveScribeWindowResult.model_validate(_resident("/live-scribe/window", data=data, files=files or None))
    del files
    with mongo_errors():
        store.append_window(str(session_id), [o.model_dump() for o in result.observations],
                            [s.model_dump() for s in result.transcript])
    return result.model_dump()


@router.post(BASE + "/{session_id}/stop")
def stop_session(
    patient_id: UUID,
    session_id: UUID,
    p: Principal = Depends(require("start_scribe", patient_param="patient_id", object_type="ScribeSession",
                                   action="update")),
    store: LiveScribeStore = Depends(get_store),
):
    doc = _load(store, patient_id, session_id, p)
    if doc["status"] != "active":
        raise AsclepError("CONFLICT", "This LiveScribing session has already stopped.")
    review = LiveScribeReviewResult.model_validate(_resident("/live-scribe/review", json={
        "session_id": str(session_id), "observations": doc["observations"], "transcript": doc["transcript"],
    }))
    fields = {
        "status": "review",
        "ended_at": _now(),
        "end_reason": "stopped",
        # Every action starts unchecked: the doctor decides what goes into the report.
        "actions": [{**a.model_dump(), "included": False} for a in review.actions],
        "summary": review.summary,
    }
    with mongo_errors():
        store.update_session(str(session_id), fields)
    return _view(doc | fields)


@router.get(BASE)
def list_sessions(
    patient_id: UUID,
    p: Principal = Depends(require("view_notes", patient_param="patient_id", object_type="ScribeSession")),
    store: LiveScribeStore = Depends(get_store),
):
    with mongo_errors():
        docs = store.list_sessions(str(patient_id))
    if scope_for("view_notes", p.role) == "own":
        docs = [d for d in docs if d["started_by"] == str(p.user_id)]
    return {"items": [_view(d, full=False) for d in docs], "next_cursor": None}


@router.get(BASE + "/{session_id}")
def get_session_detail(
    patient_id: UUID,
    session_id: UUID,
    p: Principal = Depends(require("view_notes", patient_param="patient_id", object_type="ScribeSession")),
    store: LiveScribeStore = Depends(get_store),
):
    return _view(_load(store, patient_id, session_id, p, permission="view_notes"))


@router.post(BASE + "/{session_id}/report")
def build_report(
    patient_id: UUID,
    session_id: UUID,
    body: ReportRequest,
    p: Principal = Depends(require("review_scribe", patient_param="patient_id", object_type="ScribeSession",
                                   action="update")),
    session: Session = Depends(get_session),
    store: LiveScribeStore = Depends(get_store),
):
    doc = _load(store, patient_id, session_id, p, permission="review_scribe")
    if doc["status"] not in ("review", "report_draft"):
        raise AsclepError("CONFLICT", "The report can only be built after LiveScribing stops and before sign-off.")
    chosen = set(body.included_action_ids)
    unknown = chosen - {a["id"] for a in doc["actions"]}
    if unknown:
        raise AsclepError("VALIDATION_ERROR", f"Unknown action ids: {', '.join(sorted(unknown))}.")
    actions = [{**a, "included": a["id"] in chosen} for a in doc["actions"]]
    reviewer = _user_name(session, p.user_id) or "the reviewing physician"
    report = {
        "body": _report_body(doc, actions, reviewer),
        "included_action_ids": [a["id"] for a in actions if a["included"]],
        "status": "draft",
        "drafted_by_name": reviewer,
        "drafted_at": _now(),
        "reviewed_by_name": None,
        "reviewed_at": None,
    }
    fields = {"actions": actions, "report": report, "status": "report_draft"}
    with mongo_errors():
        store.update_session(str(session_id), fields)
    return _view(doc | fields)


@router.post(BASE + "/{session_id}/review")
def review_report(
    patient_id: UUID,
    session_id: UUID,
    body: ReviewRequest,
    p: Principal = Depends(require("review_scribe", patient_param="patient_id", object_type="ScribeSession",
                                   action="sign")),
    session: Session = Depends(get_session),
    store: LiveScribeStore = Depends(get_store),
):
    doc = _load(store, patient_id, session_id, p, permission="review_scribe")
    if doc["status"] != "report_draft":
        raise AsclepError("CONFLICT", "There is no report draft to review.")
    if body.action == "edit" and not (body.body or "").strip():
        raise AsclepError("VALIDATION_ERROR", "An edited report needs a body.")
    discard = body.action == "discard"
    report = doc["report"] | {
        "body": body.body.strip() if body.action == "edit" else doc["report"]["body"],
        "status": "discarded" if discard else "final",
        "review_action": body.action,
        "reviewed_by_name": _user_name(session, p.user_id) or "the reviewing physician",
        "reviewed_at": _now(),
    }
    fields = {"report": report, "status": "discarded" if discard else "accepted"}
    with mongo_errors():
        store.update_session(str(session_id), fields)
    return _view(doc | fields)
