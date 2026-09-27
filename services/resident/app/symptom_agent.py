"""The confirming agent (Mellea). Owner: Brandon.

LiveScribing review is two agents:
  1. the flagger (live_scribe.review_llm) proposes candidate possible symptoms from the visit logs
  2. this agent re-reads each candidate against ONLY its own logged evidence and confirms or rejects it

Built as a Mellea @generative function (spec: "Mellea @generative functions with the requirements in 10.4/10.5")
with programmatic requirements and rejection sampling. Every check is re-run here after sampling, because
Mellea returns its first attempt when the loop budget runs out without a passing sample.
Runs on the local VLM server (VLM_URL); Mellea telemetry stays off unless OTEL_* env vars are set.
"""
import json
import re
from typing import Literal

from mellea import generative, req, simple_validate, start_session
from mellea.backends.model_options import ModelOption
from mellea.stdlib.sampling import RejectionSamplingStrategy
from pydantic import BaseModel, ValidationError

MAX_REASON_WORDS = 20
LOOP_BUDGET = 2  # one retry: each call is ~6-8 s on a laptop GPU

Verification = Literal["confirmed", "rejected", "unverified"]


class SymptomVerdict(BaseModel):
    possible_symptom: bool
    reason: str


@generative
def confirm_possible_symptom(candidate: str, source: str, evidence: list[str]) -> SymptomVerdict:
    """Decide whether a behavior flagged during a clinic visit is a possible symptom the doctor should see.

    `candidate` is the flagged behavior, `source` says whether it was seen on camera or said aloud, and
    `evidence` holds the timestamped log lines it was flagged from (vision notes about the patient and
    speech-to-text of the visit, speakers not labeled).

    Set possible_symptom to True only when the evidence itself shows the behavior and a clinician would note
    it: pain, breathing difficulty, coughing, fatigue, weight change, dizziness, bleeding, trembling, wincing,
    holding or rubbing a body part, slumping. Set it to False for ordinary gestures and posture, normal
    talking, the doctor's own questions, and anything the patient denied ("no fever").

    `reason` states in plain words what was seen or said. It never diagnoses and never guesses a cause.
    """
    ...


def reason_of(output: str) -> str | None:
    """The verdict's reason from raw model output. @generative wraps the return value as {"result": ...}."""
    try:
        data = json.loads(output)
        return SymptomVerdict.model_validate(data.get("result", data)).reason
    except (ValueError, ValidationError, AttributeError):
        return None


def requirements(inference: re.Pattern[str]) -> list:
    """Checked in code after every sample; failing ones send the model back for another try."""

    def parses(out: str) -> tuple[bool, str]:
        return reason_of(out) is not None, "Reply with the JSON object only."

    def observable(out: str) -> tuple[bool, str]:
        reason = reason_of(out) or ""
        return not inference.search(reason), "Describe what was seen or said; do not guess a cause or diagnose."

    def short(out: str) -> tuple[bool, str]:
        return len((reason_of(out) or "").split()) <= MAX_REASON_WORDS, f"Keep reason under {MAX_REASON_WORDS} words."

    return [
        req("The output is the JSON verdict.", validation_fn=simple_validate(parses)),
        req("reason describes only what was seen or said; it never diagnoses or guesses a cause.",
            validation_fn=simple_validate(observable)),
        req(f"reason is at most {MAX_REASON_WORDS} words.", validation_fn=simple_validate(short)),
    ]


def open_session(vlm_url: str, model: str):
    return start_session("openai", model, base_url=vlm_url, api_key="local", model_options={
        ModelOption.TEMPERATURE: 0.2, ModelOption.MAX_NEW_TOKENS: 120, ModelOption.THINKING: False,
    })


def confirm(m, candidate: str, source: str, evidence: list[str],
            inference: re.Pattern[str]) -> tuple[Verification, str | None]:
    """Returns the verdict and, when confirmed, the agent's observable-only reason."""
    try:
        v = confirm_possible_symptom(m, candidate=candidate, source=source, evidence=evidence,
                                     requirements=requirements(inference),
                                     strategy=RejectionSamplingStrategy(loop_budget=LOOP_BUDGET))
    except Exception:  # model down, unparsable reply after retries: the doctor still sees it, marked unverified
        return "unverified", None
    reason = v.reason.strip()
    if not reason or inference.search(reason) or len(reason.split()) > MAX_REASON_WORDS:
        return "unverified", None  # requirements still unmet after the loop budget
    return ("confirmed", reason) if v.possible_symptom else ("rejected", None)
