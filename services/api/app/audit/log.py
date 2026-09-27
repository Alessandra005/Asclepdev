"""Append-only audit log writer (spec sections 7 and 13). Never logs content, only who/what/when."""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal


def write_audit(
    session: Session,
    principal: Principal | None,
    action: str,  # read | create | update | sign | deny
    object_type: str,
    object_id: UUID | None = None,
    patient_id: UUID | None = None,
    reason: str | None = None,
    request_id: str | None = None,
    ai: str | None = None,  # 'resident' | 'lab_tech' | 'scribe': an AI step acting for principal
    ran_on: str | None = None,  # 'local' | 'anthropic_api': where that AI step ran
) -> None:
    kind = ai or (principal.actor_kind if principal else "system")
    session.execute(
        text(
            "INSERT INTO audit_log (actor_user_id, actor_kind, on_behalf_of_user_id, ran_on, action, object_type, "
            "object_id, patient_id, reason, request_id) VALUES (:u, :k, :b, :ro, :a, :t, :o, :p, :r, :q)"
        ),
        {
            "u": str(principal.user_id) if principal else None,
            "k": kind,
            # spec 13: AI reads record the human user the AI acted for
            "b": str(principal.user_id) if principal and kind not in ("human", "system") else None,
            "ro": ran_on,
            "a": action,
            "t": object_type,
            "o": str(object_id) if object_id else None,
            "p": str(patient_id) if patient_id else None,
            "r": reason,
            "q": request_id,
        },
    )
