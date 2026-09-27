"""Audit view, admin (roles, care teams, ingest) and break-the-glass (spec 13, 15). Owner: Ron."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import text

from app.alerts.engine import AlertDraft, raise_alert
from app.audit.log import write_audit
from app.auth.principal import Principal
from app.db import get_session
from app.ehr.hapi import HapiAdapter
from app.errors import AsclepError
from app.ingest.pipeline import IngestBundleRequest
from app.ontology.api import apply_action
from app.rbac.permissions import PERMISSIONS, ROLES, scope_for
from app.rbac.require import relationship, require

router = APIRouter(tags=["admin"])

AI_NAMES = {"resident": "Resident", "lab_tech": "Lab Technician", "scribe": "Scribe"}
EMERGENCY_MINUTES = 60


@router.get("/audit")
def audit(user_id: UUID | None = None, patient_id: UUID | None = None, action: str | None = None,
          from_: datetime | None = Query(None, alias="from"), to: datetime | None = None, cursor: int | None = None,
          p: Principal = Depends(require("view_audit")), s=Depends(get_session)):
    """Admin sees every row; everyone else sees rows they did, or that an AI step did for them (spec 13)."""
    own = scope_for("view_audit", p.role) == "own"
    rows = s.execute(text("""
        SELECT l.*, u.full_name AS actor, b.full_name AS behalf, pt.given_name || ' ' || pt.family_name AS patient
        FROM audit_log l LEFT JOIN app_user u ON u.id = l.actor_user_id
        LEFT JOIN app_user b ON b.id = l.on_behalf_of_user_id LEFT JOIN patient pt ON pt.id = l.patient_id
        WHERE (NOT :own OR l.actor_user_id = :me OR l.on_behalf_of_user_id = :me)
          AND (CAST(:uid AS uuid) IS NULL OR l.actor_user_id = CAST(:uid AS uuid))
          AND (CAST(:pid AS uuid) IS NULL OR l.patient_id = CAST(:pid AS uuid))
          AND (CAST(:act AS text) IS NULL OR l.action = :act)
          AND (CAST(:frm AS timestamptz) IS NULL OR l.at >= CAST(:frm AS timestamptz))
          AND (CAST(:to AS timestamptz) IS NULL OR l.at <= CAST(:to AS timestamptz))
          AND (CAST(:cur AS bigint) IS NULL OR l.id < CAST(:cur AS bigint))
        ORDER BY l.id DESC LIMIT 201"""),
        {"own": own, "me": p.user_id, "uid": user_id, "pid": patient_id, "act": action, "frm": from_, "to": to,
         "cur": cursor}).mappings().all()
    items = [{
        "id": str(r["id"]), "at": r["at"],
        "actor_name": AI_NAMES.get(r["actor_kind"]) or r["actor"] or "Asclep (system)",
        "actor_kind": r["actor_kind"] if r["actor_kind"] in AI_NAMES else "user",
        "on_behalf_of": r["behalf"], "action": r["action"], "object_type": r["object_type"],
        "patient_name": r["patient"], "allowed": r["action"] != "deny", "ran_on": r["ran_on"],
    } for r in rows[:200]]
    return {"items": items, "next_cursor": str(rows[199]["id"]) if len(rows) > 200 else None}


@router.get("/admin/roles")
def roles(p: Principal = Depends(require("manage_users"))):
    """The role permission matrix (spec 13 step 1). SPEC-QUESTION(Ron): editing it live (PUT) is a SHOULD."""
    return {"roles": list(ROLES), "permissions": {perm: {r: scopes.get(r) for r in ROLES}
                                                  for perm, scopes in PERMISSIONS.items()}}


class CareTeamChange(BaseModel):
    patient_id: UUID
    user_id: UUID
    relationship: Literal["attending", "consulting", "nursing", "nurse"] | None  # null removes the member


@router.get("/admin/care-teams")
def care_teams(p: Principal = Depends(require("manage_users")), s=Depends(get_session)):
    rows = s.execute(text("""
        SELECT c.patient_id, c.user_id, c.relationship, pt.given_name || ' ' || pt.family_name AS patient_name,
               pt.mrn AS patient_mrn, u.full_name AS user_name, u.role
        FROM care_team_member c JOIN patient pt ON pt.id = c.patient_id JOIN app_user u ON u.id = c.user_id
        ORDER BY patient_name, u.full_name""")).mappings().all()
    return {"items": [dict(r) for r in rows], "next_cursor": None}


@router.put("/admin/care-teams")
def set_care_team(body: CareTeamChange, request: Request,
                  p: Principal = Depends(require("manage_users", object_type="CareTeamMember", action="update")),
                  s=Depends(get_session)):
    """Assign or remove one care-team member. Admins manage access; they never gain clinical access themselves."""
    role = s.execute(text("SELECT role FROM app_user WHERE id = :u"), {"u": body.user_id}).scalar()
    if role is None:
        raise AsclepError("NOT_FOUND", "User not found.")
    if role == "admin":
        raise AsclepError("VALIDATION_ERROR", "Admins cannot join a care team (separation of duties, spec 13).")
    if body.relationship is None:
        s.execute(text("DELETE FROM care_team_member WHERE patient_id = :p AND user_id = :u"),
                  {"p": body.patient_id, "u": body.user_id})
    else:
        s.execute(text("""INSERT INTO care_team_member (patient_id, user_id, relationship) VALUES (:p, :u, :r)
                          ON CONFLICT (patient_id, user_id) DO UPDATE SET relationship = EXCLUDED.relationship"""),
                  {"p": body.patient_id, "u": body.user_id, "r": body.relationship})
    write_audit(s, p, "update", "CareTeamMember", body.user_id, body.patient_id, request_id=request.state.request_id)
    return {"patient_id": body.patient_id, "user_id": body.user_id, "relationship": body.relationship}


class IngestBody(BaseModel):
    provider_id: UUID


@router.post("/admin/ingest")
def ingest(body: IngestBody, p: Principal = Depends(require("manage_users", object_type="Provider", action="create")),
           s=Depends(get_session)):
    """Pull every patient a provider's EHR holds through the ingestion pipeline; returns the job summary."""
    url = s.execute(text("SELECT fhir_base_url FROM provider WHERE id = :id"), {"id": body.provider_id}).scalar()
    if url is None:
        raise AsclepError("NOT_FOUND", "Provider not found.")
    try:
        patients = HapiAdapter(body.provider_id, url).list_patient_ids()
        results = {pid: apply_action(s, p, "ingest_bundle", IngestBundleRequest(provider_id=body.provider_id,
                                                                               fhir_patient_id=pid))
                   for pid in patients}
    except (OSError, RuntimeError) as exc:
        raise AsclepError("UPSTREAM_UNAVAILABLE", "The EHR did not respond. Try again.") from exc
    return {"patients": len(results), "landed": sum(r["landed"] for r in results.values()), "results": results}


