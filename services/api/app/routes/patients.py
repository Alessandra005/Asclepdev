"""Patient routes (spec section 15). Owner: Alessandra.

Responses are shaped to the desktop's contract (apps/desktop/src/renderer/api/types.ts: PatientListItem,
Patient, PatientSummary); the ontology API does the reads, RBAC filtering and audit rows.
"""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.ontology import api as ontology
from app.rbac.require import require

router = APIRouter(tags=["patients"])

SOURCE_LABELS = {"ehr-a": "Riverside", "ehr-b": "Northside"}  # spec 16 providers


def _age(birth: date | str | None) -> int | None:
    if birth is None:
        return None
    b = birth if isinstance(birth, date) else date.fromisoformat(str(birth)[:10])
    t = date.today()
    return t.year - b.year - ((t.month, t.day) < (b.month, b.day))


def _sex(value: str | None) -> str:
    v = (value or "").lower()
    return "M" if v in ("m", "male") else "F" if v in ("f", "female") else "X"


def _provenance(row: dict) -> dict:
    return {"source_system": row.get("source_system"), "source_ref": row.get("source_ref"),
            "ingested_at": row.get("ingested_at")}


def _list_item(row: dict) -> dict:
    return {"id": row["id"], "name": f"{row['given_name']} {row['family_name']}", "age": _age(row["birth_date"]),
            "sex": _sex(row.get("sex")), "mrn": row["mrn"]}


def _all(s, p: Principal, type_: str, patient_id: UUID) -> list[dict]:
    return ontology.list_objects(s, p, type_, patient_id=patient_id, limit=200)["items"]


@router.get("/patients")
def list_patients(q: str | None = None, cursor: str | None = None,
                  p: Principal = Depends(require("view_demographics", object_type="Patient")),
                  s=Depends(get_session)):
    page = ontology.list_objects(s, p, "Patient", patient_id=None, cursor=cursor)
    items = [_list_item(r) for r in page["items"]]
    if q:  # ponytail: filters within the page; fine for demo-sized care teams, push into SQL if lists grow
        needle = q.strip().lower()
        items = [i for i in items if needle in i["name"].lower() or needle in i["mrn"].lower()]
    return {"items": items, "next_cursor": page["next_cursor"]}


@router.get("/patients/{patient_id}")
def get_patient(patient_id: UUID,
                p: Principal = Depends(require("view_demographics", patient_param="patient_id", object_type="Patient")),
                s=Depends(get_session)):
    try:
        row = ontology.get_object(s, p, "Patient", patient_id)
    except LookupError:
        raise AsclepError("NOT_FOUND", "Patient not found.")
    except PermissionError:
        raise AsclepError("FORBIDDEN_ROLE", "This record is restricted.")
    allergies = [{"substance": a["substance"], "provenance": _provenance(a)}
                 for a in _all(s, p, "Allergy", patient_id)]
    # The patient's home source is current; every other source that contributed records was merged in.
    seen = dict.fromkeys([row["source_system"]])  # ordered set: home source first
    for type_ in ("Allergy", "Condition", "Observation", "MedicationRequest"):
        seen.update(dict.fromkeys(r["source_system"] for r in _all(s, p, type_, patient_id)))
    sources = [{"source_system": src, "label": SOURCE_LABELS.get(src, src),
                "status": "current" if i == 0 else "merged"} for i, src in enumerate(seen)]
    return {**_list_item(row), "allergies": allergies,
            # No allergy rows is not "none known": say unknown, never imply the patient has none.
            "allergy_status": "recorded" if allergies else "unknown", "sources": sources}


@router.get("/patients/{patient_id}/summary")
def patient_summary(patient_id: UUID,
                    p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="ContextView")),
                    s=Depends(get_session)):
    conditions = [{"display": c["display"], "provenance": _provenance(c)}
                  for c in _all(s, p, "Condition", patient_id) if c.get("clinical_status") in (None, "active")]
    medications = []
    for m in _all(s, p, "MedicationRequest", patient_id):
        if m.get("status") != "active":
            continue
        name, stock = ontology.medication_stock(s, m.get("medication_id"))
        medications.append({"display": name or m.get("dosage_text") or "Medication",
                            "inventory_status": stock, "provenance": _provenance(m)})
    allergies = [{"substance": a["substance"], "provenance": _provenance(a)}
                 for a in _all(s, p, "Allergy", patient_id)]
    encounters = sorted(_all(s, p, "Encounter", patient_id), key=lambda e: str(e.get("start_at") or ""),
                        reverse=True)
    last = encounters[0] if encounters else None
    return {
        "conditions": conditions,
        "medications": medications,
        "allergies": allergies,
        "last_encounter": {"date": last["start_at"], "reason": last.get("reason") or last.get("type") or "Visit",
                           "provenance": _provenance(last)} if last else None,
        # SPEC-QUESTION(Alessandra): fill from the transcript_diff view once transcripts merge (spec 11 step 6).
        "new_from_sources": [],
    }
