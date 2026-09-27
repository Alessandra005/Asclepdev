"""Alert routes (spec section 12, 15)."""
from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.auth.principal import Principal
from app.db import get_session
from app.rbac.require import require

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
def list_my_alerts(p: Principal = Depends(require("authenticated")), s=Depends(get_session)):
    """Spec 15: any role sees its own unacknowledged alerts. The dashboard strip (not this list) caps at 5."""
    rows = s.execute(
        text("""SELECT * FROM alert WHERE user_id = :uid AND acknowledged_at IS NULL
                ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC"""),
        {"uid": p.user_id},
    ).mappings().all()
    return {"items": [dict(r) for r in rows], "next_cursor": None}