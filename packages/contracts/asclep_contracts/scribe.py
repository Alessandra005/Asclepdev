"""The Scribe contracts (spec section 10.5). Text only: frames never appear in any contract."""
from typing import Literal

from pydantic import BaseModel, Field

ScribeCategory = Literal[
    "mobility", "posture", "respiratory", "cough", "movement", "device_use", "interaction", "other"
]


class ScribeObservation(BaseModel):
    t: str = Field(description="Session-relative timestamp, HH:MM:SS")
    category: ScribeCategory
    text: str
    confidence: float = Field(ge=0, le=1)


class ScribeWindowResult(BaseModel):
    session_id: str
    window_start: str
    window_end: str
    observations: list[ScribeObservation]
    people_in_frame: int
    quality_flags: list[str] = []
