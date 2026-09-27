"""LiveScribing in the Resident: mock pipeline, review rules, and validation of real-mode model replies."""
import asyncio

from fastapi.testclient import TestClient

from app import live_scribe
from app.main import app
from asclep_contracts import LiveScribeReviewRequest, ScribeObservation, TranscriptSegment

client = TestClient(app)


def test_mock_window_returns_text_only_with_session_times():
    r = client.post("/live-scribe/window", data={"session_id": "s", "window_start": "00:00:20",
                                                 "window_end": "00:00:30"},
                    files=[("frames", ("f.jpg", b"\xff\xd8", "image/jpeg")), ("audio", ("a.webm", b"x", "audio/webm"))])
    body = r.json()
    assert r.status_code == 200
    assert body["observations"][0]["t"] == "00:00:23"
    assert all("00:00:20" <= s["t"] <= "00:00:30" for s in body["transcript"])


def test_rules_flag_symptoms_said_but_skip_questions_and_negations():
    req = LiveScribeReviewRequest(session_id="s", observations=[], transcript=[
        TranscriptSegment(t="00:00:01", end="00:00:03", text="Any chest pain?"),
        TranscriptSegment(t="00:00:04", end="00:00:06", text="No fever."),
        TranscriptSegment(t="00:00:07", end="00:00:09", text="I get short of breath on the stairs."),
    ])
    actions = live_scribe.review_rules(req).actions
    assert [(a.source, a.times) for a in actions] == [("conversation", ["00:00:07"])]


def test_llm_review_drops_items_without_logged_evidence(monkeypatch):
    async def fake_chat(content, system, max_tokens):
        return {"summary": "ok", "actions": [
            {"action": "Coughed", "times": ["00:00:05"], "why_relevant": "seen", "confidence": "HIGH",
             "source": "visual"},
            {"action": "Invented", "times": ["00:09:99"], "why_relevant": "x", "confidence": "low"},
            {"times": ["00:00:05"]},  # malformed: no action text
        ]}

    monkeypatch.setattr(live_scribe, "_chat", fake_chat)
    monkeypatch.setattr(live_scribe, "confirm_actions", lambda actions, req: actions)  # agent 2 tested below
    req = LiveScribeReviewRequest(session_id="s", transcript=[], observations=[
        ScribeObservation(t="00:00:05", category="cough", text="Coughed twice", confidence=0.9)])
    result = asyncio.run(live_scribe.review_llm(req))
    assert [(a.id, a.action, a.confidence) for a in result.actions] == [("a1", "Coughed", "high")]


def test_llm_review_strips_guessed_causes(monkeypatch):
    # Real replies from Qwen3-VL-4B during testing guessed at causes despite the prompt.
    async def fake_chat(content, system, max_tokens):
        return {"summary": "Reported a three-week dry cough. Both potentially related to respiratory symptoms.",
                "actions": [
                    {"action": "dry cough", "times": ["00:01:04"], "confidence": "high", "source": "conversation",
                     "why_relevant": "Duration is clinically relevant; dry cough may indicate respiratory issue."},
                    {"action": "leaning forward", "times": ["00:00:43"], "confidence": "medium", "source": "visual",
                     "why_relevant": "Posture change may indicate discomfort or respiratory distress."},
                ]}

    monkeypatch.setattr(live_scribe, "_chat", fake_chat)
    monkeypatch.setattr(live_scribe, "confirm_actions", lambda actions, req: actions)
    req = LiveScribeReviewRequest(
        session_id="s",
        observations=[ScribeObservation(t="00:00:43", category="posture", text="Leaned forward", confidence=0.7)],
        transcript=[TranscriptSegment(t="00:01:04", end="00:01:10", text="I have had a dry cough for three weeks.")],
    )
    result = asyncio.run(live_scribe.review_llm(req))
    assert result.summary.startswith("Reported a three-week dry cough. The confirming agent checked 2")
    # The whole sentence guesses, so each falls back to neutral, observable wording.
    assert [a.why_relevant for a in result.actions] == ["Reported by the patient during the visit.",
                                                        "Seen during the visit."]


