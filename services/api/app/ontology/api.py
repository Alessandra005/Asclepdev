"""The ontology API: the ONLY door to clinical data (spec section 7A.8)."""
import json
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import UUID

import yaml
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.log import write_audit
from app.auth.principal import Principal
from app.ontology import shapes
from app.rbac.permissions import scope_for
from asclep_contracts import ContextItem, ContextView
from asclep_contracts.ontology import SubjectRef

_REGISTRY = yaml.safe_load((Path(__file__).parent / "registry.yaml").read_text())
_VIEWS = yaml.safe_load((Path(__file__).parent / "views.yaml").read_text())
_CODE_GROUPS = yaml.safe_load((Path(__file__).parent / "code_groups.yaml").read_text())


# Tables with 7A.4 record_status: superseded / entered-in-error rows never reach a screen or prompt.
_VERSIONED = {"patient", "encounter", "observation", "condition", "allergy", "medication_request", "note", "referral"}


class Filters(BaseModel):
    since: str | None = None
    category: str | None = None
    loinc: str | None = None
    code_group: str | None = None
    status: str | None = None


def _table_for(type_: str) -> str:
    entry = _REGISTRY["object_types"].get(type_)
    if not entry:
        raise ValueError(f"Unknown object type: {type_}")
    return entry["table"]


def _code_column(type_: str) -> str:
    return "loinc_code" if type_ == "Observation" else "code"  # observation has no `code`, condition no `loinc_code`


def _status_column(type_: str) -> str:
    # allergy has no status: its "current" filter is the 7A.4 record_status
    return {"Condition": "clinical_status", "Allergy": "record_status"}.get(type_, "status")


def _is_attending_for(s: Session, p: Principal, patient_id: UUID) -> bool:
    if scope_for("view_restricted", p.role) != "attending":
        return False
    rel = s.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": p.user_id, "p": patient_id},
    ).scalar()
    return rel == "attending"


def _row_visible(s: Session, p: Principal, row: dict, patient_id: UUID | None) -> bool:
    if row.get("sensitivity") == "restricted":
        return patient_id is not None and _is_attending_for(s, p, patient_id)
    return True


def _resolve_patient_id(type_: str, row: dict) -> UUID | None:
    return row.get("patient_id", row.get("id") if type_ == "Patient" else None)


def get_object(s: Session, p: Principal, type: str, id: UUID) -> dict:
    table = _table_for(type)
    row = s.execute(text(f"SELECT * FROM {table} WHERE id = :id"), {"id": id}).mappings().first()
    if not row:
        raise LookupError(f"{type} {id} not found")
    row = dict(row)
    resolved_pid = _resolve_patient_id(type, row)
    if not _row_visible(s, p, row, resolved_pid):
        raise PermissionError(f"{type} {id} is restricted")
    write_audit(s, p, "read", type, object_id=id, patient_id=resolved_pid)
    return row


def list_objects(s: Session, p: Principal, type: str, patient_id: UUID | None = None,
                  filters: Filters | None = None, limit: int = 50, cursor: str | None = None) -> dict:
    table = _table_for(type)
    conditions = []
    params: dict = {"limit": limit + 1}

    if patient_id is not None:
        conditions.append("patient_id = :patient_id")
        params["patient_id"] = patient_id
    elif type == "Patient":
        scope = scope_for("view_demographics", p.role)
        if scope == "all":
            pass
        elif scope == "care_team":
            conditions.append("id IN (SELECT patient_id FROM care_team_member WHERE user_id = :uid)")
            params["uid"] = p.user_id
        elif scope == "specimen_only":  # lab staff: patients with a specimen on file
            conditions.append("id IN (SELECT patient_id FROM specimen)")
        else:
            conditions.append("1=0")

    if table in _VERSIONED:
        conditions.append("record_status = 'current'")

    if filters:
        if filters.status:
            conditions.append(f"{_status_column(type)} = :status")
            params["status"] = filters.status
        if filters.category and type == "Observation":
            conditions.append("category = :category")
            params["category"] = filters.category
        if filters.loinc and type == "Observation":
            conditions.append("loinc_code = :loinc")
            params["loinc"] = filters.loinc
        if filters.since:
            time_field = _REGISTRY["object_types"][type].get("time_field", "ingested_at")
            conditions.append(f"{time_field} >= CAST(:since AS timestamptz)")
            params["since"] = filters.since
        if filters.code_group:
            codes = _CODE_GROUPS.get(filters.code_group, {})
            all_codes = [c for group in codes.values() for c in group]
            if all_codes:
                conditions.append(f"{_code_column(type)} = ANY(:codes)")
                params["codes"] = all_codes

    if cursor:
        conditions.append("id > :cursor")
        params["cursor"] = cursor

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = s.execute(text(f"SELECT * FROM {table} {where} ORDER BY id LIMIT :limit"), params).mappings().all()
    rows = [dict(r) for r in rows]
    rows = [r for r in rows if _row_visible(s, p, r, _resolve_patient_id(type, r))]

    next_cursor = None
    if len(rows) > limit:
        next_cursor = str(rows[limit - 1]["id"])
        rows = rows[:limit]

    write_audit(s, p, "read", type, patient_id=patient_id)
    return {"items": rows, "next_cursor": next_cursor}


