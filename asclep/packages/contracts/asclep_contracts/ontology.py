"""Ontology layer contracts (spec section 7A)."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RawRecord(BaseModel):
    """Every adapter returns a list of these (7A.3)."""
    source_system: str
    source_ref: str
    resource_type: str
    payload: dict
    fetched_at: datetime
    source_patient_ref: str | None = None


class ContextItem(BaseModel):
    type: str
    id: UUID
    title: str
    effective_at: datetime | None = None
    source_system: str
    flags: list[str] = []
    links: list[dict] = []


class SubjectRef(BaseModel):
    type: str
    id: UUID


class ContextView(BaseModel):
    """Identical shape for every view (7A.6). `omitted` is REQUIRED: selective never means hidden."""
    view: str
    subject: SubjectRef
    generated_at: datetime
    items: list[ContextItem]
    facts: dict = {}
    omitted: dict[str, int]
    sources: list[dict] = []
