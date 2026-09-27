"""Report and Ask (spec 10.1-10.4, 18.5): the locked-value validator and a recorded-response Gregory query.

No network: Claude and the gateway are replaced by scripted fakes, so these run in CI without a key.
"""
from types import SimpleNamespace as NS
from uuid import uuid4

import pytest

from app import ask, llm, report, validate
from asclep_contracts import AskRequest, DraftReportRequest, LockedFinding
from asclep_contracts.resident import ContextRef

SCORES = {"LUAD": 0.87, "LUSC": 0.10, "benign": 0.03}
FINDING_ID, SMOKING, COPD, ALLERGY = uuid4(), uuid4(), uuid4(), uuid4()


class FakeClaude:
    """Returns scripted replies in order; records every request."""

    def __init__(self, replies):
        self.replies, self.requests = list(replies), []
        self.messages = self

    def with_options(self, **_):
        return self

    def create(self, **kw):
        self.requests.append({**kw, "messages": list(kw["messages"])})  # snapshot: the loop appends later
        return self.replies.pop(0)

    parse = create


@pytest.fixture
def claude(monkeypatch):
    def install(replies):
        fake = FakeClaude(replies)
        monkeypatch.setattr(llm, "MOCK", False)
        monkeypatch.setattr(llm, "client", lambda: fake)
        return fake
    return install


# ------------------------------------------------------------------ validators (spec 18.5)

def test_tampered_label_fails():
    assert validate.locked_values_intact("Features favor squamous cell carcinoma.", "LUAD", SCORES)
    assert validate.locked_values_intact("Consistent with LUSC.", "LUAD", SCORES)
    assert validate.locked_values_intact("{{FINDING.LABEL}}; adenocarcinoma is common here.", "LUAD", SCORES) == []


def test_tampered_percentage_fails():
    assert validate.locked_values_intact("Model confidence 92%.", "LUAD", SCORES)
    assert validate.locked_values_intact("Model confidence 87%; next score 10 %.", "LUAD", SCORES) == []


def test_uncited_sentence_fails():
    oid = uuid4()
    assert validate.every_claim_cited("Potassium was 6.4 mmol/L this morning.")
    assert validate.every_claim_cited(f"Potassium was 6.4 mmol/L [[obj:Observation:{oid}]].") == []
    assert validate.every_claim_cited("You don't have access to that record.") == []
    assert validate.every_claim_cited("You may want to check with pathology directly.") == []  # not a claim
    assert validate.every_claim_cited("Pembrolizumab is backordered.")
    assert validate.every_claim_cited("The biopsy shows adenocarcinoma.")
    assert validate.every_claim_cited("Gregory Hale is scheduled today.", {"gregory"})
    assert validate.citations_well_formed("No findings on file [[obj:Finding:none]].")


def test_dosing_numbers_and_foreign_citations_fail():
    assert validate.no_dosing("Give pembrolizumab 200 mg every 3 weeks.")
    assert validate.no_dosing("Pembrolizumab 100 mg/4 mL is backordered.") == []
    assert validate.numbers_grounded("Restock in 6 days.", '{"expected_restock_at": "2026-10-03"}')
    assert validate.citations_resolve(f"x [[obj:Finding:{uuid4()}]]", {str(FINDING_ID)})


# ------------------------------------------------------------------ report (spec 10.1)

def report_request() -> DraftReportRequest:
    return DraftReportRequest(
        finding=LockedFinding(finding_id=FINDING_ID, label="LUAD", confidence=0.87, class_scores=SCORES,
                              model_name="CONCH", model_version="conch_ViT-B-16@hf"),
        patient_context=[ContextRef(object_type="Observation", id=SMOKING,
                                    text="Tobacco smoking status: Former smoker (40 pack-years)"),
                         ContextRef(object_type="Condition", id=COPD, text="Chronic obstructive pulmonary disease"),
                         ContextRef(object_type="Allergy", id=ALLERGY, text="Allergy: penicillin")])


def sections(first_context: str) -> NS:
    b = report.Bullet
    return NS(parsed_output=report.ReportSections(
        context=[b(text=first_context, cite=[str(SMOKING)]), b(text="COPD is on the problem list.", cite=[str(COPD)]),
                 b(text="Penicillin allergy is recorded.", cite=[str(ALLERGY)])],
        conflicts=[], considerations=["Molecular testing is commonly considered for {{FINDING.LABEL}}."]))


def test_report_retries_once_then_substitutes_locked_values(claude):
    fake = claude([sections("Former smoker, 40 pack-years; favors squamous cell carcinoma."),
                   sections("Former smoker with 40 pack-years.")])
    r = report.draft(report_request())
    assert r.locked_check_passed and r.attempts == 2
    assert "squamous" in fake.requests[1]["messages"][0]["content"]  # the problem was fed back
    assert "{{" not in r.body_md and "LUAD, model confidence 0.87" in r.body_md
    for heading in ("AI finding (unverified)", "Relevant patient context", "Conflicts or gaps",
                    "Considerations for the physician", "Requires physician review"):
        assert heading in r.body_md
    assert {str(c.id) for c in r.citations} == {str(FINDING_ID), str(SMOKING), str(COPD), str(ALLERGY)}


