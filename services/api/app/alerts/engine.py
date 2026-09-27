"""Alert rule engine (spec section 12). Owner: Alessandra."""
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class AlertDraft:
    rule_id: str
    severity: str  # critical | warning | info
    title: str
    detail: str | None = None
    patient_id: UUID | None = None
    user_id: UUID | None = None
    source_ids: list[str] = field(default_factory=list)


def _already_fired(s: Session, rule_id: str, patient_id: UUID | None, triggering_object_id: UUID) -> bool:
    """Dedupe key = (rule_id, patient_id, triggering object id). Never raise the same
    alert twice. SPEC-QUESTION(Ron): enforced here at the app layer via source_ids
    containment check; a DB-level unique index would be safer but needs a migration."""
    return s.execute(
        text("""SELECT 1 FROM alert WHERE rule_id = :rid
                AND (patient_id = :pid OR (:pid IS NULL AND patient_id IS NULL))
                AND source_ids @> :src"""),
        {"rid": rule_id, "pid": patient_id, "src": f'["{triggering_object_id}"]'},
    ).first() is not None


def raise_alert(s: Session, draft: AlertDraft, triggering_object_id: UUID) -> UUID | None:
    if _already_fired(s, draft.rule_id, draft.patient_id, triggering_object_id):
        return None
    alert_id = s.execute(
        text("""INSERT INTO alert (patient_id, user_id, rule_id, severity, title, detail, source_ids)
                VALUES (:pid, :uid, :rid, :sev, :title, :detail, :src) RETURNING id"""),
        {"pid": draft.patient_id, "uid": draft.user_id, "rid": draft.rule_id,
         "sev": draft.severity, "title": draft.title, "detail": draft.detail,
         "src": [str(x) for x in draft.source_ids] or [str(triggering_object_id)]},
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


def _attending_for(s: Session, patient_id: UUID) -> UUID | None:
    return s.execute(
        text("""SELECT user_id FROM care_team_member WHERE patient_id = :pid AND relationship = 'attending'"""),
        {"pid": patient_id},
    ).scalar()


def evaluate_object(s: Session, object_type: str, object_id: UUID, patient_id: UUID | None, row: dict) -> list[UUID]:
    """Run every applicable rule against one newly-written object (the in-process
    hook per spec §12: 'Rules run after every ontology write')."""
    from app.alerts.rules import critical_lab, finding_pending, med_backorder

    raised: list[UUID] = []
    dispatch = {
        "Observation": [critical_lab.check],
        "Finding": [finding_pending.check],
        "MedicationRequest": [med_backorder.check],
        # "Allergy": [allergy_med.check, source_conflict.check],
        # "Condition": [source_conflict.check],
    }
    for rule_fn in dispatch.get(object_type, []):
        for draft in rule_fn(s, object_id, patient_id, row) or []:
            alert_id = raise_alert(s, draft, object_id)
            if alert_id:
                raised.append(alert_id)
    return raised