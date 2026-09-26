"""Shared shapes used by every endpoint (spec section 15)."""
from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")

SourceSystem = str  # 'ehr-a' | 'ehr-b' | 'asclep' | 'lab-tech' | 'resident' | 'inventory-feed' | ...

ErrorCode = Literal[
    "UNAUTHENTICATED",
    "FORBIDDEN_ROLE",
    "FORBIDDEN_NOT_ON_CARE_TEAM",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "CONFLICT",
    "UPSTREAM_UNAVAILABLE",
    "INTERNAL",
]


class Provenance(BaseModel):
    source_system: SourceSystem
    source_ref: str | None = None
    ingested_at: datetime


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None
