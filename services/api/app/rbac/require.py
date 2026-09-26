"""The ONE permission dependency every route uses (spec section 13, step 2).

Usage:
    @router.get("/patients/{patient_id}/observations")
    def list_obs(patient_id: UUID, p: Principal = Depends(require("view_labs", patient_param="patient_id",
                                                                  object_type="Observation"))):
        ...

It: authenticates the JWT, checks the role matrix, checks care-team / attending relationship when a
patient is in the path, writes an audit row (allowed or denied), and returns the Principal.
Routes with scope 'own' or 'specimen_only' must still filter their own query results.
"""
from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.log import write_audit
from app.auth.deps import get_principal
from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.rbac.permissions import scope_for


def _relationship(session: Session, user_id: UUID, patient_id: UUID) -> str | None:
    return session.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": str(user_id), "p": str(patient_id)},
    ).scalar()


def require(
    permission: str,
    patient_param: str | None = None,
    object_type: str | None = None,
    action: str = "read",
) -> Callable[..., Principal]:
    def dependency(
        request: Request,
        principal: Principal = Depends(get_principal),
        session: Session = Depends(get_session),
    ) -> Principal:
        scope = scope_for(permission, principal.role)
        patient_id = UUID(request.path_params[patient_param]) if patient_param else None
        request_id = getattr(request.state, "request_id", None)

        def deny(code: str, message: str) -> None:
            if patient_id is not None:
                write_audit(session, principal, "deny", object_type or permission, None, patient_id,
                            reason=code, request_id=request_id)
                session.commit()  # the deny row must survive the error rollback
            raise AsclepError(code, message)

        if scope is None:
            deny("FORBIDDEN_ROLE", f"Your role cannot {permission.replace('_', ' ')}.")

        if patient_id is not None and scope in ("care_team", "attending"):
            if patient_id not in principal.emergency_patient_ids:  # break-the-glass (SHOULD)
                rel = _relationship(session, principal.user_id, patient_id)
                if rel is None:
                    deny("FORBIDDEN_NOT_ON_CARE_TEAM", "You are not on this patient's care team.")
                if scope == "attending" and rel != "attending":
                    deny("FORBIDDEN_ROLE", "Only the attending physician can do this.")

        if patient_id is not None or action != "read":
            write_audit(session, principal, action, object_type or permission, None, patient_id,
                        request_id=request_id)
        return principal

    dependency._asclep_require = permission  # marker checked by tests/test_routes_require.py
    return dependency
