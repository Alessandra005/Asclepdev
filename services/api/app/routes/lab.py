"""Lab flow: slides, the Lab Technician, the Resident's report, physician review (spec 9, 10.1, 14.4, 15).

Key flow 1 (spec 5): upload -> classify (Finding, pending_review) -> draft report -> confirm/override/reject.
Routes addressed by a slide or finding id look the patient up and call check_patient(), so the care-team
and attending rules apply exactly as on /patients/{id}/... routes.
"""
import json
import re
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, ValidationError
from sqlalchemy import text

from app.alerts.engine import evaluate_object
from app.audit.log import write_audit
from app.auth.principal import Principal
from app.config import settings
from app.db import get_session
from app.errors import AsclepError
from app.ontology import api as ontology
from app.ontology import shapes
from app.rbac.require import check_patient, require
from asclep_contracts import ClassifyResult, DraftReport, DraftReportRequest, LockedFinding
from asclep_contracts.resident import ContextRef

router = APIRouter(tags=["lab"])

SLIDES_DIR = Path("/srv/data/slides")
UPSTREAM_TIMEOUT = 120.0  # spec 15: classify and report are synchronous with a 120-second timeout
CITE = re.compile(r"\[\[obj:(\w+):([0-9a-fA-F-]{36})\]\]")
RAN_ON = "local" if settings.resident_mock else "anthropic_api"


class ReviewBody(BaseModel):
    action: Literal["confirm", "override", "reject"]
    final_label: Literal["LUAD", "LUSC", "benign"] | None = None
    note: str | None = None


def _rid(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _post(url: str, payload: dict, model: type[BaseModel], what: str, headers: dict | None = None) -> BaseModel:
    """Call an internal service; a network error or an off-contract reply is UPSTREAM_UNAVAILABLE (spec 10.4)."""
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=UPSTREAM_TIMEOUT)
        r.raise_for_status()
        return model.model_validate(r.json())
    except (httpx.HTTPError, ValidationError, ValueError) as exc:
        raise AsclepError("UPSTREAM_UNAVAILABLE", f"The {what} is not responding. Try again.") from exc


def _finding(s, finding_id: UUID) -> dict:
    try:
        return ontology.peek(s, "Finding", finding_id)
    except LookupError:
        raise AsclepError("NOT_FOUND", "Finding not found.")


@router.get("/patients/{patient_id}/findings")
def list_findings(patient_id: UUID,
                  p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="Finding")),
                  s=Depends(get_session)):
    rows = ontology.list_objects(s, p, "Finding", patient_id=patient_id, limit=200)["items"]
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return {"items": [shapes.finding(s, r) for r in rows], "next_cursor": None}


@router.get("/patients/{patient_id}/slides")
def list_slides(patient_id: UUID,
                p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="Slide")),
                s=Depends(get_session)):
    """Slides with their latest finding (null until analyzed), so the Lab tab can offer Analyze (spec 17 step 4)."""
    rows = s.execute(text("""
        SELECT sl.id, sl.specimen_id, sl.uploaded_at, sp.site, sp.accession,
               (SELECT f.id FROM finding f WHERE f.slide_id = sl.id ORDER BY f.created_at DESC LIMIT 1) AS finding_id
        FROM slide sl JOIN specimen sp ON sp.id = sl.specimen_id
        WHERE sp.patient_id = :pid ORDER BY sl.uploaded_at DESC"""), {"pid": patient_id}).mappings().all()
    return {"items": [{"id": r["id"], "specimen_id": r["specimen_id"], "uploaded_at": r["uploaded_at"],
                       "specimen_label": " · ".join(x for x in (r["site"], r["accession"]) if x) or "Specimen",
                       "finding_id": r["finding_id"]} for r in rows], "next_cursor": None}


