"""Job 2: the Ask chatbot (spec 10.2). Owner: Brandon.

A tool-using agent over the gateway. Every tool call carries the user's own token and X-Actor-Kind: resident,
so RBAC and audit apply to the AI exactly as to the user. The answer is checked (citations_accessible,
every_claim_cited, numbers_grounded, no_dosing, length_limit); failing answers go back for a targeted rewrite,
and after LOOP_BUDGET attempts the user gets the matching records with verified=False.
"""
import json
import logging
import os
import re
import time
from uuid import UUID, uuid4

import httpx

from app import llm
from app.validate import (
    CITE,
    citations_resolve,
    citations_well_formed,
    drop_uncited,
    every_claim_cited,
    length_limit,
    no_dosing,
    numbers_grounded,
)
from asclep_contracts import AskAnswer, AskRequest, Citation

log = logging.getLogger("uvicorn.error")
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://api:8000/api/v1").rstrip("/")
MAX_TOOL_CALLS = 6
TIME_BUDGET_S = 30.0
MAX_RESULT_CHARS = 6000
MAX_ITEMS = 20  # ask_slice: each tool's data capped at 20 items (spec 7A.6)

SYSTEM = """You are the Resident in Asclep, answering a clinician's question from hospital records.
- Answer only from tool results. If the data is not there, say what is missing and which tool returned nothing.
- Cite every fact with [[obj:<Type>:<id>]] using the id and type of the record in the tool results.
- Never state a diagnosis that is not a stored Finding; describe Findings with their review status.
- Never give dosing instructions or place orders. You may say an order is possible and link the relevant record.
- If access is denied for a record, say "You don't have access to that record" and do not guess its content.
- Keep answers under 150 words unless asked for more.
- Copy numbers exactly as the tools return them; never compute new ones (no "in N days"). Write dates as
  YYYY-MM-DD.
- Every record in the tool results has a "cite" field: end each sentence that states a record fact with that
  exact token, copied character for character.
- Plain sentences, each ending with its citation. Only state what the records show or what is missing; no
  offers, advice, or remarks about yourself. Never write a citation for a record you don't have."""

# (name, description, properties, required, method, path template, query/body keys, default object type)
TOOL_SPECS = [
    ("find_patient", "Find patients by name or MRN.", {"name": "string", "dob": "string"}, ["name"],
     "GET", "/patients", {"q": "name"}, "Patient"),
    ("get_patient_summary", "Active conditions, medications, allergies, last encounter.", {"patient_id": "string"},
     ["patient_id"], "GET", "/patients/{patient_id}/summary", {}, "Condition"),
    ("get_observations", "Labs and vitals with reference ranges. category: laboratory or vital-signs.",
     {"patient_id": "string", "category": "string", "since": "string"}, ["patient_id"],
     "GET", "/patients/{patient_id}/observations", {"category": "category", "since": "since"}, "Observation"),
    ("get_findings", "Lab Technician findings with review status.", {"patient_id": "string"}, ["patient_id"],
     "GET", "/patients/{patient_id}/findings", {}, "Finding"),
    ("get_medications", "Active medication requests with inventory status.", {"patient_id": "string"},
     ["patient_id"], "GET", "/patients/{patient_id}/medications", {}, "MedicationRequest"),
    ("get_inventory", "Pharmacy stock: on hand, backordered, expected restock date.", {"medication_name": "string"},
     ["medication_name"], "GET", "/inventory", {"q": "medication_name"}, "InventoryItem"),
    ("get_appointments", "Schedule rows. date is YYYY-MM-DD.", {"date": "string", "patient_id": "string"}, [],
     "GET", "/appointments", {"date": "date", "patient_id": "patient_id"}, "Appointment"),
    ("search_records", "Free-text search over notes and records.", {"query": "string", "patient_id": "string"},
     ["query"], "POST", "/search", {"query": "query", "patient_id": "patient_id"}, "Chunk"),
    ("get_transcript_requests", "Record requests from other providers and their status.", {"patient_id": "string"},
     ["patient_id"], "GET", "/patients/{patient_id}/transcripts", {}, "TranscriptRequest"),
]
SPECS = {s[0]: s for s in TOOL_SPECS}
TOOLS = [{"name": n, "description": d, "input_schema": {
    "type": "object", "properties": {k: {"type": t} for k, t in props.items()}, "required": req}}
    for n, d, props, req, *_ in TOOL_SPECS]
