"""Auth hardening: no account enumeration, token refresh, no echoed input, spec-shaped 500s."""
from fastapi.testclient import TestClient

from app.auth import router as auth_router
from app.auth.security import decode_token, hash_password
from app.db import get_session
from app.main import app
from tests.conftest import token

USER_ID = "00000000-0000-0000-0000-000000000001"


class UserSession:
    def __init__(self, active: bool = True):
        self.row = {"id": USER_ID, "full_name": "Dr. Maya Reyes", "role": "physician", "active": active,
                    "password_hash": hash_password("right")}

    def execute(self, stmt, params=None):
        row = self.row if "FROM app_user" in str(stmt) else None

        class _R:
            def mappings(self):
                class _M:
                    def first(self):
                        return row
                return _M()

            def scalar(self):
                return None
        return _R()

    def commit(self):
        pass


def _with(session):
    app.dependency_overrides[get_session] = lambda: session


def test_unknown_email_still_runs_bcrypt(client, fake_session, monkeypatch):
    seen = []
    monkeypatch.setattr(auth_router, "verify_password", lambda pw, h: seen.append(h) or False)
    r = client.post("/api/v1/auth/login", json={"email": "nobody@x", "password": "pw"})
    assert r.status_code == 401
    assert seen == [auth_router.DUMMY_HASH]


def test_login_and_refresh(client):
    _with(UserSession())
    try:
        r = client.post("/api/v1/auth/login", json={"email": "reyes@asclep.demo", "password": "right"})
        assert r.status_code == 200
        r = client.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
        assert r.status_code == 200
        assert decode_token(r.json()["access_token"])["sub"] == USER_ID
    finally:
        app.dependency_overrides.clear()


def test_refresh_refused_for_deactivated_user(client):
    _with(UserSession(active=False))
    try:
        r = client.post("/api/v1/auth/refresh", headers=token("physician", USER_ID))
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_validation_error_does_not_echo_password(client):
    r = client.post("/api/v1/auth/login", json={"password": "hunter2-secret"})
    assert r.status_code == 422
    assert "hunter2-secret" not in r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unhandled_error_uses_spec_envelope(fake_session, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db exploded: secret detail")
    monkeypatch.setattr(auth_router, "permissions_for", boom)
    r = TestClient(app, raise_server_exceptions=False).get("/api/v1/me", headers=token("physician"))
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL"
    assert "secret detail" not in r.text
