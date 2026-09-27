from uuid import uuid4

from app.ontology import index
from tests.conftest import token

PID = "11111111-1111-1111-1111-111111111111"


def test_chunks_are_800_chars_with_100_overlap() -> None:
    body = "x" * 1500
    parts = index.chunks(body)
    assert [len(c) for c in parts] == [800, 800] and parts[1] == body[700:1500]
    assert index.chunks("short") == ["short"]


def test_index_writes_one_chunk_per_piece_and_skips_drafts(fake_session, monkeypatch) -> None:
    monkeypatch.setattr(index, "embed", lambda texts: [[0.1] * 384 for _ in texts])
    note = {"id": uuid4(), "patient_id": uuid4(), "kind": "shadowing", "body": "Breathing faster when walking."}
    assert index.index_object(fake_session, "Note", note) == 1
    assert "CAST(:v AS vector)" in fake_session.statements[-1][0]
    assert index.index_object(fake_session, "Note", {**note, "kind": "visual_scribe"}) == 0
    assert index.index_object(fake_session, "Observation", {"id": uuid4(), "display": "Glucose"}) == 0  # no text


def test_search_without_the_embed_extra_returns_nothing(fake_session, monkeypatch) -> None:
    monkeypatch.setattr(index, "embed", lambda texts: None)
    assert index.search(fake_session, uuid4(), "breathing", None) == []


def test_search_is_limited_to_the_users_patients(monkeypatch) -> None:
    class Recorder:  # returns no rows, keeps the SQL
        sql = ""

        def execute(self, stmt, params=None):
            Recorder.sql = str(stmt)
            return type("R", (), {"mappings": lambda self: type("M", (), {"all": lambda self: []})()})()

    monkeypatch.setattr(index, "embed", lambda texts: [[0.1] * 384])
    assert index.search(Recorder(), uuid4(), "breathing", None) == []
    assert "care_team_member" in Recorder.sql and "emergency_access" in Recorder.sql


def test_search_for_a_patient_off_the_care_team_is_denied(client, fake_session) -> None:
    r = client.post("/api/v1/search", json={"query": "breathing", "patient_id": PID}, headers=token("physician"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_NOT_ON_CARE_TEAM"