# Where a nested list sits under one of these keys, its records are of this type (e.g. the summary).
KEY_TYPES = {"conditions": "Condition", "medications": "MedicationRequest", "allergies": "Allergy"}
LABEL_KEYS = ("title", "label", "display", "name", "medication", "substance", "patient_name")


def call_gateway(name: str, args: dict, token: str | None) -> tuple[int, object]:
    _, _, _, _, method, path, params, _ = SPECS[name]
    url = GATEWAY_URL + path.format(**{k: args.get(k, "") for k in re.findall(r"{(\w+)}", path)})
    values = {key: args[arg] for key, arg in params.items() if args.get(arg)}
    headers = {"X-Actor-Kind": "resident", **({"Authorization": token} if token else {})}
    r = httpx.request(method, url, headers=headers, timeout=10.0,
                      **({"params": values} if method == "GET" else {"json": values}))
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, None


def collect(data: object, default_type: str, seen: dict[str, tuple[str, str | None]], type_: str | None = None):
    """Every record id in a tool result -> (object type, label). These are the ids the answer may cite."""
    if isinstance(data, list):
        for x in data[:MAX_ITEMS]:
            collect(x, default_type, seen, type_)
    elif isinstance(data, dict):
        raw = str(data.get("id", ""))
        typed = re.fullmatch(r"(\w+):([0-9a-fA-F-]{36})", raw)
        rid, rtype = (typed.group(2), typed.group(1)) if typed else (raw, None)
        if re.fullmatch(r"[0-9a-fA-F-]{36}", rid):
            t = rtype or data.get("object_type") or type_ or default_type
            seen[rid.lower()] = (t, next((str(data[k]) for k in LABEL_KEYS if data.get(k)), None))
            data["cite"] = f"[[obj:{t}:{rid}]]"  # the exact token to copy: the model never builds ids or types
        for k, v in data.items():
            if isinstance(v, (list, dict)):
                collect(v, default_type, seen, KEY_TYPES.get(k, type_))


def run_tool(name: str, args: dict, token: str | None, seen: dict) -> tuple[str, bool]:
    """Returns (tool_result text, is_error). Denials are reported, never guessed around."""
    if name not in SPECS:
        return f"Unknown tool {name}.", True
    try:
        status, data = call_gateway(name, args, token)
    except httpx.HTTPError:
        return "The gateway did not respond.", True
    if status in (401, 403):
        return "You don't have access to that record.", True
    if status == 404:
        return "Not found.", True
    if status >= 400:
        return f"The tool failed (HTTP {status}).", True
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        data = {**data, "items": data["items"][:MAX_ITEMS]}
    collect(data, SPECS[name][7], seen)
    return json.dumps(data, default=str)[:MAX_RESULT_CHARS], False


SALVAGEABLE = {"citations_well_formed", "every_claim_cited"}  # failures drop_uncited() can repair without the model


def names_in(seen: dict) -> set[str]:
    """Words of record labels (patient, medication, ...): an uncited sentence using one states a record fact."""
    names = {w.lower() for _, label in seen.values() if label for w in re.findall(r"[A-Za-z]{4,}", label)}
    return names - {"inventory", "finding", "note", "patient"}  # generic type words are not record content


def check(answer: str, seen: dict, sources: str) -> dict[str, list[str]]:
    """Failed checks by name -> problems. Only the names are ever logged: answer text is PHI."""
    checks = {"citations_well_formed": citations_well_formed(answer),
              "citations_resolve": citations_resolve(answer, set(seen)),
              "every_claim_cited": every_claim_cited(answer, names_in(seen)),
              "numbers_grounded": numbers_grounded(answer, sources),
              "no_dosing": no_dosing(answer), "length_limit": length_limit(answer)}
    return {k: v for k, v in checks.items() if v}


def verified(text: str, seen: dict, conversation_id: str) -> AskAnswer:
    text = retype(text, seen)
    return AskAnswer(answer_md=text, citations=citations(text, seen), conversation_id=conversation_id)


