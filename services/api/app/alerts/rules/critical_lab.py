"""CRITICAL_LAB (spec §12): Observation with interpretation HH or LL -> critical,
goes to patient's attending + nurses on care team."""
from uuid import UUID

from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attending_and_nurses_for


def _value(row: dict) -> str:
    value = row.get("value_num") if row.get("value_num") is not None else row.get("value_text")
    return f"{value} {row.get('unit') or ''}".strip()


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    if row.get("interpretation") not in ("HH", "LL"):
        return []
    if patient_id is None:
        return []
    drafts = []
    for user_id in _attending_and_nurses_for(s, patient_id):
        drafts.append(AlertDraft(
            rule_id="CRITICAL_LAB", severity="critical",
            title=f"{row.get('display', 'Lab value')} {_value(row)} (critical)",
            detail=f"{row.get('display')} = {_value(row)} ({row.get('interpretation')})",
            patient_id=patient_id, user_id=user_id, source_ids=[str(object_id)],
        ))
    return drafts