def history(s: Session, p: Principal, type: str, id: UUID) -> list[dict]:
    rows = s.execute(
        text("SELECT * FROM object_version WHERE object_type = :type AND object_id = :id ORDER BY version DESC"),
        {"type": type, "id": id},
    ).mappings().all()
    write_audit(s, p, "read", type, object_id=id)
    return [dict(r) for r in rows]


def traverse(s: Session, p: Principal, type: str, id: UUID, link_types: list[str], depth: int = 1) -> list[dict]:
    if depth != 1:
        raise NotImplementedError("Alessandra: multi-hop traverse not built yet, depth=1 only")
    rows = s.execute(
        text("""SELECT * FROM ontology_link WHERE status = 'active' AND link_type = ANY(:types)
                AND (from_id = :id OR to_id = :id)"""),
        {"types": link_types, "id": id},
    ).mappings().all()
    results = []
    for r in rows:
        outgoing = str(r["from_id"]) == str(id)
        results.append({
            "link_type": r["link_type"],
            "direction": "outgoing" if outgoing else "incoming",
            "object_type": r["to_type"] if outgoing else r["from_type"],
            "object_id": r["to_id"] if outgoing else r["from_id"],
        })
    write_audit(s, p, "read", type, object_id=id)
    return results


def context_view(s: Session, p: Principal, view: str, subject_id: UUID) -> ContextView:
    recipe = _VIEWS.get(view)
    if not recipe:
        raise NotImplementedError(
            f"View '{view}' has no recipe in views.yaml yet (owner: Ron). "
            f"Available: {[k for k in _VIEWS if isinstance(_VIEWS[k], dict)]}"
        )

    subject_type = recipe["subject"]
    subject_row = get_object(s, p, subject_type, subject_id)
    patient_id = _resolve_patient_id(subject_type, subject_row) or subject_id

    items: list[ContextItem] = []
    omitted: dict[str, int] = {}
    sources: set[str] = set()

    for include in recipe.get("include", []):
        itype = include["type"]
        table = _table_for(itype)
        conditions = ["id = :pid" if itype == "Patient" else "patient_id = :pid"]
        params: dict = {"pid": patient_id}

        filt = include.get("filter", {})
        if "code_group" in filt:
            groups = filt["code_group"] if isinstance(filt["code_group"], list) else [filt["code_group"]]
            all_codes = [c for g in groups for group in _CODE_GROUPS.get(g, {}).values() for c in group]
            if all_codes:
                conditions.append(f"{_code_column(itype)} = ANY(:codes)")
                params["codes"] = all_codes
        if "status" in filt:
            conditions.append(f"{_status_column(itype)} = :status")
            params["status"] = filt["status"]
        if filt.get("exclude_self"):
            conditions.append("id != :self_id")
            params["self_id"] = subject_id

        where = f"WHERE {' AND '.join(conditions)}"
        max_rows = include.get("max", include.get("latest", 50))
        time_field = _REGISTRY["object_types"][itype].get("time_field", "ingested_at")

        rows = s.execute(text(f"SELECT * FROM {table} {where} ORDER BY {time_field} DESC LIMIT :lim"),
                          {**params, "lim": max_rows + 1}).mappings().all()
        rows = [dict(r) for r in rows]
        rows = [r for r in rows if _row_visible(s, p, r, patient_id)]
        if len(rows) > max_rows:
            omitted[itype] = omitted.get(itype, 0) + (len(rows) - max_rows)
            rows = rows[:max_rows]

        title_tpl = _REGISTRY["object_types"][itype].get("title", "{id}")
        for r in rows:
            try:
                title = title_tpl.format(**r)
            except (KeyError, ValueError, TypeError):  # e.g. a date format on a NULL date
                title = str(r.get("id"))
            items.append(ContextItem(
                type=itype, id=r["id"], title=title,
                effective_at=r.get("effective_at") or r.get("ingested_at"),
                source_system=r.get("source_system", "unknown"),
            ))
            sources.add(r.get("source_system", "unknown"))

    write_audit(s, p, "read", subject_type, object_id=subject_id, patient_id=patient_id)
    return ContextView(
        view=view, subject=SubjectRef(type=subject_type, id=subject_id),
        generated_at=datetime.now(timezone.utc), items=items,
        omitted=omitted, sources=[{"source_system": src} for src in sources],
    )


