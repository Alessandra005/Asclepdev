"""FINDING_PENDING (spec §12): new Finding with status pending_review -> warning,
goes to attending."""
from uuid import UUID

from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attendings_for


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    if row.get("status") != "pending_review" or patient_id is None:
        return []
    # Every attending, like the review_finding task: any of them may sign it off.
    return [AlertDraft(
        rule_id="FINDING_PENDING", severity="warning",
        title="Biopsy finding awaiting review",
        detail=f"Confidence {row.get('confidence')}",
        patient_id=patient_id, user_id=uid, source_ids=[str(object_id)],
    ) for uid in _attendings_for(s, patient_id)]
