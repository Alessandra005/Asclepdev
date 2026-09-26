from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.auth.security import create_token, verify_password
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
    if not row or not row["active"] or not verify_password(body.password, row["password_hash"]):
        raise AsclepError("UNAUTHENTICATED", "Wrong email or password.")
    token = create_token(str(row["id"]), row["role"])
    return {"access_token": token, "user": {"id": str(row["id"]), "full_name": row["full_name"], "role": row["role"]}}


@router.get("/me")
def me(principal: Principal = Depends(require("authenticated"))):
    return {"user_id": str(principal.user_id), "role": principal.role, "permissions": permissions_for(principal.role)}
