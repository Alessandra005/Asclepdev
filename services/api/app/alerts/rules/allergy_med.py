"""ALLERGY_MED (spec 12, SHOULD): an active MedicationRequest whose medication name matches a recorded allergy
substance (simple name match) -> critical, to the attending(s) and the requesting physician."""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attendings_for


def check(s: Session, object_id: UUID, patient_id: UUID | None, row: dict) -> list[AlertDraft]:
    """Runs for a new MedicationRequest or a new Allergy; either side can complete the match."""
    if patient_id is None:
        return []
    pairs = s.execute(text("""
        SELECT r.id AS med_id, a.id AS allergy_id, a.substance, COALESCE(m.name, r.dosage_text) AS med, r.requested_by
        FROM medication_request r LEFT JOIN medication m ON m.id = r.medication_id
        JOIN allergy a ON a.patient_id = r.patient_id AND a.record_status = 'current'
        WHERE r.patient_id = :p AND r.status = 'active' AND r.record_status = 'current'
          AND (r.id = :o OR a.id = :o)
          AND lower(COALESCE(m.name, r.dosage_text, '')) LIKE '%' || lower(trim(a.substance)) || '%'"""),
        {"p": patient_id, "o": object_id}).mappings().all()
    drafts = []
    for pr in pairs:
        recipients = set(_attendings_for(s, patient_id)) | ({pr["requested_by"]} if pr["requested_by"] else set())
        drafts += [AlertDraft("ALLERGY_MED", "critical", f"{pr['med']} ordered despite {pr['substance']} allergy",
                              patient_id=patient_id, user_id=uid, source_ids=[str(pr["med_id"]), str(pr["allergy_id"])])
                   for uid in recipients]
    return drafts
