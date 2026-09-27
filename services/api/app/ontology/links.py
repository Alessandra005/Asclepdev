"""Link rules (spec 7A.2): pure functions over the ontology that write ontology_link rows. Owner: Alessandra.

Stage 6 of ingestion runs them for the objects that changed. Asclep never silently picks a winner: a source
conflict keeps both records and adds a conflicts_with link plus a SOURCE_CONFLICT alert (spec 11).
"""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ontology.api import provider_names


def _link(s: Session, link_type: str, from_type: str, from_id: UUID, to_type: str, to_id: UUID, rule: str) -> bool:
    """Insert (or re-activate) one link; True when it is new or was retracted before."""
    row = s.execute(text("""
        INSERT INTO ontology_link (link_type, from_type, from_id, to_type, to_id, derived_by)
        VALUES (:lt, :ft, :fi, :tt, :ti, :by)
        ON CONFLICT (link_type, from_id, to_id) DO UPDATE SET status = 'active' WHERE ontology_link.status <> 'active'
        RETURNING id"""), {"lt": link_type, "ft": from_type, "fi": from_id, "tt": to_type, "ti": to_id,
                           "by": f"rule:{rule}"}).first()
    return row is not None


def med_to_inventory(s: Session, med_request: dict) -> None:
    """fulfilled_by: MedicationRequest.medication_id = InventoryItem.medication_id."""
    if med_request.get("medication_id") is None:
        return
    item = s.execute(text("SELECT id FROM inventory_item WHERE medication_id = :m"),
                     {"m": med_request["medication_id"]}).scalar()
    if item:
        _link(s, "fulfilled_by", "MedicationRequest", med_request["id"], "InventoryItem", item, "med_to_inventory")


def cross_source_conflict(s: Session, patient_id: UUID) -> list[dict]:
    """conflicts_with: an allergy or active medication one source records and another source that holds
    records for this patient does not. Links go from the record to the Patient (the other side is an absence).
    Returns the newly found conflicts: {object_type, id, name, source_system, missing_from}."""
    # SPEC-QUESTION(Alessandra): 7A.9 has Gregory's Riverside albuterol linked to inventory and exactly one conflict
    # (penicillin), but the rule as specced (allergies, active meds, active problems) would also flag an active
    # albuterol order absent from Northside. Fixture has no albuterol; decide whether med absences are conflicts or
    # gaps before adding it.
    sources = set(s.execute(text("""
        SELECT source_system FROM patient WHERE id = :p
        UNION SELECT source_system FROM encounter WHERE patient_id = :p
        UNION SELECT source_system FROM observation WHERE patient_id = :p
        UNION SELECT source_system FROM condition WHERE patient_id = :p
        UNION SELECT source_system FROM allergy WHERE patient_id = :p
        UNION SELECT source_system FROM medication_request WHERE patient_id = :p
        UNION SELECT source_system FROM note WHERE patient_id = :p"""), {"p": patient_id}).scalars())
    # Only EHR providers hold a record set that can lack something; feeds (note-drop, asclep) never do.
    sources &= provider_names(s)
    if len(sources) < 2:
        return []
    items = [("Allergy", r) for r in s.execute(text("""
        SELECT id, lower(trim(substance)) AS key, substance AS name, source_system FROM allergy
        WHERE patient_id = :p AND record_status = 'current'"""), {"p": patient_id}).mappings()]
    items += [("MedicationRequest", r) for r in s.execute(text("""
        SELECT r.id, lower(COALESCE(m.name, r.dosage_text)) AS key, COALESCE(m.name, r.dosage_text) AS name,
               r.source_system FROM medication_request r LEFT JOIN medication m ON m.id = r.medication_id
        WHERE r.patient_id = :p AND r.status = 'active' AND r.record_status = 'current'"""), {"p": patient_id}).mappings()]
    found = []
    for object_type, r in items:
        holders = {x["source_system"] for t, x in items if t == object_type and x["key"] == r["key"]}
        missing = sorted(sources - holders - {"asclep"})
        if missing and _link(s, "conflicts_with", object_type, r["id"], "Patient", patient_id, "cross_source_conflict"):
            found.append({"object_type": object_type, "id": r["id"], "name": r["name"],
                          "source_system": r["source_system"], "missing_from": missing})
    return found
