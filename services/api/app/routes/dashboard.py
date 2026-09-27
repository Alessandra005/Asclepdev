"""Dashboard, tasks and alert acknowledgement (spec 12, 14.3, 15). Owner: Alessandra."""
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from app.audit.log import write_audit
from app.auth.principal import Principal
from app.config import settings
from app.db import get_session
from app.errors import AsclepError
from app.ontology import api as ontology
from app.rbac.require import require

router = APIRouter(tags=["dashboard"])

# rule -> (source shown in the strip, action label, where the action goes)
RULE_UI = {
    "CRITICAL_LAB": ("Lab result", "Review", "patient"),
    "FINDING_PENDING": ("Lab Technician", "Review", "lab"),
    "MED_BACKORDER": ("Inventory", "View", "inventory"),
    "SOURCE_CONFLICT": ("Records merge", "Review", "patient"),
    "ALLERGY_MED": ("Medication check", "Review", "patient"),
}
TASK_KINDS = ("review_finding", "sign_report", "review_transcript", "analyze_slide")  # desktop Task.kind


@router.get("/dashboard")
def dashboard(p: Principal = Depends(require("view_dashboard", object_type="Dashboard")), s=Depends(get_session)):
    """dashboard(user) view (7A.6). The strip: unacknowledged critical then warning alerts, max 5 (spec 12)."""
    uid = {"uid": p.user_id}
    alerts = s.execute(text("""
        SELECT a.id, a.patient_id, a.rule_id, a.severity, a.title, pt.given_name || ' ' || pt.family_name AS name
        FROM alert a JOIN patient pt ON pt.id = a.patient_id
        WHERE a.user_id = :uid AND a.acknowledged_at IS NULL AND a.severity IN ('critical', 'warning')
        ORDER BY CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 5"""), uid).mappings().all()
    attention = []
    for a in alerts:
        source, label, target = RULE_UI.get(a["rule_id"], ("Asclep", "Review", "patient"))
        attention.append({"id": a["id"], "patient_id": a["patient_id"], "patient_name": a["name"],
                          "problem": a["title"], "source": source, "severity": a["severity"],
                          "action_label": label, "action_target": target})

    tasks = s.execute(text("""
        SELECT t.id, t.kind, t.title, t.patient_id, pt.given_name || ' ' || pt.family_name AS name, t.created_at
        FROM task t LEFT JOIN patient pt ON pt.id = t.patient_id
        WHERE t.user_id = :uid AND t.done_at IS NULL AND t.kind = ANY(:kinds) ORDER BY t.created_at"""),
        {**uid, "kinds": list(TASK_KINDS)}).mappings().all()

    recent = s.execute(text("""
        SELECT l.patient_id, pt.given_name || ' ' || pt.family_name AS name, max(l.at) AS opened_at
        FROM audit_log l JOIN patient pt ON pt.id = l.patient_id
        WHERE l.actor_user_id = :uid AND l.actor_kind = 'human' AND l.action = 'read' AND l.object_type = 'Patient'
        GROUP BY l.patient_id, name ORDER BY opened_at DESC LIMIT 5"""), uid).mappings().all()

    supply = s.execute(text("""
        SELECT DISTINCT ON (m.id) m.name, i.on_hand, i.backordered, i.expected_restock_at
        FROM medication_request r JOIN care_team_member c ON c.patient_id = r.patient_id AND c.user_id = :uid
        JOIN medication m ON m.id = r.medication_id JOIN inventory_item i ON i.medication_id = m.id
        WHERE r.status = 'active' AND r.record_status = 'current'
          AND (i.backordered OR i.on_hand = 0 OR i.on_hand < i.reorder_point)
        ORDER BY m.id"""), uid).mappings().all()

    today = datetime.now(ZoneInfo(settings.demo_tz)).date()
    write_audit(s, p, "read", "Dashboard")
    return {
        "attention": attention,
        "schedule": ontology.appointments(s, p, day=today),
        "tasks": [{"id": t["id"], "kind": t["kind"], "title": t["title"],
                   "detail": t["name"] or "", "patient_id": t["patient_id"]} for t in tasks],
        "recent_patients": [{"patient_id": r["patient_id"], "name": r["name"], "context": "Chart opened",
                             "opened_at": r["opened_at"]} for r in recent],
        "supply_watch": [{"medication": r["name"], "on_hand": r["on_hand"], "backordered": r["backordered"],
                          "expected_restock": r["expected_restock_at"]} for r in supply],
    }


@router.post("/alerts/{alert_id}/ack")
def acknowledge_alert(alert_id: UUID, request: Request, p: Principal = Depends(require("authenticated")),
                      s=Depends(get_session)):
    """acknowledge_alert action: only the alert's recipient may acknowledge it."""
    row = s.execute(text("""UPDATE alert SET acknowledged_at = COALESCE(acknowledged_at, now())
                            WHERE id = :id AND user_id = :uid RETURNING *"""),
                    {"id": alert_id, "uid": p.user_id}).mappings().first()
    if not row:
        raise AsclepError("NOT_FOUND", "Alert not found.")
    write_audit(s, p, "update", "Alert", alert_id, row["patient_id"], request_id=request.state.request_id)
    return dict(row)


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: UUID, request: Request, p: Principal = Depends(require("authenticated")),
                  s=Depends(get_session)):
    """complete_task action: only the task's owner may complete it."""
    row = s.execute(text("""UPDATE task SET done_at = COALESCE(done_at, now())
                            WHERE id = :id AND user_id = :uid RETURNING *"""),
                    {"id": task_id, "uid": p.user_id}).mappings().first()
    if not row:
        raise AsclepError("NOT_FOUND", "Task not found.")
    write_audit(s, p, "update", "Task", task_id, row["patient_id"], request_id=request.state.request_id)
    return dict(row)