@router.post("/patients/{patient_id}/specimens/{specimen_id}/slides")
def upload_slide(patient_id: UUID, specimen_id: UUID, request: Request, file: UploadFile = File(...),
                 p: Principal = Depends(require("run_lab_technician", patient_param="patient_id",
                                                object_type="Slide", action="create")),
                 s=Depends(get_session)):
    owner = s.execute(text("SELECT patient_id FROM specimen WHERE id = :id"), {"id": specimen_id}).scalar()
    if owner != patient_id:
        raise AsclepError("NOT_FOUND", "Specimen not found for this patient.")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".svs", ".tif", ".tiff", ".ndpi", ".png", ".jpg", ".jpeg"):
        raise AsclepError("VALIDATION_ERROR", "Upload a whole slide image (.svs, .tif, .ndpi) or an image file.")
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid4()}{suffix}"
    with (SLIDES_DIR / name).open("wb") as out:
        while chunk := file.file.read(1 << 20):
            out.write(chunk)
    slide = dict(s.execute(text("""INSERT INTO slide (specimen_id, file_path) VALUES (:sp, :fp) RETURNING *"""),
                           {"sp": specimen_id, "fp": f"slides/{name}"}).mappings().one())
    ontology.create_task_for_attending(s, patient_id, "analyze_slide", "Biopsy slide ready to analyze", slide["id"])
    return slide


@router.post("/slides/{slide_id}/classify")
def classify(slide_id: UUID, request: Request, p: Principal = Depends(require("run_lab_technician")),
             s=Depends(get_session)):
    """classify_slide action. The Lab Technician's result is stored as a Finding with status pending_review."""
    slide = s.execute(text("""SELECT sl.*, sp.patient_id FROM slide sl JOIN specimen sp ON sp.id = sl.specimen_id
                              WHERE sl.id = :id"""), {"id": slide_id}).mappings().first()
    if not slide:
        raise AsclepError("NOT_FOUND", "Slide not found.")
    check_patient(s, p, "run_lab_technician", slide["patient_id"], "Slide", "create", _rid(request), slide_id)
    # Spec 9/17: a slide is classified once; the demo reads the stored (pre-computed) Finding.
    existing = s.execute(text("SELECT * FROM finding WHERE slide_id = :id ORDER BY created_at DESC LIMIT 1"),
                         {"id": slide_id}).mappings().first()
    if existing:
        write_audit(s, p, "read", "Finding", existing["id"], slide["patient_id"], request_id=_rid(request),
                    ai="lab_tech", ran_on="local")
        return shapes.finding(s, dict(existing))
    result = _post(f"{settings.labtech_url}/classify", {"slide_id": str(slide_id), "file_path": slide["file_path"]},
                   ClassifyResult, "Lab Technician")
    row = store_finding(s, slide_id, slide["patient_id"], result)
    write_audit(s, p, "create", "Finding", row["id"], slide["patient_id"], request_id=_rid(request),
                ai="lab_tech", ran_on="local")
    return shapes.finding(s, row)


def store_finding(s, slide_id: UUID, patient_id: UUID, result: ClassifyResult) -> dict:
    """Save a ClassifyResult as a pending_review Finding, raise FINDING_PENDING, hand the attending a review task."""
    flags = list(result.flags)
    if result.confidence < 0.60 and "uncertain" not in flags:
        flags.append("uncertain")  # spec 9: amber banner
    row = dict(s.execute(text("""
        INSERT INTO finding (slide_id, patient_id, model_name, model_version, label, confidence, class_scores,
                             heatmap_path, thumbnail_path, top_tiles, flags)
        VALUES (:sl, :pid, :mn, :mv, :label, :conf, CAST(:scores AS jsonb), :heat, :thumb, CAST(:tiles AS jsonb),
                CAST(:flags AS jsonb)) RETURNING *"""), {
        "sl": slide_id, "pid": patient_id, "mn": result.model_name, "mv": result.model_version,
        "label": result.label, "conf": result.confidence, "scores": json.dumps(result.class_scores),
        "heat": result.heatmap_path, "thumb": result.thumbnail_path,
        "tiles": json.dumps([t.model_dump() for t in result.top_tiles]), "flags": json.dumps(flags),
    }).mappings().one())
    evaluate_object(s, "Finding", row["id"], patient_id, row)
    ontology.complete_tasks(s, kind="analyze_slide", ref_id=slide_id)
    ontology.create_task_for_attending(s, patient_id, "review_finding", "Review biopsy finding", row["id"])
    return row