def test_vlm_frames_are_stamped_with_capture_times(monkeypatch):
    sent = {}

    async def fake_chat(content, system, max_tokens):
        sent["labels"] = [c["text"] for c in content if c["type"] == "text"]
        return {"people_in_frame": 2, "observations": [
            {"frame": 1, "category": "cough", "text": "Covered mouth and coughed", "confidence": 1.4},
            {"frame": 2, "category": "made-up", "text": "Rubbed left knee", "confidence": 0.7},
            {"frame": 0, "category": "posture", "text": "Leaned back, which may indicate fatigue.", "confidence": 0.6},
        ]}

    monkeypatch.setattr(live_scribe, "_chat", fake_chat)
    # BEFORE / PEAK / AFTER picked by the app from a 10 s window: taken at seconds 30, 34 and 38.
    obs, people = asyncio.run(live_scribe.describe_frames([b"a", b"b", b"c"], times_s=[30, 34, 38]))
    assert people == 2
    assert sent["labels"][:3] == ["frame 0 (BEFORE):", "frame 1 (PEAK MOVEMENT):", "frame 2 (AFTER):"]
    assert [(o.t, o.category, o.confidence) for o in obs] == [("00:00:34", "cough", 1.0), ("00:00:38", "other", 0.7)]
    # the guessing observation was dropped entirely


# ---------------------------------------------------------------- agent 2: the Mellea confirming agent

class _Backend:
    closed = False

    def close(self):
        self.closed = True


class _Session:
    def __init__(self):
        self.backend = _Backend()


def _candidates():
    from asclep_contracts import ScribeAction
    base = {"why_relevant": "flagger text", "confidence": "medium"}
    return [
        ScribeAction(id="a1", action="Mentioned fever", times=["00:00:36"], source="conversation", **base),
        ScribeAction(id="a2", action="Mentioned shortness of breath", times=["00:00:06"], source="conversation", **base),
        ScribeAction(id="a3", action="Rubbed chest", times=["00:00:20"], source="visual", **base),
    ]


def test_confirming_agent_drops_rejected_and_marks_the_rest(monkeypatch):
    from app import symptom_agent
    session, seen = _Session(), []

    def fake_confirm(m, candidate, source, evidence, inference):
        seen.append((candidate, source, evidence))
        return {"Mentioned fever": ("rejected", None),
                "Mentioned shortness of breath": ("confirmed", "Patient said stairs make them short of breath."),
                "Rubbed chest": ("unverified", None)}[candidate]

    monkeypatch.setattr(symptom_agent, "open_session", lambda url, model: session)
    monkeypatch.setattr(symptom_agent, "confirm", fake_confirm)
    req = LiveScribeReviewRequest(session_id="s", observations=[
        ScribeObservation(t="00:00:20", category="movement", text="Rubbed chest with right hand", confidence=0.8)],
        transcript=[TranscriptSegment(t="00:00:06", end="00:00:09", text="I get short of breath on the stairs."),
                    TranscriptSegment(t="00:00:36", end="00:00:40", text="No fevers.")])
    kept = live_scribe.confirm_actions(_candidates(), req)
    assert [(a.id, a.action, a.verification) for a in kept] == [
        ("a1", "Mentioned shortness of breath", "confirmed"), ("a2", "Rubbed chest", "unverified")]
    assert kept[0].why_relevant == "Patient said stairs make them short of breath."  # the agent's grounded reason
    assert kept[1].why_relevant == "flagger text"
    # each candidate is judged on its own evidence only
    assert seen[0] == ("Mentioned fever", "said aloud", ["[00:00:36] said: No fevers."])
    assert seen[2][2] == ["[00:00:20] seen (movement): Rubbed chest with right hand"]
    assert session.backend.closed


def test_confirm_rechecks_requirements_after_sampling(monkeypatch):
    from app import symptom_agent

    def verdict(possible, reason):
        return lambda m, **kw: symptom_agent.SymptomVerdict(possible_symptom=possible, reason=reason)

    cases = [
        (verdict(True, "Said they get short of breath on stairs."), ("confirmed", "Said they get short of breath on stairs.")),
        (verdict(False, "Patient denied fever."), ("rejected", None)),
        (verdict(True, "Chest rubbing may indicate cardiac pain."), ("unverified", None)),  # guesses a cause
        (verdict(True, " ".join(["word"] * 30)), ("unverified", None)),  # over the word limit
    ]
    for fake, expected in cases:
        monkeypatch.setattr(symptom_agent, "confirm_possible_symptom", fake)
        assert symptom_agent.confirm(None, "c", "said aloud", [], live_scribe.INFERENCE) == expected

    def down(m, **kw):
        raise ConnectionError("VLM server unreachable")

    monkeypatch.setattr(symptom_agent, "confirm_possible_symptom", down)
    assert symptom_agent.confirm(None, "c", "said aloud", [], live_scribe.INFERENCE) == ("unverified", None)


def test_requirement_checks_read_mellea_wrapped_output():
    from app import symptom_agent
    wrapped = '{"result": {"possible_symptom": true, "reason": "Said they get short of breath on stairs."}}'
    assert symptom_agent.reason_of(wrapped) == "Said they get short of breath on stairs."
    assert symptom_agent.reason_of('{"possible_symptom": false, "reason": "Denied fever."}') == "Denied fever."
    assert symptom_agent.reason_of("not json") is None
