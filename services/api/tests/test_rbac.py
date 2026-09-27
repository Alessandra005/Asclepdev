from tests.conftest import token

PID = "11111111-1111-1111-1111-111111111111"


def test_missing_token_is_401_in_spec_format(client, fake_session):
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "UNAUTHENTICATED" and body["request_id"].startswith("req_")


def test_role_without_permission_is_denied_and_audited(client, fake_session):
    r = client.get(f"/api/v1/patients/{PID}/summary", headers=token("lab_staff"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"
    assert any("INSERT INTO audit_log" in sql for sql, _ in fake_session.statements)


def test_not_on_care_team_is_denied(client, fake_session):
    r = client.get(f"/api/v1/patients/{PID}/summary", headers=token("physician"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"


def test_me_lists_permissions(client, fake_session):
    r = client.get("/api/v1/me", headers=token("nurse"))
    assert r.status_code == 200
    assert "start_scribe" in r.json()["permissions"]
    assert "review_findings" not in r.json()["permissions"]


def test_slides_need_care_team(client, fake_session):
    r = client.get(f"/api/v1/patients/{PID}/slides", headers=token("physician"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"


def test_slides_are_for_whoever_runs_the_lab_technician(client, fake_session):
    r = client.get(f"/api/v1/patients/{PID}/slides", headers=token("nurse"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"
    r = client.get(f"/api/v1/patients/{PID}/slides", headers=token("lab_staff"))  # specimen_only: no care team needed
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}
