"""Routes addressed by an object id (no patient in the path) still enforce the care team (spec 13, 18.5).

Dr. Wu is not on Gregory's team: reviewing Gregory's finding or opening a citation to his record is denied,
and the denial is written to the audit log.
"""
from uuid import uuid4

from app.db import get_session
from app.main import app
from tests.conftest import token

GREGORY, FINDING, CONDITION = uuid4(), uuid4(), uuid4()


class ObjectSession:
    """Serves one finding / condition row for Gregory; `rel` is the caller's care-team relationship."""

    def __init__(self, rel: str | None):
        self.rel, self.audit = rel, []

    def execute(self, stmt, params=None):
        sql, outer = str(stmt), self
        if "INSERT INTO audit_log" in sql:
            self.audit.append(params)

        class _R:
            def scalar(self):
                return outer.rel if "care_team_member" in sql else None

            def first(self):
                return None  # no break-the-glass grant

            def mappings(self):
                return self

        r = _R()
        if "FROM finding WHERE id" in sql:
            r.mappings = lambda: _Rows({"id": FINDING, "patient_id": GREGORY, "status": "pending_review",
                                        "label": "LUAD"})
        elif "FROM condition WHERE id" in sql:
            r.mappings = lambda: _Rows({"id": CONDITION, "patient_id": GREGORY, "display": "COPD",
                                        "source_system": "ehr-a", "sensitivity": "normal"})
        return r

    def commit(self):
        pass


class _Rows:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row


def _client(session):
    from fastapi.testclient import TestClient
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


def test_wu_cannot_review_gregorys_finding():
    s = ObjectSession(rel=None)
    try:
        r = _client(s).post(f"/api/v1/findings/{FINDING}/review", json={"action": "confirm"},
                            headers=token("physician"))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"
    assert s.audit and s.audit[-1]["a"] == "deny" and s.audit[-1]["p"] == str(GREGORY)


def test_nurse_on_team_still_cannot_sign():
    s = ObjectSession(rel="nurse")
    try:
        r = _client(s).post(f"/api/v1/findings/{FINDING}/review", json={"action": "confirm"}, headers=token("nurse"))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_wu_cannot_open_a_citation_to_gregorys_record():
    s = ObjectSession(rel=None)
    try:
        r = _client(s).get(f"/api/v1/sources/Condition:{CONDITION}", headers=token("physician"))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"
    assert s.audit[-1]["a"] == "deny"


def test_break_the_glass_never_grants_sign_off():
    s = ObjectSession(rel="emergency")
    try:
        r = _client(s).post(f"/api/v1/findings/{FINDING}/review", json={"action": "confirm"},
                            headers=token("physician"))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"
