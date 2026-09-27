"""FINDING_PENDING (spec §12): new Finding with status pending_review -> warning,
goes to attending."""
from uuid import UUID
from sqlalchemy.orm import Session
from app.alerts.engine import AlertDraft, _attending_for


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    if row.get("status") != "pending_review" or patient_id is None:
        return []
    attending = _attending_for(s, patient_id)
    if attending is None:
        return []
    return [AlertDraft(
        rule_id="FINDING_PENDING", severity="warning",
        title=f"Finding awaiting review: {row.get('label', 'pathology result')}",
        detail=f"Confidence {row.get('confidence')}",
        patient_id=patient_id, user_id=attending, source_ids=[str(object_id)],
    )]