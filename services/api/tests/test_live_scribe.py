"""LiveScribing routes: Mongo persistence, the doctor's action checks, RBAC and upstream failures."""
from datetime import date

import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app.db import get_session
from app.live_scribe.store import get_store
from app.main import app
from app.routes import live_scribe
from tests.conftest import token

PID = "6f1c2a10-0000-4000-8000-000000000001"
BASE = f"/api/v1/patients/{PID}/live-scribe-sessions"
GREGORY = {"id": PID, "mrn": "NS-004417", "given_name": "Gregory", "family_name": "Hale",
           "birth_date": date(1962, 3, 14), "sex": "M", "source_system": "ehr-b"}


class ScribeSession:
    """Answers the few SQL queries these routes make; records audit inserts."""

    def __init__(self, relationship: str | None = "attending"):
        self.relationship = relationship
        self.audit = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "INSERT INTO audit_log" in sql:
            self.audit.append(params)
        outer = self

        class _R:
            def scalar(self):
                if "care_team_member" in sql:
                    return outer.relationship
                if "app_user" in sql:
                    return "Dr. Maya Reyes"
                return None

            def mappings(self):
                class _M:
                    def first(self):
                        return GREGORY if "FROM patient" in sql else None
                return _M()
        return _R()

    def commit(self):
        pass


class FakeStore:
    def __init__(self, down: bool = False):
        self.patients, self.sessions, self.down = {}, {}, down

    def _check(self):
        if self.down:
            raise ServerSelectionTimeoutError("mongo is down")

    def upsert_patient(self, doc):
        self._check()
        self.patients[doc["_id"]] = doc

    def create_session(self, doc):
        self._check()
        self.sessions[doc["_id"]] = {**doc}

    def get_session(self, sid):
        self._check()
        return self.sessions.get(sid)

    def list_sessions(self, pid):
        return [d for d in self.sessions.values() if d["patient_id"] == pid]

    def append_window(self, sid, observations, transcript):
        d = self.sessions[sid]
        d["observations"] = d["observations"] + observations
        d["transcript"] = d["transcript"] + transcript
        d["windows_analyzed"] += 1

    def update_session(self, sid, fields):
        self.sessions[sid].update(fields)


WINDOW = {
    "session_id": "x", "window_start": "00:00:20", "window_end": "00:00:30", "people_in_frame": 1,
    "observations": [{"t": "00:00:23", "category": "cough", "text": "Coughed 3 times", "confidence": 0.9}],
    "transcript": [{"t": "00:00:25", "end": "00:00:29", "text": "Some chest pain when I cough."}],
}
REVIEW = {"summary": "Cough seen; chest pain mentioned.", "actions": [
    {"id": "a1", "action": "Coughed 3 times", "times": ["00:00:23"], "why_relevant": "Coughing seen.",
     "confidence": "high", "source": "visual"},
    {"id": "a2", "action": "Mentioned chest pain", "times": ["00:00:25"], "why_relevant": "Patient-reported.",
     "confidence": "medium", "source": "conversation"},
]}


@pytest.fixture
def world(monkeypatch):
    sql, store, calls = ScribeSession(), FakeStore(), []

    def fake_resident(path, **kwargs):
        calls.append((path, kwargs))
        return WINDOW if path.endswith("/window") else REVIEW

    monkeypatch.setattr(live_scribe, "_resident", fake_resident)
    app.dependency_overrides[get_session] = lambda: sql
    app.dependency_overrides[get_store] = lambda: store
    yield sql, store, calls
    app.dependency_overrides.clear()


def _start(client, role="physician"):
    return client.post(BASE, json={"consent_ref": "verbal-2026-09-26-mr"}, headers=token(role))


