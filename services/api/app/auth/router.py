from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.auth.security import DUMMY_HASH, create_token, verify_password
from app.db import get_session
from app.errors import AsclepError
from app.rbac.permissions import permissions_for
from app.rbac.require import require

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginRequest, session: Session = Depends(get_session)):
    row = session.execute(
        text("SELECT id, full_name, role, password_hash, active FROM app_user WHERE email = :e"),
        {"e": body.email},
    ).mappings().first()
    # Always run bcrypt, so an unknown email takes as long as a wrong password (no account enumeration).
    ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH)
    if not row or not row["active"] or not ok:
        raise AsclepError("UNAUTHENTICATED", "Wrong email or password.")
    token = create_token(str(row["id"]), row["role"])
    return {"access_token": token, "user": {"id": str(row["id"]), "full_name": row["full_name"], "role": row["role"]}}


@router.post("/auth/refresh")
def refresh(principal: Principal = Depends(require("authenticated")), session: Session = Depends(get_session)):
    """Spec 13: 15 minutes of inactivity logs you out. The client calls this on activity for a fresh token."""
    row = session.execute(text("SELECT role, active FROM app_user WHERE id = :u"),
                          {"u": str(principal.user_id)}).mappings().first()
    if not row or not row["active"]:  # deactivated users stop getting new tokens
        raise AsclepError("UNAUTHENTICATED", "This account is no longer active.")
    return {"access_token": create_token(str(principal.user_id), row["role"])}


@router.get("/me")
def me(principal: Principal = Depends(require("authenticated"))):
    return {"user_id": str(principal.user_id), "role": principal.role, "permissions": permissions_for(principal.role)}
