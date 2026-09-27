"""MED_BACKORDER (spec §12): active MedicationRequest whose inventory item is
backordered or on_hand = 0 -> warning, goes to requesting physician."""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attendings_for


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    if row.get("status") != "active" or row.get("medication_id") is None:
        return []
    inv = s.execute(
        text("SELECT on_hand, backordered FROM inventory_item WHERE medication_id = :mid"),
        {"mid": row["medication_id"]},
    ).mappings().first()
    if inv is None or not (inv["backordered"] or inv["on_hand"] == 0):
        return []
    requester = row.get("requested_by")
    # Ingested orders often carry no Asclep requester (golden fixtures don't): tell the attending(s) instead.
    recipients = [requester] if requester else (_attendings_for(s, patient_id) if patient_id else [])
    return [AlertDraft(
        rule_id="MED_BACKORDER", severity="warning",
        title="Medication backordered",
        detail=f"Requested medication is {'backordered' if inv['backordered'] else 'out of stock'}.",
        patient_id=patient_id, user_id=uid, source_ids=[str(object_id)],
    ) for uid in recipients]