def test_full_flow_stores_conversation_and_only_checked_actions(client, world):
    sql, store, calls = world
    r = _start(client)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert store.patients[PID]["name"] == "Gregory Hale"  # patient info copied into Mongo
    assert store.sessions[sid]["patient"]["mrn"] == "NS-004417"

    r = client.post(f"{BASE}/{sid}/window",
                    data={"window_start": "00:00:20", "window_end": "00:00:30", "frame_times": "00:00:23"},
                    files=[("frames", ("f0.jpg", b"\xff\xd8jpeg", "image/jpeg")),
                           ("audio", ("a.webm", b"opus", "audio/webm"))], headers=token("physician"))
    assert r.status_code == 200, r.text
    sent = calls[0][1]["files"]
    assert [name for name, _ in sent] == ["frames", "audio"]  # media forwarded to the Resident
    assert calls[0][1]["data"]["frame_times"] == "00:00:23"  # capture times reach the Resident
    assert store.sessions[sid]["transcript"][0]["text"] == "Some chest pain when I cough."
    assert "frames" not in store.sessions[sid] and "audio" not in store.sessions[sid]  # never persisted

    r = client.post(f"{BASE}/{sid}/stop", headers=token("physician"))
    assert r.json()["status"] == "review"
    assert [a["included"] for a in r.json()["actions"]] == [False, False]  # doctor decides

    r = client.get(f"{BASE}/{sid}", headers=token("physician"))
    assert r.json()["counts"] == {"observations": 1, "transcript": 1, "actions": 2}

    r = client.post(f"{BASE}/{sid}/report", json={"included_action_ids": ["a2"]}, headers=token("physician"))
    assert r.status_code == 200, r.text
    body = r.json()["report"]["body"]
    assert "Mentioned chest pain" in body and "Coughed 3 times" not in body
    assert [a["included"] for a in store.sessions[sid]["actions"]] == [False, True]

    r = client.post(f"{BASE}/{sid}/review", json={"action": "accept"}, headers=token("physician"))
    assert r.json()["status"] == "accepted" and r.json()["report"]["status"] == "final"
    assert r.json()["report"]["reviewed_by_name"] == "Dr. Maya Reyes"
    assert len(sql.audit) >= 6  # one audit row per call (spec 13)

    r = client.get(BASE, headers=token("physician"))
    assert [s["id"] for s in r.json()["items"]] == [sid]


def test_nurse_can_scribe_but_not_build_the_report(client, world):
    sid = _start(client, "nurse").json()["id"]
    client.post(f"{BASE}/{sid}/stop", headers=token("nurse"))
    r = client.post(f"{BASE}/{sid}/report", json={"included_action_ids": []}, headers=token("nurse"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_not_on_care_team_cannot_start(client, world):
    world[0].relationship = None
    r = _start(client)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"


def test_window_after_stop_is_conflict(client, world):
    sid = _start(client).json()["id"]
    client.post(f"{BASE}/{sid}/stop", headers=token("physician"))
    r = client.post(f"{BASE}/{sid}/window", data={"window_start": "00:00:30", "window_end": "00:00:40"},
                    headers=token("physician"))
    assert r.status_code == 409


def test_unknown_action_id_is_rejected(client, world):
    sid = _start(client).json()["id"]
    client.post(f"{BASE}/{sid}/stop", headers=token("physician"))
    r = client.post(f"{BASE}/{sid}/report", json={"included_action_ids": ["a9"]}, headers=token("physician"))
    assert r.status_code == 422


def test_resident_down_keeps_session_active(client, world, monkeypatch):
    sql, store, _ = world
    sid = _start(client).json()["id"]

    def down(path, **kwargs):
        raise live_scribe.AsclepError("UPSTREAM_UNAVAILABLE", "The Scribe model is not responding. Try again.")

    monkeypatch.setattr(live_scribe, "_resident", down)
    r = client.post(f"{BASE}/{sid}/stop", headers=token("physician"))
    assert r.status_code == 502 and store.sessions[sid]["status"] == "active"  # stop can be retried


def test_mongo_down_is_502_in_spec_format(client, world):
    app.dependency_overrides[get_store] = lambda: FakeStore(down=True)
    r = _start(client)
    assert r.status_code == 502 and r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
