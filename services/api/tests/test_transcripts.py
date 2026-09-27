"""Transcript routes: provider keys, and spec error codes instead of 500s."""
from uuid import uuid4

import pytest

from app.ingest import transcript
from app.routes import transcripts as routes
from tests.conftest import token

RIVERSIDE = uuid4()


class ProviderSession:
    def execute(self, stmt, params=None):
        class _R:
            def scalar(self):
                return RIVERSIDE if params and params.get("n") == "ehr-a" else None
        return _R()


def test_provider_key_or_uuid():
    s = ProviderSession()
    assert transcript.resolve_provider_id(s, "Riverside") == RIVERSIDE
    assert transcript.resolve_provider_id(s, str(RIVERSIDE)) == RIVERSIDE
    with pytest.raises(LookupError):
        transcript.resolve_provider_id(s, "mars")


@pytest.mark.parametrize("exc, status", [(ValueError("already merged"), 409), (OSError("ehr-a down"), 502),
                                         (LookupError("no such request"), 404)])
def test_consent_errors_map_to_spec_codes(client, fake_session, monkeypatch, exc, status):
    def boom(*a, **k):
        raise exc
    monkeypatch.setattr(routes, "apply_action", boom)
    r = client.post(f"/api/v1/transcripts/{uuid4()}/consent", json={"consent_ref": "Signed form #2231", "granted": True},
                    headers=token("admin"))
    assert r.status_code == status, r.text


def test_break_the_glass_grant_can_read_transcripts(client, fake_session):
    """Access is decided once, by require(): an emergency grant (no care-team row) reads the transcript list."""
    from app.db import get_session
    from app.main import app
    from tests.conftest import FakeSession

    class Emergency(FakeSession):
        def execute(self, stmt, params=None):
            result = super().execute(stmt, params)
            if "FROM emergency_access" in str(stmt):
                result.first = lambda: (1,)  # an active grant
            return result

    app.dependency_overrides[get_session] = lambda: Emergency()
    r = client.get(f"/api/v1/patients/{uuid4()}/transcripts", headers=token("physician"))
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}


def test_nurse_on_the_care_team_reads_transcripts(client):
    from app.db import get_session
    from app.main import app
    from tests.conftest import FakeSession

    class OnTeam(FakeSession):
        def execute(self, stmt, params=None):
            result = super().execute(stmt, params)
            if "FROM care_team_member" in str(stmt):
                result.scalar = lambda: "nurse"
            return result

    app.dependency_overrides[get_session] = lambda: OnTeam()
    try:
        r = client.get(f"/api/v1/patients/{uuid4()}/transcripts", headers=token("nurse"))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}
