"""Per-patient clinical lists, citation sources, files, inventory and appointments (spec 15). Owner: Alessandra."""
from datetime import date
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import text

from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.ontology import api as ontology
from app.ontology import shapes
from app.rbac.permissions import scope_for
from app.rbac.require import check_patient, require

router = APIRouter(tags=["clinical"])

DATA_DIR = Path("/srv/data")  # the compose volume ../data (heatmaps, thumbs, tiles, slides)
# Which permission reading each cited type needs (spec 13 step 1).
READ_PERMISSION = {"Observation": "view_labs", "Note": "view_notes", "Finding": "view_labs",
                   "Condition": "view_labs", "Allergy": "view_demographics", "MedicationRequest": "view_labs",
                   "Encounter": "view_labs", "InventoryItem": "view_inventory", "Patient": "view_demographics"}


def _rid(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@router.get("/patients/{patient_id}/observations")
def observations(patient_id: UUID, category: str | None = None, since: str | None = None, loinc: str | None = None,
                 cursor: str | None = None,
                 p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="Observation")),
                 s=Depends(get_session)):
    page = ontology.list_objects(s, p, "Observation", patient_id=patient_id, cursor=cursor, limit=200,
                                 filters=ontology.Filters(category=category, since=since, loinc=loinc))
    return {"items": [shapes.observation(r) for r in page["items"]], "next_cursor": page["next_cursor"]}


@router.get("/patients/{patient_id}/medications")
def medications(patient_id: UUID,
                p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="MedicationRequest")),
                s=Depends(get_session)):
    rows = ontology.list_objects(s, p, "MedicationRequest", patient_id=patient_id, limit=200)["items"]
    return {"items": [shapes.medication(s, r) for r in rows], "next_cursor": None}


@router.get("/patients/{patient_id}/notes")
def notes(patient_id: UUID, kind: str | None = None,
          p: Principal = Depends(require("view_notes", patient_param="patient_id", object_type="Note")),
          s=Depends(get_session)):
    if scope_for("view_notes", p.role) == "own":  # scribes: own notes only, and notes carry no author user id
        return {"items": [], "next_cursor": None}
    rows = ontology.list_objects(s, p, "Note", patient_id=patient_id, limit=200)["items"]
    rows = sorted((r for r in rows if not kind or r["kind"] == kind),
                  key=lambda r: r.get("effective_at") or r.get("ingested_at"), reverse=True)
    return {"items": [shapes.note(r) for r in rows], "next_cursor": None}


@router.get("/patients/{patient_id}/records-tree")
def records_tree(patient_id: UUID,
                 p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="RecordsTree")),
                 s=Depends(get_session)):
    """records_tree view (7A.6): every object grouped by registry folder, newest first, no limits."""
    return {"folders": ontology.records_tree(s, p, patient_id)}


@router.get("/sources/{citation_id}")
def source_record(citation_id: str, request: Request,
                  p: Principal = Depends(require("authenticated")), s=Depends(get_session)):
    """The record a citation chip points to (desktop SourceRecord). Same RBAC as reading that record directly."""
    type_, _, raw_id = citation_id.partition(":")
    if type_ not in READ_PERMISSION:
        raise AsclepError("NOT_FOUND", "Unknown source type.")
    try:
        object_id = UUID(raw_id)
        row = ontology.peek(s, type_, object_id)
    except (ValueError, LookupError):
        raise AsclepError("NOT_FOUND", "Source record not found.")
    patient_id = row.get("patient_id") or (row["id"] if type_ == "Patient" else None)
    check_patient(s, p, READ_PERMISSION[type_], patient_id, type_, request_id=_rid(request), object_id=object_id)
    if row.get("sensitivity") == "restricted" and not ontology.can_see_restricted(s, p, patient_id):
        raise AsclepError("FORBIDDEN_ROLE", "This record is restricted.")
    recorded = row.get("effective_at") or row.get("created_at") or row.get("ingested_at") or row.get("updated_at")
    return {"citation": shapes.citation(type_, row), "title": shapes.title(type_, row),
            "body": shapes.body(type_, row), "recorded_at": recorded}


@router.get("/files/{path:path}")
def files(path: str, request: Request, p: Principal = Depends(require("view_labs")), s=Depends(get_session)):
    """Heatmap / tile / thumbnail images from the Lab Technician (spec 15), for the patient's care team."""
    target = (DATA_DIR / path).resolve()
    if not target.is_relative_to(DATA_DIR.resolve()) or not path.startswith(("heatmaps/", "thumbs/", "tiles/")):
        raise AsclepError("NOT_FOUND", "File not found.")
    patient_id = ontology.patient_for_file(s, path)
    if patient_id is None or not target.is_file():
        raise AsclepError("NOT_FOUND", "File not found.")
    check_patient(s, p, "view_labs", patient_id, "File", request_id=_rid(request))
    return FileResponse(target)


@router.get("/inventory")
def inventory(q: str | None = None, p: Principal = Depends(require("view_inventory", object_type="InventoryItem")),
              s=Depends(get_session)):
    rows = s.execute(
        text("""SELECT i.*, m.name FROM inventory_item i JOIN medication m ON m.id = i.medication_id
                WHERE (CAST(:q AS text) IS NULL OR m.name ILIKE '%' || :q || '%') ORDER BY m.name"""),
        {"q": q.strip() if q else None},
    ).mappings().all()
    items = []
    for r in rows:
        _, inv = shapes.inventory(s, r["medication_id"])
        items.append({"id": r["id"], "medication": r["name"], "on_hand": r["on_hand"],
                      "reorder_point": r["reorder_point"], "backordered": r["backordered"],
                      "supplier": r["supplier"], "expected_restock_at": r["expected_restock_at"],
                      "status": inv["status"] if inv else None, "updated_at": r["updated_at"]})
    return {"items": items, "next_cursor": None}


@router.get("/appointments")
def appointments(day: date | None = Query(None, alias="date"), patient_id: UUID | None = None,
                 p: Principal = Depends(require("view_dashboard", object_type="Appointment")), s=Depends(get_session)):
    """Schedule rows for patients on the user's care team (physicians: their own appointments)."""
    return {"items": ontology.appointments(s, p, day=day, patient_id=patient_id), "next_cursor": None}

