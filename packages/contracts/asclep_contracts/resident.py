"""Resident contracts: report drafting and Ask (spec sections 10.1 to 10.4)."""
from uuid import UUID

from pydantic import BaseModel

from .lab import SubtypeLabel


class Citation(BaseModel):
    object_type: str
    id: UUID
    label: str | None = None


class LockedFinding(BaseModel):
    """Values the Resident may NEVER alter. Inserted via {{FINDING.*}} placeholders."""
    finding_id: UUID
    label: SubtypeLabel
    confidence: float
    class_scores: dict[SubtypeLabel, float]
    model_name: str
    model_version: str
    flags: list[str] = []


class ContextRef(BaseModel):
    object_type: str
    id: UUID
    text: str


class DraftReportRequest(BaseModel):
    finding: LockedFinding
    patient_context: list[ContextRef]
    locked_facts: dict = {}


class DraftReport(BaseModel):
    body_md: str
    citations: list[Citation]
    locked_check_passed: bool
    attempts: int = 1


class AskRequest(BaseModel):
    question: str
    patient_id: UUID | None = None
    conversation_id: str | None = None


class AskAnswer(BaseModel):
    answer_md: str
    citations: list[Citation]
    conversation_id: str | None = None
    verified: bool = True  # False when the Mellea loop exhausted its budget
