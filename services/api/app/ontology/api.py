"""The ontology API: the ONLY door to clinical data (spec section 7A.8)."""
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import yaml
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.log import write_audit
from app.auth.principal import Principal
from app.rbac.permissions import scope_for
from asclep_contracts import ContextView, ContextItem
from asclep_contracts.ontology import SubjectRef

_REGISTRY = yaml.safe_load((Path(__file__).parent / "registry.yaml").read_text())
_VIEWS = yaml.safe_load((Path(__file__).parent / "views.yaml").read_text())
_CODE_GROUPS = yaml.safe_load((Path(__file__).parent / "code_groups.yaml").read_text())


class Filters(BaseModel):
    since: str | None = None
    category: str | None = None
    code_group: str | None = None
    status: str | None = None


def _table_for(type_: str) -> str:
    entry = _REGISTRY["object_types"].get(type_)
    if not entry:
        raise ValueError(f"Unknown object type: {type_}")
    return entry["table"]


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
        else:
            # specimen_only (lab_staff) or no scope at all: deny-by-default until
            # a real specimen-assignment join exists.
            # TODO(Alessandra): wire specimen_only properly once specimen assignment exists.
            conditions.append("1=0")

    if filters:
        if filters.status:
            conditions.append("clinical_status = :status" if type == "Condition" else "status = :status")
            params["status"] = filters.status
        if filters.category and type == "Observation":
            conditions.append("category = :category")
            params["category"] = filters.category
        if filters.code_group:
            codes = _CODE_GROUPS.get(filters.code_group, {})
            all_codes = [c for group in codes.values() for c in group]
            if all_codes:
                conditions.append("(loinc_code = ANY(:codes) OR code = ANY(:codes))")
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
        conditions = ["patient_id = :pid"]
        params: dict = {"pid": patient_id}

        filt = include.get("filter", {})
        if "code_group" in filt:
            groups = filt["code_group"] if isinstance(filt["code_group"], list) else [filt["code_group"]]
            all_codes = [c for g in groups for group in _CODE_GROUPS.get(g, {}).values() for c in group]
            if all_codes:
                conditions.append("(loinc_code = ANY(:codes) OR code = ANY(:codes))")
                params["codes"] = all_codes
        if "status" in filt:
            conditions.append("clinical_status = :status" if itype == "Condition" else "status = :status")
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
            except (KeyError, ValueError):
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
    raise NotImplementedError("Alessandra: pgvector search — deferred until chunk table is populated")


def apply_action(s: Session, p: Principal, action: str, payload: BaseModel) -> dict:
    if action == "ingest_bundle":
        from app.ingest.pipeline import ingest_bundle
        return ingest_bundle(s, p, payload)
    raise NotImplementedError(f"Alessandra: action '{action}' not implemented yet")