def retype(answer: str, seen: dict) -> str:
    """The record type comes from the tool that returned it, not from the model (which may write 'Inventory')."""
    return CITE.sub(lambda m: f"[[obj:{seen[m[2].lower()][0]}:{m[2]}]]" if m[2].lower() in seen else m[0], answer)


def citations(answer: str, seen: dict) -> list[Citation]:
    out, ids = [], set()
    for _, oid in CITE.findall(answer):
        if oid.lower() in seen and oid.lower() not in ids:
            ids.add(oid.lower())
            type_, label = seen[oid.lower()]
            out.append(Citation(object_type=type_, id=UUID(oid), label=label))
    return out


def fallback(req: AskRequest, seen: dict, conversation_id: str) -> AskAnswer:
    """The loop budget ran out: no model prose, just the records the tools returned (spec 10.4)."""
    rows = list(seen.items())[:8]
    body = "I couldn't produce a verified answer; here are the matching records:\n" + "\n".join(
        f"- {label or t} [[obj:{t}:{oid}]]" for oid, (t, label) in rows) if rows else \
        "I couldn't produce a verified answer, and the tools returned no matching records."
    cites = [Citation(object_type=t, id=UUID(oid), label=label) for oid, (t, label) in rows]
    return AskAnswer(answer_md=body, citations=cites, conversation_id=conversation_id, verified=False)


def text_of(msg) -> str:
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def answer(req: AskRequest, token: str | None) -> AskAnswer:
    """verified=False tells the gateway to audit resident_validation_failed (spec 10.4)."""
    conversation_id = req.conversation_id or str(uuid4())
    if llm.MOCK:
        return AskAnswer(answer_md="(mock) The Resident is not wired to Claude. Real answers cite every fact.",
                         citations=[], conversation_id=conversation_id, verified=False)
    deadline = time.monotonic() + TIME_BUDGET_S
    question = req.question + (f"\n\n(The user has patient {req.patient_id} open.)" if req.patient_id else "")
    messages: list[dict] = [{"role": "user", "content": question}]
    seen: dict[str, tuple[str, str | None]] = {}
    sources, calls, attempts, last = "", 0, 0, None
    while attempts < llm.LOOP_BUDGET and (left := deadline - time.monotonic()) > 1:
        try:
            msg = llm.client().with_options(timeout=left, max_retries=0).messages.create(
                model=llm.MODEL, max_tokens=4000, system=SYSTEM, tools=TOOLS, messages=messages,
                tool_choice={"type": "auto" if calls < MAX_TOOL_CALLS else "none"},
                output_config={"effort": "low"})
        except Exception as exc:  # API down or out of time: fall back to the records gathered so far
            log.warning("ask: Claude call failed (%s)", type(exc).__name__)
            break
        messages.append({"role": "assistant", "content": msg.content})
        uses = [b for b in msg.content if b.type == "tool_use"]
        if msg.stop_reason == "tool_use" and uses:
            results = []
            for b in uses:
                calls += 1
                if calls > MAX_TOOL_CALLS:
                    content, err = f"Tool budget of {MAX_TOOL_CALLS} calls used. Answer with what you have.", True
                else:
                    content, err = run_tool(b.name, b.input, token, seen)
                    sources += content
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": content, "is_error": err})
            messages.append({"role": "user", "content": results})
            continue
        attempts += 1
        text = text_of(msg)
        failed = check(text, seen, sources) if text else {"empty": ["The answer was empty."]}
        if not failed:
            return verified(text, seen, conversation_id)
        log.info("ask: attempt %d failed %s", attempts, sorted(failed))
        last = (text, failed)
        messages.append({"role": "user", "content": "Your answer failed these checks. Rewrite it, fixing every "
                         "one, without calling more tools:\n" + "\n".join(f"- {p}" for v in failed.values() for p in v)})
        calls = MAX_TOOL_CALLS  # repairs are rewrites, not new lookups
    if last and set(last[1]) <= SALVAGEABLE:  # only citation problems left: remove the uncited sentences
        fixed = drop_uncited(last[0], names_in(seen))
        if CITE.search(fixed) and not check(fixed, seen, sources):
            log.info("ask: salvaged by dropping uncited sentences")
            return verified(fixed, seen, conversation_id)
    log.info("ask: fallback (attempts=%d, time_left=%.1fs)", attempts, deadline - time.monotonic())
    return fallback(req, seen, conversation_id)