class EmergencyBody(BaseModel):
    reason: str


@router.post("/patients/{patient_id}/emergency-access")
def emergency_access(patient_id: UUID, body: EmergencyBody, request: Request,
                     p: Principal = Depends(require("emergency_access")), s=Depends(get_session)):
    """Break-the-glass (spec 13): a reason, 60 minutes of care-team read access, and a critical alert to admins."""
    reason = body.reason.strip()
    if len(reason) < 5:
        raise AsclepError("VALIDATION_ERROR", "Type the clinical reason for emergency access.")
    if not s.execute(text("SELECT 1 FROM patient WHERE id = :id"), {"id": patient_id}).first():
        raise AsclepError("NOT_FOUND", "Patient not found.")
    if relationship(s, p.user_id, patient_id) not in (None, "emergency"):
        raise AsclepError("CONFLICT", "You are already on this patient's care team.")
    expires = datetime.now(timezone.utc) + timedelta(minutes=EMERGENCY_MINUTES)
    grant = s.execute(text("""INSERT INTO emergency_access (user_id, patient_id, reason, expires_at)
                              VALUES (:u, :p, :r, :e) RETURNING id"""),
                      {"u": p.user_id, "p": patient_id, "r": reason, "e": expires}).scalar()
    who = s.execute(text("SELECT full_name FROM app_user WHERE id = :u"), {"u": p.user_id}).scalar()
    for admin in s.execute(text("SELECT id FROM app_user WHERE role = 'admin' AND active")).scalars():
        raise_alert(s, AlertDraft("EMERGENCY_ACCESS", "critical", f"Emergency access by {who}", detail=reason,
                                  patient_id=patient_id, user_id=admin, source_ids=[str(grant)]), grant)
    write_audit(s, p, "read", "EmergencyAccess", grant, patient_id, reason=reason, request_id=request.state.request_id)
    return {"expires_at": expires}
