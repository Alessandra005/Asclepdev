"""LiveScribing: the Scribe plus the visit conversation (spec 10.5, extended). Owner: Brandon.

/live-scribe/window  frames (JPEG, 1 fps) + one audio chunk -> text observations + transcript segments
/live-scribe/review  observations + transcript -> actions (possible symptoms) for the doctor to check

PRIVACY: frames and audio are read into memory, used, and dropped. They are never written to disk, logged,
or sent anywhere except the local VLM (VLM_URL) and the in-process Whisper model. Only text leaves here.
Wording is observable-only: what was seen or said, never a diagnosis or a guess at a cause.
"""
import base64
import io
import json
import os
import re

import httpx
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError

from asclep_contracts import (
    LiveScribeReviewRequest,
    LiveScribeReviewResult,
    LiveScribeWindowResult,
    ScribeAction,
    ScribeObservation,
    TranscriptSegment,
)

router = APIRouter(prefix="/live-scribe", tags=["live-scribe"])

MOCK = os.getenv("RESIDENT_MOCK", "1") == "1"
VLM_URL = os.getenv("VLM_URL", "http://vlm:8000/v1").rstrip("/")
VLM_MODEL = os.getenv("VLM_MODEL", "Qwen3-VL-4B-Instruct")
VLM_TIMEOUT = float(os.getenv("VLM_TIMEOUT", "120"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base.en")

CATEGORIES = ("mobility", "posture", "respiratory", "cough", "movement", "device_use", "interaction", "other")


def to_secs(clock: str) -> int:
    h, m, s = (int(x) for x in clock.split(":"))
    return h * 3600 + m * 60 + s


def to_clock(secs: float) -> str:
    s = max(0, int(secs))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


# ---------------------------------------------------------------- vision (local VLM)

# Frames arrive the way the vlmlol prototype picks them: BEFORE a movement, PEAK movement, AFTER (or a single
# frame when nothing moved). The model narrates what the patient does; the review step decides what matters.
WINDOW_PROMPT = (
    "You are a precise visual scribe watching a patient on a clinic camera. You receive frames from the same "
    "camera in chronological order, numbered from 0: BEFORE a movement, the moment of PEAK movement, AFTER, "
    "or a single frame when nothing moved. Describe what the PATIENT did across the frames, including brief "
    "actions that end back in the starting pose. Look closely for: covering the mouth or nose (coughing, "
    "sneezing), touching, rubbing or holding a body part (chest, head, throat, stomach, eyes), wincing or "
    "grimacing, yawning, trembling, breathing hard, slumping or leaning, standing up or sitting down, hand and "
    "arm movements, head turns, nods and tilts. The frames are NOT mirrored: the patient's right side is on "
    "the LEFT of the image. Ignore anyone else in frame.\n"
    "Rules: describe only what is visible. Never diagnose and never guess a cause or feeling (no 'may "
    "indicate', 'suggests', 'appears to be in pain').\n"
    'Reply with JSON only: {"people_in_frame": <int>, "observations": [{"frame": <int>, "category": one of '
    + ", ".join(CATEGORIES)
    + ', "text": "<one short concrete sentence>", "confidence": <0..1>}]}. '
    "Use an empty list only if the patient did nothing at all."
)


class _VlmObservation(BaseModel):
    frame: int = 0
    category: str
    text: str
    confidence: float


def _parse_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model reply had no JSON object")
    return json.loads(text[start:end + 1])


async def _chat(content: list[dict] | str, system: str, max_tokens: int) -> dict:
    body = {
        "model": VLM_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    async with httpx.AsyncClient(timeout=VLM_TIMEOUT) as client:
        r = await client.post(f"{VLM_URL}/chat/completions", json=body)
        r.raise_for_status()
    return _parse_json(r.json()["choices"][0]["message"]["content"])


def frame_labels(n: int) -> list[str]:
    return {1: ["single frame"], 2: ["BEFORE", "AFTER"], 3: ["BEFORE", "PEAK MOVEMENT", "AFTER"]}.get(
        n, [f"frame {i}" for i in range(n)])


async def describe_frames(frames: list[bytes], times_s: list[int]) -> tuple[list[ScribeObservation], int]:
    """times_s[i] = the session second frame i was taken; observations are stamped with it."""
    if not frames:
        return [], 0
    content: list[dict] = []
    for i, (jpeg, label) in enumerate(zip(frames, frame_labels(len(frames)))):
        content.append({"type": "text", "text": f"frame {i} ({label}):"})
        content.append({"type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}})
    content.append({"type": "text", "text": "What did the patient do during these frames?"})
    data = await _chat(content, WINDOW_PROMPT, max_tokens=600)
    out = []
    for raw in data.get("observations", []):
        try:
            o = _VlmObservation.model_validate(raw)
        except ValidationError:
            continue  # drop malformed items rather than fail the window
        text = observable_only(o.text)
        if not text or text.lower().startswith("no significant"):
            continue
        category = o.category if o.category in CATEGORIES else "other"
        frame = min(max(o.frame, 0), len(frames) - 1)
        out.append(ScribeObservation(t=to_clock(times_s[frame]), category=category, text=text,
                                     confidence=min(max(o.confidence, 0.0), 1.0)))
    return out, int(data.get("people_in_frame", 1))


# ---------------------------------------------------------------- speech (local Whisper)

_whisper = None


def _whisper_model():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel  # heavy import, only in real mode
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def _transcribe_sync(audio: bytes, start_s: int) -> list[TranscriptSegment]:
    from faster_whisper import decode_audio
    wave = decode_audio(io.BytesIO(audio), sampling_rate=16000)  # in memory; webm/opus, wav, ogg
    segments, _ = _whisper_model().transcribe(wave, language="en", vad_filter=True, beam_size=1)
    return [TranscriptSegment(t=to_clock(start_s + s.start), end=to_clock(start_s + s.end), text=s.text.strip())
            for s in segments if s.text.strip()]


async def transcribe(audio: bytes, start_s: int) -> list[TranscriptSegment]:
    return await run_in_threadpool(_transcribe_sync, audio, start_s) if audio else []


# ---------------------------------------------------------------- mock (RESIDENT_MOCK=1)

# Synthetic visit for Gregory Hale, one entry per 10-second window. Offsets are seconds into the window.
MOCK_SCRIPT: list[tuple[list[tuple[int, str, str, float]], list[tuple[int, int, str]]]] = [
    ([(3, "mobility", "Walked from the door to the chair; paused twice on the way", 0.82)],
     [(2, 6, "Good morning, Gregory. How have you been feeling since your last visit?"),
      (6, 10, "Honestly, not great. I get short of breath walking up the stairs.")]),
    ([(3, "respiratory", "Breathing visibly faster after sitting down", 0.71)],
     [(1, 4, "How long has that been going on?"),
      (5, 10, "About three weeks. And this cough won't go away.")]),
    ([(3, "cough", "Coughed 3 times, covered mouth with right hand", 0.9)],
     [(1, 4, "Any chest pain, or coughing up blood?"),
      (5, 9, "Some chest pain when I cough. No blood.")]),
    ([],
     [(1, 5, "Have you noticed any weight loss or fevers?"),
      (5, 9, "I've lost maybe eight pounds. No fevers.")]),
    ([(3, "posture", "Sat leaning forward with hands on knees", 0.66)],
     [(1, 7, "I'm more tired than usual too. I nap every afternoon now.")]),
    ([(3, "cough", "Coughed 2 times", 0.88)],
     [(1, 6, "Okay. Let's listen to your lungs and go over your recent results.")]),
]


def mock_window(start_s: int) -> tuple[list[ScribeObservation], list[TranscriptSegment]]:
    obs, lines = MOCK_SCRIPT[(start_s // 10) % len(MOCK_SCRIPT)]
    return (
        [ScribeObservation(t=to_clock(start_s + dt), category=c, text=text, confidence=p) for dt, c, text, p in obs],
        [TranscriptSegment(t=to_clock(start_s + a), end=to_clock(start_s + b), text=text) for a, b, text in lines],
    )


# ---------------------------------------------------------------- review: actions (possible symptoms)

REVIEW_PROMPT = """\
You review one clinic visit for the doctor. You get two machine-made logs with session timestamps:
VISUAL observations of the patient (from a vision model) and the visit CONVERSATION (speech-to-text,
speakers not labeled: the doctor asks, the patient answers).
Flag each thing the doctor would want in the visit note as a possible symptom:
- visible: touching/rubbing/holding a body part, coughing, laboured or fast breathing, wincing, trembling,
  slowness, stiffness, one side moving less, slumping, losing balance
- said by the patient: pain, shortness of breath, cough, fatigue, weight change, fever, dizziness, bleeding,
  sleep or appetite changes, anything else a clinician would note
Not worth flagging: ordinary gestures, talking, the doctor's own questions, single brief posture shifts.
Rules: describe what was seen or said, never diagnose, never guess a cause. Merge repeats into one item and
list every supporting timestamp. The logs are noisy: set confidence from how clear and how repeated it was.
Reply with JSON only:
{"actions": [{"action": "...", "times": ["HH:MM:SS"], "why_relevant": "...", "confidence": "low|medium|high",
"source": "visual|sound|conversation"}], "summary": "1-3 plain sentences"}
"""


# Small local models still guess at causes despite the prompt ("may indicate respiratory distress").
# Observable-only is a hard rule, so sentences that infer are removed here rather than trusted to the model.
INFERENCE = re.compile(
    r"\b(may|might|could|can)\s+(indicate|suggest|signal|reflect|point|be\s+(due|related|a\s+sign))"
    r"|\b(suggests?|suggestive|indicates?|indicative|consistent\s+with|likely|possibly|potentially|probably"
    r"|a\s+sign\s+of|symptom\s+of|due\s+to)\b",
    re.I,
)
NEUTRAL_WHY = {
    "visual": "Seen during the visit.",
    "sound": "Heard during the visit.",
    "conversation": "Reported by the patient during the visit.",
}


def observable_only(text: str, fallback: str = "") -> str:
    kept = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s and not INFERENCE.search(s)]
    return " ".join(kept) or fallback


class _RawAction(BaseModel):
    action: str
    times: list[str] = []
    why_relevant: str = ""
    confidence: str = "low"
    source: str = "visual"


async def review_llm(req: LiveScribeReviewRequest) -> LiveScribeReviewResult:
    visual = "\n".join(f"[{o.t}] ({o.category}) {o.text}" for o in req.observations) or "(none)"
    talk = "\n".join(f"[{s.t}] {s.text}" for s in req.transcript) or "(none)"
    data = await _chat(f"VISUAL:\n{visual}\n\nCONVERSATION:\n{talk}", REVIEW_PROMPT, max_tokens=1500)
    known = {o.t for o in req.observations} | {s.t for s in req.transcript}
    actions = []
    for raw in data.get("actions", []):
        try:
            a = _RawAction.model_validate(raw)
        except ValidationError:
            continue
        times = [t for t in a.times if t in known]  # evidence must point at something that was logged
        if not times:
            continue
        source = a.source if a.source in ("visual", "sound", "conversation") else "visual"
        actions.append(ScribeAction(
            id=f"a{len(actions) + 1}", action=a.action.strip(), times=times,
            why_relevant=observable_only(a.why_relevant, NEUTRAL_WHY[source]),
            confidence=a.confidence.lower() if a.confidence.lower() in ("low", "medium", "high") else "low",
            source=source,
        ))
    return LiveScribeReviewResult(actions=actions, summary=observable_only(str(data.get("summary", ""))))


VISUAL_WHY = {
    "cough": "Coughing seen during the visit.",
    "respiratory": "Visible breathing effort.",
    "mobility": "How the patient moved around the room.",
    "posture": "Posture held during the visit.",
    "movement": "Notable movement during the visit.",
    "device_use": "Use of a medical device or aid.",
}
SAID_KEYWORDS = {
    "short of breath": "shortness of breath", "breath": "shortness of breath", "chest pain": "chest pain",
    "pain": "pain", "cough": "cough", "tired": "fatigue", "fatigue": "fatigue", "exhausted": "fatigue",
    "weight": "weight change", "pounds": "weight change", "fever": "fever", "dizzy": "dizziness",
    "blood": "bleeding", "nausea": "nausea", "sleep": "sleep changes", "appetite": "appetite changes",
}


def review_rules(req: LiveScribeReviewRequest) -> LiveScribeReviewResult:
    """Deterministic review for mock mode: groups visual categories and matches symptom words said aloud."""
    actions: list[ScribeAction] = []
    for cat, why in VISUAL_WHY.items():
        hits = [o for o in req.observations if o.category == cat]
        if not hits:
            continue
        best = max(o.confidence for o in hits)
        conf = "high" if len(hits) > 1 or best >= 0.85 else "medium" if best >= 0.6 else "low"
        text = hits[0].text if len(hits) == 1 else f"{hits[0].text} (seen {len(hits)} times)"
        actions.append(ScribeAction(id="", action=text, times=[o.t for o in hits], why_relevant=why,
                                    confidence=conf, source="visual"))
    said: dict[str, list[TranscriptSegment]] = {}
    for seg in req.transcript:
        low = seg.text.lower()
        for word, symptom in SAID_KEYWORDS.items():
            if word in low and not re.search(r"\bno\s+" + re.escape(word), low) and "?" not in low:
                said.setdefault(symptom, []).append(seg)
                break
    for symptom, segs in said.items():
        actions.append(ScribeAction(
            id="", action=f'Mentioned {symptom}: "{segs[0].text}"', times=[s.t for s in segs],
            why_relevant="Patient-reported in the conversation.", confidence="medium", source="conversation"))
    for i, a in enumerate(actions, 1):
        a.id = f"a{i}"
    summary = (f"{len(req.observations)} visual observations and {len(req.transcript)} transcript lines; "
               f"{len(actions)} possible symptoms flagged for the doctor to review.")
    return LiveScribeReviewResult(actions=actions, summary=summary)


# ---------------------------------------------------------------- routes


@router.post("/window", response_model=LiveScribeWindowResult)
async def window(
    session_id: str = Form(...),
    window_start: str = Form(...),
    window_end: str = Form(...),
    frame_times: str | None = Form(None),
    frames: list[UploadFile] | None = File(None),
    audio: UploadFile | None = File(None),
) -> LiveScribeWindowResult:
    start_s = to_secs(window_start)
    # PRIVACY: bytes live only in these locals; never saved, never logged.
    frame_bytes = [await f.read() for f in frames or []]
    audio_bytes = await audio.read() if audio else b""
    try:
        if MOCK:
            observations, transcript = mock_window(start_s)
            people = 1
        else:
            given = [to_secs(t) for t in (frame_times or "").split(",") if t.strip()]
            times = given if len(given) == len(frame_bytes) else [start_s + i for i in range(len(frame_bytes))]
            observations, people = await describe_frames(frame_bytes, times)
            transcript = await transcribe(audio_bytes, start_s)
    finally:
        del frame_bytes, audio_bytes
    flags = [] if frames or audio else ["no_media"]
    return LiveScribeWindowResult(session_id=session_id, window_start=window_start, window_end=window_end,
                                  observations=observations, transcript=transcript,
                                  people_in_frame=people, quality_flags=flags)


@router.post("/review", response_model=LiveScribeReviewResult)
async def review(req: LiveScribeReviewRequest) -> LiveScribeReviewResult:
    return review_rules(req) if MOCK else await review_llm(req)
