"""Alert rule engine (spec section 12). Owner: Alessandra."""
import json
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class AlertDraft:
    rule_id: str
    severity: str
    title: str
    detail: str | None = None
    patient_id: UUID | None = None
    user_id: UUID | None = None
    source_ids: list[str] = field(default_factory=list)


def _already_fired(s: Session, rule_id: str, patient_id: UUID | None, user_id: UUID | None,
                  triggering_object_id: UUID) -> bool:
    """Dedupe key = (rule_id, patient_id, triggering object id). Never raise the same
    alert twice. SPEC-QUESTION(Ron): enforced here at the app layer via source_ids
    containment check; a DB-level unique index would be safer but needs a migration."""
    return s.execute(
        text("""SELECT 1 FROM alert WHERE rule_id = :rid
                AND (patient_id = :pid OR (:pid IS NULL AND patient_id IS NULL))
                AND user_id IS NOT DISTINCT FROM :uid
                AND source_ids @> CAST(:src AS jsonb)"""),
        # One row per recipient (spec 12: attending + nurses), so the recipient is part of the dedupe key.
        {"rid": rule_id, "pid": patient_id, "uid": user_id, "src": json.dumps([str(triggering_object_id)])},
    ).first() is not None


def raise_alert(s: Session, draft: AlertDraft, triggering_object_id: UUID) -> UUID | None:
    if _already_fired(s, draft.rule_id, draft.patient_id, draft.user_id, triggering_object_id):
        return None
    source_ids = [str(x) for x in draft.source_ids] or [str(triggering_object_id)]
    alert_id = s.execute(
        text("""INSERT INTO alert (patient_id, user_id, rule_id, severity, title, detail, source_ids)
                VALUES (:pid, :uid, :rid, :sev, :title, :detail, CAST(:src AS jsonb)) RETURNING id"""),
        {"pid": draft.patient_id, "uid": draft.user_id, "rid": draft.rule_id,
         "sev": draft.severity, "title": draft.title, "detail": draft.detail,
         "src": json.dumps(source_ids)},
    ).scalar()
    return alert_id


def _attending_and_nurses_for(s: Session, patient_id: UUID) -> list[UUID]:
    rows = s.execute(
        text("""SELECT user_id FROM care_team_member ctm
                JOIN app_user u ON u.id = ctm.user_id
                WHERE ctm.patient_id = :pid AND (ctm.relationship = 'attending' OR u.role = 'nurse')"""),
        {"pid": patient_id},
    ).scalars().all()
    return list(rows)


def _attendings_for(s: Session, patient_id: UUID) -> list[UUID]:
    return list(s.execute(
        text("SELECT user_id FROM care_team_member WHERE patient_id = :pid AND relationship = 'attending'"),
        {"pid": patient_id},
    ).scalars().all())


def _attending_for(s: Session, patient_id: UUID) -> UUID | None:
    return s.execute(
        text("""SELECT user_id FROM care_team_member WHERE patient_id = :pid AND relationship = 'attending'"""),
        {"pid": patient_id},
    ).scalar()


def evaluate_object(s: Session, object_type: str, object_id: UUID, patient_id: UUID | None, row: dict) -> list[UUID]:
    """Run every applicable rule against one newly-written object (the in-process
    hook per spec §12: 'Rules run after every ontology write')."""
    from app.alerts.rules import allergy_med, critical_lab, finding_pending, med_backorder

    raised: list[UUID] = []
    dispatch = {
        "Observation": [critical_lab.check],
        "Finding": [finding_pending.check],
        "MedicationRequest": [med_backorder.check, allergy_med.check],
        "Allergy": [allergy_med.check],
        # SOURCE_CONFLICT is per patient, raised by ingestion's link stage (app.ingest.pipeline)
    }
    for rule_fn in dispatch.get(object_type, []):
        for draft in rule_fn(s, object_id, patient_id, row) or []:
            alert_id = raise_alert(s, draft, object_id)
            if alert_id:
                raised.append(alert_id)
    return raised

def sweep_all(s: Session) -> list[UUID]:
    """Periodic re-evaluation (spec §12: 'on a 60-second sweep'). Catches objects
    written before their notification target (e.g. care team) existed. Reuses
    raise_alert's dedup, so already-fired alerts are never duplicated."""
    from app.alerts.rules import allergy_med, critical_lab, finding_pending, med_backorder

    raised: list[UUID] = []

    rows = s.execute(text("""SELECT id, patient_id, display, value_num, value_text, unit, interpretation
                              FROM observation WHERE interpretation IN ('HH', 'LL')""")).mappings().all()
    for r in rows:
        for draft in critical_lab.check(s, r["id"], r["patient_id"], dict(r)) or []:
            alert_id = raise_alert(s, draft, r["id"])
            if alert_id:
                raised.append(alert_id)

    rows = s.execute(text("""SELECT id, patient_id, status, medication_id, requested_by
                              FROM medication_request WHERE status = 'active'""")).mappings().all()
    for r in rows:
        for draft in (med_backorder.check(s, r["id"], r["patient_id"], dict(r)) or []) + \
                allergy_med.check(s, r["id"], r["patient_id"], dict(r)):
            alert_id = raise_alert(s, draft, r["id"])
            if alert_id:
                raised.append(alert_id)

    rows = s.execute(text("""SELECT id, patient_id, status, label, confidence
                              FROM finding WHERE status = 'pending_review'""")).mappings().all()
    for r in rows:
        for draft in finding_pending.check(s, r["id"], r["patient_id"], dict(r)) or []:
            alert_id = raise_alert(s, draft, r["id"])
            if alert_id:
                raised.append(alert_id)

    return raised