def test_report_rejects_malformed_citation_ids(claude):
    bad = sections("Former smoker with 40 pack-years.")
    bad.parsed_output.context[0].cite = [f"Observation:{SMOKING}"]
    claude([bad, sections("Former smoker with 40 pack-years.")])
    r = report.draft(report_request())
    assert r.attempts == 2 and "Observation:Observation" not in r.body_md


def test_report_falls_back_to_template_after_three_failures(claude):
    claude([sections("Confidence was 95%.")] * 3)
    r = report.draft(report_request())
    assert not r.locked_check_passed and r.attempts == 3
    assert "95%" not in r.body_md and "Former smoker (40 pack-years)" in r.body_md


# ------------------------------------------------------------------ Ask: the Gregory golden test (spec 10.2)

GREGORY, INVENTORY = str(uuid4()), str(uuid4())
FID = str(uuid4())
GATEWAY = {
    "find_patient": {"items": [{"id": GREGORY, "name": "Gregory Hale", "mrn": "NSO-1001", "birth_date": "1962-03-14"}]},
    "get_findings": {"items": [{"id": FID, "patient_id": GREGORY, "label": "LUAD", "confidence": 0.87,
                                "status": "pending_review", "model_name": "CONCH"}]},
    "get_inventory": {"items": [{"id": INVENTORY, "medication": "Pembrolizumab 100 mg/4 mL", "on_hand": 0,
                                 "backordered": True, "expected_restock_at": "2026-10-03T00:00:00Z"}]},
}
QUESTION = ("Gregory Hale's biopsy came back, what did it show, and if I order pembrolizumab "
            "how long until we have it?")


def tool_use(tool, **args):
    return NS(type="tool_use", id=f"tu_{tool}", name=tool, input=args)


def reply(*blocks, stop="tool_use"):
    return NS(content=list(blocks), stop_reason=stop)


def final(text):
    return reply(NS(type="text", text=text), stop="end_turn")


GOOD = (f"Gregory Hale's biopsy Finding is LUAD with model confidence 0.87, pending physician review, "
        f"not yet confirmed [[obj:Finding:{FID}]]. Pembrolizumab 100 mg/4 mL is backordered with 0 on hand; "
        f"expected restock is 2026-10-03 [[obj:Inventory:{INVENTORY}]].")  # model's type is corrected


@pytest.fixture
def gateway(monkeypatch):
    calls = []

    def fake(name, args, token):
        calls.append((name, args, token))
        return 200, GATEWAY[name]
    monkeypatch.setattr(ask, "call_gateway", fake)
    return calls


def test_gregory_query_cites_finding_and_inventory(claude, gateway):
    claude([reply(tool_use("find_patient", name="Gregory Hale")),
            reply(tool_use("get_findings", patient_id=GREGORY), tool_use("get_inventory", medication_name="pembrolizumab")),
            final(GOOD)])
    a = ask.answer(AskRequest(question=QUESTION), "Bearer user-token")
    assert a.verified
    assert {c.object_type for c in a.citations} == {"Finding", "InventoryItem"}
    assert f"[[obj:InventoryItem:{INVENTORY}]]" in a.answer_md
    assert all(token == "Bearer user-token" for *_, token in gateway)  # tools run as the user


def test_invented_citation_is_repaired_then_falls_back(claude, gateway):
    bad = final(f"The finding is LUAD [[obj:Finding:{uuid4()}]].")
    claude([reply(tool_use("get_findings", patient_id=GREGORY)), bad, bad, bad])
    a = ask.answer(AskRequest(question=QUESTION), "Bearer t")
    assert not a.verified and [str(c.id) for c in a.citations] == [FID]


def test_denied_tool_is_reported_not_guessed(claude, monkeypatch):
    monkeypatch.setattr(ask, "call_gateway", lambda *a: (403, {"error": {"code": "FORBIDDEN_NOT_ON_CARE_TEAM"}}))
    fake = claude([reply(tool_use("get_findings", patient_id=GREGORY)),
                   final("You don't have access to that record.")])
    a = ask.answer(AskRequest(question=QUESTION), "Bearer wu")
    result = fake.requests[1]["messages"][-1]["content"][0]
    assert result["is_error"] and result["content"] == "You don't have access to that record."
    assert a.verified and a.citations == []


def test_tool_calls_send_user_token_and_resident_actor(monkeypatch):
    sent = {}

    def fake_request(method, url, headers, timeout, **kw):
        sent.update(method=method, url=url, headers=headers, **kw)
        return NS(status_code=200, json=lambda: {"items": []})
    monkeypatch.setattr(ask.httpx, "request", fake_request)
    ask.call_gateway("get_inventory", {"medication_name": "pembrolizumab"}, "Bearer u")
    assert sent["url"].endswith("/inventory") and sent["params"] == {"q": "pembrolizumab"}
    assert sent["headers"] == {"X-Actor-Kind": "resident", "Authorization": "Bearer u"}


def test_search_results_are_citable_by_type_and_id():
    note = str(uuid4())
    seen = {}
    ask.collect({"items": [{"citation": {"id": f"Note:{note}", "kind": "note", "label": "CT chest note",
                                         "object_id": note}, "text": "chest x-ray ...", "score": 0.82}],
                 "next_cursor": None}, "Chunk", seen)
    assert seen == {note: ("Note", "CT chest note")}