@router.post("/findings/{finding_id}/report")
def draft_report(finding_id: UUID, request: Request, p: Principal = Depends(require("view_labs")),
                 s=Depends(get_session)):
    """draft_report action: the Resident drafts from the pathology_review view; the locked values never pass
    through the model (spec 10.1). Returns the desktop Report: cited sentences, always a draft."""
    finding = _finding(s, finding_id)
    patient_id = finding["patient_id"]
    check_patient(s, p, "view_labs", patient_id, "Report", "create", _rid(request), finding_id)
    view = ontology.context_view(s, p, "pathology_review", finding_id)
    context = [ContextRef(object_type=i.type, id=i.id, text=i.title) for i in view.items
               if i.type not in ("Patient", "Finding")]
    req = DraftReportRequest(
        finding=LockedFinding(finding_id=finding_id, label=finding["label"], confidence=finding["confidence"],
                              class_scores=finding["class_scores"], model_name=finding["model_name"],
                              model_version=finding["model_version"], flags=finding.get("flags") or []),
        patient_context=context, locked_facts=ontology.facts(s, p, patient_id, "key_labs"))
    draft = _post(f"{settings.resident_url}/draft-report", req.model_dump(mode="json"), DraftReport, "Resident")
    allowed = {str(c.id) for c in context} | {str(finding_id)}
    report = dict(s.execute(text("""
        INSERT INTO report (finding_id, body_md, citations, locked_check_passed, status)
        VALUES (:f, :body, CAST(:cites AS jsonb), :ok, 'draft') RETURNING *"""), {
        "f": finding_id, "body": draft.body_md, "ok": draft.locked_check_passed,
        "cites": json.dumps([c.model_dump(mode="json") for c in draft.citations if str(c.id) in allowed]),
    }).mappings().one())
    write_audit(s, p, "create", "Report", report["id"], patient_id, request_id=_rid(request), ai="resident",
                ran_on=RAN_ON)
    return report_view(s, report, patient_id)


def report_view(s, report: dict, patient_id: UUID) -> dict:
    """body_md -> {sentences[{text, citation_ids}], citations[]}. Only citations of this patient's records survive."""
    sentences, citations = [], {}
    for line in report["body_md"].splitlines():
        line = line.strip().lstrip("-*").strip()
        if not line or line.startswith("#"):
            continue
        ids = []
        for type_, oid in CITE.findall(line):
            cid = f"{type_}:{oid}"
            if cid not in citations:
                try:
                    row = ontology.peek(s, type_, UUID(oid))
                except (LookupError, ValueError):
                    continue
                if row.get("patient_id") not in (patient_id, None):
                    continue  # spec 10.1: a citation must belong to this patient
                citations[cid] = shapes.citation(type_, row)
            ids.append(cid)
        text_ = CITE.sub("", line).replace("_", "").strip()
        if text_:
            sentences.append({"text": text_, "citation_ids": ids})
    return {"id": report["id"], "finding_id": report["finding_id"], "status": report.get("status", "draft"),
            "locked_check_passed": report["locked_check_passed"], "sentences": sentences,
            "citations": list(citations.values())}


@router.post("/findings/{finding_id}/review")
def review_finding(finding_id: UUID, body: ReviewBody, request: Request,
                   p: Principal = Depends(require("review_findings")), s=Depends(get_session)):
    """review_finding action: attending only. The model's label and confidence are never rewritten."""
    finding = _finding(s, finding_id)
    check_patient(s, p, "review_findings", finding["patient_id"], "Finding", "sign", _rid(request), finding_id)
    note = (body.note or "").strip() or None
    if body.action != "confirm" and not note:
        raise AsclepError("VALIDATION_ERROR", "A note is required to override or reject.")
    if body.action == "override" and not body.final_label:
        raise AsclepError("VALIDATION_ERROR", "Pick the corrected label.")
    status = {"confirm": "confirmed", "override": "overridden", "reject": "rejected"}[body.action]
    final_label = {"confirm": finding["label"], "override": body.final_label, "reject": None}[body.action]
    row = s.execute(text("""
        UPDATE finding SET status = :st, final_label = :fl, review_note = :note, reviewed_by = :u, reviewed_at = now()
        WHERE id = :id AND status = 'pending_review' RETURNING *"""),
        {"st": status, "fl": final_label, "note": note, "u": p.user_id, "id": finding_id}).mappings().first()
    if not row:
        raise AsclepError("CONFLICT", "This finding was already reviewed.")
    row = dict(row)
    if body.action == "confirm":
        ontology.finding_confirmed(s, p, row)  # link rule: supports + a new Condition (7A.2)
    ontology.complete_tasks(s, kind="review_finding", ref_id=finding_id)
    ontology.acknowledge_alerts(s, rule_id="FINDING_PENDING", source_id=finding_id)
    return shapes.finding(s, row)
