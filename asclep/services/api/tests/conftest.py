import pytest
from fastapi.testclient import TestClient

from app.auth.security import create_token
from app.db import get_session
from app.main import app


class FakeSession:
    """Records SQL instead of hitting Postgres, so RBAC/audit logic is testable without a DB."""
    def __init__(self):
        self.statements = []

    def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params))

        class _R:
            def scalar(self_inner):
                return None  # not on any care team

            def mappings(self_inner):
                class _M:
                    def first(self):
                        return None
                return _M()
        return _R()

    def commit(self):
        pass


@pytest.fixture
def fake_session():
    s = FakeSession()
    app.dependency_overrides[get_session] = lambda: s
    yield s
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


def token(role: str, user_id: str = "00000000-0000-0000-0000-000000000001") -> dict:
    return {"Authorization": f"Bearer {create_token(user_id, role)}"}