def facts(s: Session, p: Principal, patient_id: UUID, fact_set: str) -> dict:
    """Return deterministic Level 1 facts for a patient."""
    if fact_set == "key_labs":
        groups = _CODE_GROUPS.get("renal_function", {})
        key_codes = [
            code
            for codes in groups.values()
            for code in codes
        ]

        if not key_codes:
            return {"key_labs": []}

        query = text(
            """
            WITH ranked AS (
                SELECT
                    loinc_code,
                    display,
                    value_norm,
                    unit_norm,
                    interpretation,
                    effective_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY loinc_code
                        ORDER BY effective_at DESC
                    ) AS rn
                FROM observation
                WHERE patient_id = :patient_id
                  AND record_status = 'current'
                  AND loinc_code = ANY(:key_codes)
                  AND value_norm IS NOT NULL
            )
            SELECT
                cur.loinc_code AS code,
                cur.display,
                cur.value_norm AS latest,
                cur.unit_norm AS unit,
                cur.interpretation,
                cur.effective_at,
                CASE
                    WHEN prev.value_norm IS NULL THEN 'none'
                    WHEN cur.value_norm > prev.value_norm * 1.05 THEN 'rising'
                    WHEN cur.value_norm < prev.value_norm * 0.95 THEN 'falling'
                    ELSE 'stable'
                END AS trend,
                CASE
                    WHEN cur.interpretation IS NULL THEN false
                    WHEN cur.interpretation <> 'N' THEN true
                    ELSE false
                END AS abnormal
            FROM ranked cur
            LEFT JOIN ranked prev
                ON prev.loinc_code = cur.loinc_code
               AND prev.rn = 2
            WHERE cur.rn = 1
            ORDER BY cur.loinc_code
            """
        )

        rows = s.execute(
            query,
            {
                "patient_id": patient_id,
                "key_codes": key_codes,
            },
        ).mappings().all()

        return {
            "key_labs": [dict(row) for row in rows],
        }

    raise NotImplementedError(
        f"Unknown fact set: {fact_set}"
    )


def search(s: Session, p: Principal, query: str, patient_id: UUID | None, k: int = 8) -> list[dict]:
    """Vector search (7A.8). Callers check access to patient_id first; restricted chunks go to the attending only."""
    from app.ontology import index
    hits = [h for h in index.search(s, p.user_id, query, patient_id, k)
            if h["sensitivity"] != "restricted" or _is_attending_for(s, p, h["patient_id"])]
    write_audit(s, p, "read", "Chunk", patient_id=patient_id)
    return hits


def apply_action(s: Session, p: Principal, action: str, payload: BaseModel) -> dict:
    if action == "ingest_bundle":
        from app.ingest.pipeline import ingest_bundle
        return ingest_bundle(s, p, payload)
    if action == "request_transcript":
        from app.ingest.transcript import request_transcript
        return request_transcript(s, p, payload)
    if action == "merge_transcript":
        from app.ingest.transcript import merge_transcript
        return merge_transcript(s, p, payload)
    raise NotImplementedError(f"Alessandra: action '{action}' not implemented yet")


