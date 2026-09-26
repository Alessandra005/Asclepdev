from uuid import UUID

from fastapi import Header

from app.auth.principal import Principal
from app.auth.security import decode_token
from app.errors import AsclepError


def get_principal(
    authorization: str | None = Header(default=None),
    x_actor_kind: str | None = Header(default=None),
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AsclepError("UNAUTHENTICATED", "Missing bearer token.")
    try:
        claims = decode_token(authorization.split(" ", 1)[1])
    except Exception as exc:  # expired, bad signature, malformed
        raise AsclepError("UNAUTHENTICATED", "Invalid or expired token.") from exc
    # The Resident calls tools with the user's token and sets X-Actor-Kind: resident (spec 10.2, 13)
    actor = "resident" if x_actor_kind == "resident" else "human"
    return Principal(user_id=UUID(claims["sub"]), role=claims["role"], actor_kind=actor)
