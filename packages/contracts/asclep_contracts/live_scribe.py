"""LiveScribing contracts: the Scribe plus the visit conversation. Owner: Brandon.

SPEC-QUESTION(Ron): additive module, not yet in spec 10.5. Spec 10.5 is camera-only; LiveScribing also
transcribes the visit on this machine. Raw frames and audio never appear in any contract: text only.
"""
from typing import Literal

from pydantic import BaseModel, Field

from .scribe import ScribeObservation

Confidence = Literal["low", "medium", "high"]
ActionSource = Literal["visual", "sound", "conversation"]


class TranscriptSegment(BaseModel):
    t: str = Field(description="Session-relative start, HH:MM:SS")
    end: str = Field(description="Session-relative end, HH:MM:SS")
    text: str


class ScribeAction(BaseModel):
    """A possible symptom worth the doctor's attention. Observed behavior or what was said, never a diagnosis."""
    id: str
    action: str
    times: list[str] = Field(description="Session-relative timestamps of the supporting evidence")
    why_relevant: str
    confidence: Confidence
    source: ActionSource


class LiveScribeWindowResult(BaseModel):
    session_id: str
    window_start: str
    window_end: str
    observations: list[ScribeObservation]
    transcript: list[TranscriptSegment]
    people_in_frame: int
    quality_flags: list[str] = []


class LiveScribeReviewRequest(BaseModel):
    session_id: str
    observations: list[ScribeObservation]
    transcript: list[TranscriptSegment]


class LiveScribeReviewResult(BaseModel):
    actions: list[ScribeAction]
    summary: str