def peek(s: Session, type: str, id: UUID) -> dict:
    """One row by id with no RBAC or audit: callers check access (rbac.check_patient) before returning it."""
    if type == "InventoryItem":
        row = s.execute(text("""SELECT i.*, m.name FROM inventory_item i JOIN medication m ON m.id = i.medication_id
                                WHERE i.id = :id"""), {"id": id}).mappings().first()
    elif type == "MedicationRequest":
        row = s.execute(text("""SELECT r.*, m.name FROM medication_request r LEFT JOIN medication m
                                ON m.id = r.medication_id WHERE r.id = :id"""), {"id": id}).mappings().first()
    else:
        row = s.execute(text(f"SELECT * FROM {_table_for(type)} WHERE id = :id"), {"id": id}).mappings().first()
    if not row:
        raise LookupError(f"{type} {id} not found")
    return dict(row)


def can_see_restricted(s: Session, p: Principal, patient_id: UUID | None) -> bool:
    return patient_id is not None and _is_attending_for(s, p, patient_id)


def patient_for_file(s: Session, path: str) -> UUID | None:
    """The patient a Lab Technician image belongs to, so /files can apply the care-team rule."""
    return s.execute(
        text("""SELECT patient_id FROM finding WHERE heatmap_path = :p OR thumbnail_path = :p
                OR top_tiles @> CAST(:tile AS jsonb) LIMIT 1"""),
        {"p": path, "tile": json.dumps([{"path": path}])},
    ).scalar()


def records_tree(s: Session, p: Principal, patient_id: UUID) -> list[dict]:
    """records_tree(patient) view (7A.6): every object grouped by registry folder, newest first, no limits."""
    folders: dict[str, list[dict]] = {}
    for type_, entry in _REGISTRY["object_types"].items():
        if not entry.get("folder") or entry.get("patient_field") != "patient_id":
            continue
        rows = list_objects(s, p, type_, patient_id=patient_id, limit=1000)["items"]
        time_field = entry.get("time_field", "ingested_at")
        for r in sorted(rows, key=lambda r: str(r.get(time_field) or r.get("ingested_at") or ""), reverse=True):
            folders.setdefault(entry["folder"], []).append({
                "type": type_, "id": r["id"], "title": shapes.title(type_, r),
                "effective_at": r.get(time_field), "source_system": r.get("source_system") or "asclep",
            })
    return [{"name": name, "items": items} for name, items in folders.items()]


def appointments(s: Session, p: Principal, day: date | None = None, patient_id: UUID | None = None) -> list[dict]:
    """Schedule rows (desktop Appointment). Physicians see their own; nurses see their care-team patients'."""
    own = "a.user_id = :uid" if p.role == "physician" else \
        "a.patient_id IN (SELECT patient_id FROM care_team_member WHERE user_id = :uid)"
    rows = s.execute(
        text(f"""SELECT a.*, pt.given_name || ' ' || pt.family_name AS patient_name FROM appointment a
                 JOIN patient pt ON pt.id = a.patient_id
                 WHERE {own} AND (CAST(:day AS date) IS NULL OR a.start_at::date = CAST(:day AS date))
                 AND (CAST(:pid AS uuid) IS NULL OR a.patient_id = CAST(:pid AS uuid))
                 ORDER BY a.start_at"""),
        {"uid": p.user_id, "day": day, "pid": patient_id},
    ).mappings().all()
    write_audit(s, p, "read", "Appointment", patient_id=patient_id)
    status = {"booked": "scheduled", "arrived": "checked_in", "fulfilled": "completed"}
    return [{"id": r["id"], "patient_id": r["patient_id"], "patient_name": r["patient_name"],
             "starts_at": r["start_at"], "reason": r["reason"] or "Visit",
             "status": status.get(r["status"], r["status"])} for r in rows]


