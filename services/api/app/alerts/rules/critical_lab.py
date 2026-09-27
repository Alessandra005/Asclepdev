"""CRITICAL_LAB (spec §12): Observation with interpretation HH or LL -> critical,
goes to patient's attending + nurses on care team."""
from uuid import UUID

from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attending_and_nurses_for


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    if row.get("interpretation") not in ("HH", "LL"):
        return []
    if patient_id is None:
        return []
    drafts = []
    for user_id in _attending_and_nurses_for(s, patient_id):
        drafts.append(AlertDraft(
            rule_id="CRITICAL_LAB", severity="critical",
            title=f"Critical result: {row.get('display', 'lab value')}",
            detail=f"{row.get('display')} = {row.get('value_num') or row.get('value_text')} ({row.get('interpretation')})",
            patient_id=patient_id, user_id=user_id, source_ids=[str(object_id)],
        ))
    return drafts