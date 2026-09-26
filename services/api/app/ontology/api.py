"""The ontology API: the ONLY door to clinical data (spec section 7A.8).

Signatures are owned by Ron; implementations by Alessandra. Every function takes a Principal,
enforces spec section 13, filters sensitivity='restricted' rows, and writes audit rows.
"""
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from asclep_contracts import ContextView


class Filters(BaseModel):
    since: str | None = None
    category: str | None = None
    code_group: str | None = None
    status: str | None = None


def get_object(s: Session, p: Principal, type: str, id: UUID) -> dict:
    raise NotImplementedError("Alessandra: spec 7A.8")


def list_objects(s: Session, p: Principal, type: str, patient_id: UUID, filters: Filters | None = None,
                 limit: int = 50, cursor: str | None = None) -> dict:
    raise NotImplementedError("Alessandra: spec 7A.8, returns {items, next_cursor}")


def traverse(s: Session, p: Principal, type: str, id: UUID, link_types: list[str], depth: int = 1) -> list[dict]:
    raise NotImplementedError("Alessandra: spec 7A.2 + 7A.8")


def context_view(s: Session, p: Principal, view: str, subject_id: UUID) -> ContextView:
    raise NotImplementedError("Alessandra: spec 7A.6; recipes in app/ontology/views.yaml")


def facts(s: Session, p: Principal, patient_id: UUID, fact_set: str) -> dict:
    raise NotImplementedError("Alessandra: spec 7A.7 level 1 SQL facts")


def search(s: Session, p: Principal, query: str, patient_id: UUID | None, k: int = 8) -> list[dict]:
    raise NotImplementedError("Alessandra: pgvector search over chunk table")


def history(s: Session, p: Principal, type: str, id: UUID) -> list[dict]:
    raise NotImplementedError("Alessandra: object_version rows")


def apply_action(s: Session, p: Principal, action: str, payload: BaseModel) -> dict:
    """Actions: ingest_bundle, classify_slide, draft_report, review_finding, request_transcript,
    merge_transcript, acknowledge_alert, complete_task, start_scribe, review_scribe."""
    raise NotImplementedError("spec section 7 actions")