def create_task_for_attending(s: Session, patient_id: UUID, kind: str, title: str, ref_id: UUID) -> None:
    """One open task per (attending, kind, ref): re-running an action never piles up duplicates."""
    s.execute(text("""
        INSERT INTO task (user_id, patient_id, kind, ref_id, title)
        SELECT c.user_id, :pid, :kind, :ref, :title FROM care_team_member c
        WHERE c.patient_id = :pid AND c.relationship = 'attending'
          AND NOT EXISTS (SELECT 1 FROM task t WHERE t.user_id = c.user_id AND t.kind = :kind AND t.ref_id = :ref)"""),
        {"pid": patient_id, "kind": kind, "ref": ref_id, "title": title})


def create_task(s: Session, user_id: UUID, patient_id: UUID | None, kind: str, title: str, ref_id: UUID) -> None:
    s.execute(text("""
        INSERT INTO task (user_id, patient_id, kind, ref_id, title)
        SELECT :uid, :pid, :kind, :ref, :title
        WHERE NOT EXISTS (SELECT 1 FROM task WHERE user_id = :uid AND kind = :kind AND ref_id = :ref)"""),
        {"uid": user_id, "pid": patient_id, "kind": kind, "ref": ref_id, "title": title})


def complete_tasks(s: Session, kind: str, ref_id: UUID) -> None:
    s.execute(text("UPDATE task SET done_at = now() WHERE kind = :k AND ref_id = :r AND done_at IS NULL"),
              {"k": kind, "r": ref_id})


def acknowledge_alerts(s: Session, rule_id: str, source_id: UUID) -> None:
    """The problem an alert pointed at is resolved (e.g. the finding was reviewed): clear it for everyone."""
    s.execute(text("""UPDATE alert SET acknowledged_at = now() WHERE rule_id = :r AND acknowledged_at IS NULL
                      AND source_ids @> CAST(:src AS jsonb)"""), {"r": rule_id, "src": json.dumps([str(source_id)])})


def finding_confirmed(s: Session, p: Principal, finding: dict) -> UUID:
    """Link rule finding_confirmed (7A.2): only when a physician confirms, add a Condition and a `supports`
    link, derived_by human with the physician as author."""
    display = f"{shapes.LABEL_DISPLAY.get(finding['label'], finding['label'])}, pathology-confirmed"
    condition_id = s.execute(text("""
        INSERT INTO condition (patient_id, display, clinical_status, source_system, source_ref, effective_at)
        VALUES (:pid, :disp, 'active', 'asclep', :ref, now()) RETURNING id"""),
        {"pid": finding["patient_id"], "disp": display, "ref": f"Finding/{finding['id']}"}).scalar()
    s.execute(text("""
        INSERT INTO ontology_link (link_type, from_type, from_id, to_type, to_id, derived_by, created_by)
        VALUES ('supports', 'Finding', :f, 'Condition', :c, 'human', :u) ON CONFLICT DO NOTHING"""),
        {"f": finding["id"], "c": condition_id, "u": p.user_id})
    write_audit(s, p, "create", "Condition", condition_id, finding["patient_id"], reason="finding_confirmed")
    return condition_id


def conflicted_ids(s: Session, ids: list[UUID]) -> set[str]:
    """Which of these objects carry an active conflicts_with link (7A.2), for flagging them in AI context."""
    return {str(x) for x in s.execute(text("""SELECT from_id FROM ontology_link WHERE link_type = 'conflicts_with'
        AND status = 'active' AND from_id = ANY(CAST(:ids AS uuid[]))"""), {"ids": [str(i) for i in ids]}).scalars()}


def provider_names(s: Session) -> set[str]:
    """EHR source systems (spec 16 providers). Feeds such as 'asclep' or 'note-drop' are never a provider."""
    return set(s.execute(text("SELECT name FROM provider")).scalars())


def find_by_mrn(s: Session, p: Principal, mrn: str) -> dict | None:
    """Exact-MRN lookup (name and MRN only); audited, because it can reach patients off the user's team."""
    row = s.execute(text("SELECT * FROM patient WHERE lower(mrn) = lower(:m) AND record_status = 'current'"),
                    {"m": mrn}).mappings().first()
    if row:
        write_audit(s, p, "read", "PatientLookup", row["id"], row["id"], reason="mrn_lookup")
    return dict(row) if row else None
