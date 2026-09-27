"""The ONE permission dependency every route uses (spec section 13, step 2).

Usage:
    @router.get("/patients/{patient_id}/observations")
    def list_obs(patient_id: UUID, p: Principal = Depends(require("view_labs", patient_param="patient_id",
                                                                  object_type="Observation"))):
        ...

It: authenticates the JWT, checks the role matrix, checks care-team / attending relationship when a
patient is in the path, writes an audit row (allowed or denied), and returns the Principal.
Routes addressed by an object id (/findings/{id}, /slides/{id}, ...) have no patient in the path: they
look the patient up and call check_patient() themselves, so the care-team rule still applies.
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


def relationship(session: Session, user_id: UUID, patient_id: UUID) -> str | None:
    """'attending' | 'nurse' | ... from care_team_member, else 'emergency' under an active break-the-glass grant."""
    rel = session.execute(
        text("SELECT relationship FROM care_team_member WHERE user_id = :u AND patient_id = :p"),
        {"u": str(user_id), "p": str(patient_id)},
    ).scalar()
    if rel is None and session.execute(
        text("SELECT 1 FROM emergency_access WHERE user_id = :u AND patient_id = :p AND expires_at > now()"),
        {"u": str(user_id), "p": str(patient_id)},
    ).first():
        return "emergency"
    return rel


def check_patient(session: Session, principal: Principal, permission: str, patient_id: UUID | None,
                  object_type: str, action: str = "read", request_id: str | None = None,
                  object_id: UUID | None = None) -> None:
    """Role scope + care-team/attending check for one patient, with the allowed or denied audit row."""

    def deny(code: str, message: str) -> None:
        write_audit(session, principal, "deny", object_type, object_id, patient_id, reason=code, request_id=request_id)
        session.commit()  # the deny row must survive the error rollback
        raise AsclepError(code, message)

    scope = scope_for(permission, principal.role)
    if scope is None:
        deny("FORBIDDEN_ROLE", f"Your role cannot {permission.replace('_', ' ')}.")
    rel = None
    if patient_id is not None and scope in ("care_team", "attending"):
        rel = relationship(session, principal.user_id, patient_id)
        if rel is None:
            deny("FORBIDDEN_NOT_ON_CARE_TEAM", "You are not on this patient's care team.")
        if scope == "attending" and rel != "attending":  # break-the-glass never grants sign-off
            deny("FORBIDDEN_ROLE", "Only the attending physician can do this.")
    write_audit(session, principal, action, object_type, object_id, patient_id,
                reason="emergency_access" if rel == "emergency" else None, request_id=request_id)


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
        patient_id = UUID(request.path_params[patient_param]) if patient_param else None
        request_id = getattr(request.state, "request_id", None)
        if patient_id is not None:
            check_patient(session, principal, permission, patient_id, object_type or permission, action, request_id)
            return principal
        if scope_for(permission, principal.role) is None:
            raise AsclepError("FORBIDDEN_ROLE", f"Your role cannot {permission.replace('_', ' ')}.")
        if action != "read":
            write_audit(session, principal, action, object_type or permission, None, None, request_id=request_id)
        return principal

    dependency._asclep_require = permission  # marker checked by tests/test_routes_require.py
    return dependency
