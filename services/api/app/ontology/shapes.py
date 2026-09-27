"""Row -> desktop contract shapes (apps/desktop/src/renderer/api/types.ts). Owner: Alessandra.

Kept next to the ontology API so every route shapes clinical rows the same way.
"""
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

SOURCE_LABELS = {"ehr-a": "Riverside", "ehr-b": "Northside", "asclep": "Asclep", "lab-tech": "Lab Technician"}
LABEL_DISPLAY = {"LUAD": "LUAD (adenocarcinoma)", "LUSC": "LUSC (squamous cell carcinoma)", "benign": "Benign"}
NOTE_TITLES = {"imaging_report": "Imaging report", "progress": "Progress note", "scribe": "Scribe note",
               "shadowing": "Shadowing note", "referral": "Referral note", "visual_scribe": "Visit observations (Scribe)"}
# ontology type -> desktop Citation.kind
CITATION_KIND = {"Observation": "observation", "Note": "note", "Condition": "condition", "Allergy": "allergy",
                 "MedicationRequest": "medication", "Finding": "finding", "InventoryItem": "inventory"}


def provenance(row: dict) -> dict:
    return {"source_system": row.get("source_system"), "source_ref": row.get("source_ref"),
            "ingested_at": row.get("ingested_at")}


def observation(row: dict) -> dict:
    keys = ("id", "category", "loinc_code", "display", "value_num", "value_text", "unit", "ref_low", "ref_high",
            "interpretation", "effective_at")
    return {**{k: row.get(k) for k in keys}, "provenance": provenance(row)}


def inventory(s: Session, medication_id: UUID | None) -> tuple[str | None, dict | None]:
    """(medication name, {status, on_hand, expected_restock_at}) or None where no inventory row exists."""
    if medication_id is None:
        return None, None
    row = s.execute(
        text("""SELECT m.name, i.on_hand, i.reorder_point, i.backordered, i.expected_restock_at
                FROM medication m LEFT JOIN inventory_item i ON i.medication_id = m.id WHERE m.id = :mid LIMIT 1"""),
        {"mid": medication_id},
    ).mappings().first()
    if not row:
        return None, None
    if row["on_hand"] is None:
        return row["name"], None
    status = ("backordered" if row["backordered"] or row["on_hand"] == 0
              else "low" if row["on_hand"] < row["reorder_point"] else "in_stock")
    return row["name"], {"status": status, "on_hand": row["on_hand"], "expected_restock_at": row["expected_restock_at"]}


def medication(s: Session, row: dict) -> dict:
    name, inv = inventory(s, row.get("medication_id"))
    return {"id": row["id"], "medication": name or row.get("dosage_text") or "Medication", "status": row["status"],
            "dosage_text": row.get("dosage_text") or None, "effective_at": row.get("effective_at"),
            "inventory": inv, "provenance": provenance(row)}


def note(row: dict) -> dict:
    return {"id": row["id"], "kind": row["kind"], "title": NOTE_TITLES.get(row["kind"], row["kind"].title()),
            "body": row["body"], "author_name": row.get("author_name"), "effective_at": row.get("effective_at"),
            "is_legal_record": row.get("is_legal_record", True), "status": "final", "provenance": provenance(row)}


def finding(s: Session, row: dict) -> dict:
    """The desktop Finding. The model's label and confidence are never rewritten; review fields sit beside them."""
    extra = s.execute(
        text("""SELECT sp.accession, sp.site, u.full_name AS reviewer FROM slide sl
                JOIN specimen sp ON sp.id = sl.specimen_id LEFT JOIN app_user u ON u.id = :rb
                WHERE sl.id = :slide"""),
        {"slide": row["slide_id"], "rb": row.get("reviewed_by")},
    ).mappings().first() or {}
    tiles = row.get("top_tiles") or []
    return {
        "id": row["id"], "patient_id": row["patient_id"], "slide_id": row["slide_id"],
        "specimen_label": " · ".join(x for x in (extra.get("site"), extra.get("accession")) if x) or "Specimen",
        "label": row["label"], "label_display": LABEL_DISPLAY.get(row["label"], row["label"]),
        "confidence": row["confidence"], "model_name": row["model_name"], "model_version": row["model_version"],
        "flags": row.get("flags") or [], "status": row["status"], "final_label": row.get("final_label"),
        "review_note": row.get("review_note"), "reviewed_by": extra.get("reviewer"),
        "reviewed_at": row.get("reviewed_at"),
        "heatmap_url": file_url(row.get("heatmap_path")),
        "thumbnail_url": file_url(row.get("thumbnail_path")), "tile_urls": [u for t in tiles if (u := file_url(t.get("path")))],
        "provenance": {"source_system": "lab-tech", "source_ref": f"Slide/{row['slide_id']}",
                       "ingested_at": row.get("created_at")},
    }


