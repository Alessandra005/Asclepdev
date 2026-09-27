"""The Resident: report drafting, Ask, and the Scribe (spec sections 10.1 to 10.5). Owner: Brandon.

Report and Ask use Claude when RESIDENT_LLM_MOCK=0 (app/report.py, app/ask.py); LiveScribing follows RESIDENT_MOCK.
Frames sent to /scribe/window are processed in memory only and NEVER written to disk or logged.
"""
import os

from fastapi import FastAPI, File, Form, Header, UploadFile

from app import ask, llm, report
from app.live_scribe import router as live_scribe_router
from asclep_contracts import (
    AskAnswer,
    AskRequest,
    DraftReport,
    DraftReportRequest,
    ScribeObservation,
    ScribeWindowResult,
)

app = FastAPI(title="Asclep Resident")
app.include_router(live_scribe_router)
MOCK = os.getenv("RESIDENT_MOCK", "1") == "1"


@app.get("/health")
def health():
    return {"status": "ok", "mock": MOCK, "llm_mock": llm.MOCK, "model": llm.MODEL}


@app.post("/draft-report", response_model=DraftReport)
def draft_report(req: DraftReportRequest) -> DraftReport:
    return report.draft(req)


@app.post("/ask", response_model=AskAnswer)
def ask_question(req: AskRequest, authorization: str | None = Header(default=None)) -> AskAnswer:
    """The gateway forwards the user's Authorization header; every tool call runs as that user (spec 10.2)."""
    return ask.answer(req, authorization)


@app.post("/scribe/window", response_model=ScribeWindowResult)
async def scribe_window(
    session_id: str = Form(...),
    window_start: str = Form(...),
    window_end: str = Form(...),
    frames: list[UploadFile] = File(...),
) -> ScribeWindowResult:
    # PRIVACY: read frames into memory only; never save, never log (spec 10.5 guarantee 2).
    _ = [await f.read() for f in frames]
    del _
    return ScribeWindowResult(
        session_id=session_id, window_start=window_start, window_end=window_end,
        observations=[ScribeObservation(t=window_start, category="mobility",
                                        text="(mock) Walked to the chair without assistance", confidence=0.8)],
        people_in_frame=1,
    )
