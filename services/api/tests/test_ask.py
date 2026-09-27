from uuid import uuid4

from app.routes import clinical
from asclep_contracts import AskAnswer, Citation
from tests.conftest import token

SEEN, HIDDEN = uuid4(), uuid4()


def test_ask_keeps_only_tokens_whose_citation_the_user_can_open(client, fake_session, monkeypatch):
    sent = {}

    def fake_post(url, payload, model, what, headers=None):
        sent.update(headers=headers)
        return AskAnswer(answer_md=f"LUAD, pending review [[obj:Finding:{SEEN}]]. Other [[obj:Note:{HIDDEN}]].",
                         citations=[Citation(object_type="Note", id=HIDDEN)], conversation_id="c1", verified=True)

    monkeypatch.setattr(clinical, "_post", fake_post)
    monkeypatch.setattr(clinical, "_cited", lambda s, p, cid, pid: {"id": cid} if cid == f"Finding:{SEEN}" else None)
    r = client.post("/api/v1/ask", json={"question": "What did Gregory's biopsy show?"}, headers=token("physician"))
    assert r.status_code == 200
    body = r.json()
    assert body["answer_md"] == f"LUAD, pending review [[obj:Finding:{SEEN}]]. Other ."
    assert [c["id"] for c in body["citations"]] == [f"Finding:{SEEN}"]
    assert body["conversation_id"] == "c1" and body["verified"] is True
    assert sent["headers"]["Authorization"].startswith("Bearer ")  # the Resident acts with the user's own token


def test_ask_is_denied_for_roles_without_use_ask(client, fake_session):
    r = client.post("/api/v1/ask", json={"question": "hi"}, headers=token("admin"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_can_read_follows_role_and_care_team(fake_session):
    from app.auth.principal import Principal
    doc = Principal(user_id=uuid4(), role="physician")
    assert not clinical._can_read(fake_session, doc, "Finding", {"id": SEEN, "patient_id": uuid4()})  # off team
    assert clinical._can_read(fake_session, doc, "InventoryItem", {"id": SEEN})  # no patient: role scope 'all'
    assert not clinical._can_read(fake_session, Principal(uuid4(), "scribe"), "InventoryItem", {"id": SEEN})


def test_unverified_answer_is_audited_as_validation_failure(client, fake_session, monkeypatch):
    monkeypatch.setattr(clinical, "_post", lambda *a, **k: AskAnswer(answer_md="x", citations=[], verified=False))
    client.post("/api/v1/ask", json={"question": "q"}, headers=token("nurse"))
    audits = [params for sql, params in fake_session.statements if "INSERT INTO audit_log" in sql]
    assert audits[-1]["r"] == "resident_validation_failed" and audits[-1]["k"] == "resident"


def test_source_bodies_state_only_what_the_row_says() -> None:
    from datetime import datetime

    from app.ontology import shapes
    obs = {"display": "Glucose", "value_num": 110.0, "unit": "mg/dL", "ref_low": 70.0, "ref_high": 99.0,
           "interpretation": "H", "loinc_code": "2345-7", "source_system": "ehr-a"}
    assert shapes.body("Observation", obs) == "Glucose: 110.0 mg/dL (ref 70–99, flag H, LOINC 2345-7). Recorded by Riverside."
    bare = {**obs, "ref_low": None, "ref_high": None, "interpretation": None, "loinc_code": None}
    assert shapes.body("Observation", bare) == "Glucose: 110.0 mg/dL. Recorded by Riverside."  # no invented "normal"
    spec = {"site": "Lung biopsy", "accession": "NSO-GH-2026-001", "collected_at": datetime(2026, 9, 24)}
    assert shapes.title("Specimen", spec) == "Lung biopsy · NSO-GH-2026-001 · collected Sep 24, 2026"
    assert shapes.title("Specimen", {"accession": "NSO-GH-2026-001"}) == "NSO-GH-2026-001"