def file_url(path: str | None) -> str | None:
    return f"/api/v1/files/{path}" if path else None


def citation(object_type: str, row: dict, label: str | None = None) -> dict:
    """The desktop Citation for one ontology row. Its id is '<Type>:<uuid>', resolved by GET /sources/{id}."""
    return {"id": f"{object_type}:{row['id']}", "kind": CITATION_KIND.get(object_type, "note"),
            "label": label or title(object_type, row), "object_id": row["id"],
            "provenance": provenance(row) if row.get("source_system") else
            {"source_system": "asclep", "source_ref": f"{object_type}/{row['id']}",
             "ingested_at": row.get("created_at") or row.get("updated_at")}}


def title(object_type: str, row: dict) -> str:
    if object_type == "Observation":
        value = row.get("value_num") if row.get("value_num") is not None else row.get("value_text")
        return f"{row['display']}: {value} {row.get('unit') or ''}".strip()
    if object_type == "Allergy":
        return f"Allergy: {row['substance']}"
    if object_type == "Finding":
        return f"Finding: {row['label']} ({row['status'].replace('_', ' ')})"
    if object_type == "Note":
        return NOTE_TITLES.get(row["kind"], row["kind"])
    if object_type == "InventoryItem":
        return f"Inventory: {row.get('name', 'medication')}"
    if object_type == "MedicationRequest":
        return row.get("name") or row.get("dosage_text") or "Medication request"
    if object_type == "Specimen":
        at = row.get("collected_at")
        return " · ".join(x for x in (row.get("site"), row.get("accession"),
                                      at and f"collected {at:%b %d, %Y}") if x) or "Specimen"
    return row.get("display") or row.get("substance") or object_type


def body(object_type: str, row: dict) -> str:
    """Plain-language detail for the SourceDrawer. Facts only, straight from the row."""
    src = SOURCE_LABELS.get(row.get("source_system") or "", row.get("source_system") or "Asclep")
    if object_type == "Observation":
        lo, hi = row.get("ref_low"), row.get("ref_high")
        ref = f"ref {lo:g}–{hi:g}" if lo is not None and hi is not None else \
            f"ref ≥ {lo:g}" if lo is not None else f"ref ≤ {hi:g}" if hi is not None else None
        parts = [ref, row.get("interpretation") and f"flag {row['interpretation']}",  # a null flag is never "normal"
                 row.get("loinc_code") and f"LOINC {row['loinc_code']}"]
        detail = ", ".join(x for x in parts if x)
        return f"{title(object_type, row)}{f' ({detail})' if detail else ''}. Recorded by {src}."
    if object_type == "Note":
        return row["body"]
    if object_type == "Allergy":
        return f"{row['substance']}. Reaction: {row.get('reaction') or 'not recorded'}. Recorded by {src}."
    if object_type == "Condition":
        return f"{row['display']}. Status: {row.get('clinical_status') or 'not recorded'}. Recorded by {src}."
    if object_type == "Finding":
        return (f"Model label {row['label']}, model confidence {row['confidence']:.2f} ({row['model_name']} "
                f"{row['model_version']}). Status: {row['status'].replace('_', ' ')}.")
    if object_type == "InventoryItem":
        restock = row.get("expected_restock_at")
        when = f" Expected restock {restock:%b %d, %Y}." if isinstance(restock, datetime) else ""
        return (f"On hand: {row['on_hand']}. {'Backordered.' if row['backordered'] else 'Not backordered.'}"
                f"{when} Supplier: {row.get('supplier') or 'not recorded'}.")
    if object_type == "MedicationRequest":
        return f"{title(object_type, row)}. Status {row['status']}. {row.get('dosage_text') or ''}".strip()
    return title(object_type, row)
