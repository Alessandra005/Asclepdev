"""Shared contracts. FROZEN after hour 2: changes need Ron's review (spec section 0, rule 3)."""
from .common import ErrorBody, ErrorResponse, Page, Provenance
from .lab import ClassifyRequest, ClassifyResult, TopTile
from .live_scribe import (
    LiveScribeReviewRequest,
    LiveScribeReviewResult,
    LiveScribeWindowResult,
    ScribeAction,
    TranscriptSegment,
)
from .ontology import ContextItem, ContextView, RawRecord
from .resident import (
    AskAnswer,
    AskRequest,
    Citation,
    DraftReport,
    DraftReportRequest,
    LockedFinding,
)
from .scribe import ScribeObservation, ScribeWindowResult

__all__ = [
    "AskAnswer", "AskRequest", "Citation", "ClassifyRequest", "ClassifyResult",
    "ContextItem", "ContextView", "DraftReport", "DraftReportRequest", "ErrorBody",
    "ErrorResponse", "LiveScribeReviewRequest", "LiveScribeReviewResult", "LiveScribeWindowResult",
    "LockedFinding", "Page", "Provenance", "RawRecord", "ScribeAction", "ScribeObservation",
    "ScribeWindowResult", "TopTile", "TranscriptSegment",
]
