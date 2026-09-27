"""Ingestion pipeline (spec section 7A.3-7A.5). Owner: Alessandra.

Two stages:
  1. land_bundle: every FHIR resource in a $everything Bundle -> raw_record (append-only).
  2. process_raw_records: unprocessed raw_record rows -> typed clinical tables,
     with patient identity resolution, upsert + object_version history, and alert rules.
"""
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.alerts.engine import AlertDraft, _attendings_for, evaluate_object, raise_alert
from app.audit.log import write_audit
from app.auth.principal import Principal
from app.ehr.hapi import HapiAdapter
from app.ontology import index, links
from app.ontology.shapes import SOURCE_LABELS


class IngestBundleRequest(BaseModel):
    """Internal request shape for apply_action('ingest_bundle', ...)."""
    provider_id: UUID
    fhir_patient_id: str


def _payload_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _bundle_entries(bundle: dict) -> list[dict]:
    return [e["resource"] for e in bundle.get("entry", []) if e.get("resource")]


def land_bundle(s: Session, source_system: str, bundle: dict) -> list[UUID]:
    """Stage 1 (7A.3): insert every resource in the bundle as a raw_record row.
    Idempotent: (source_system, source_ref, payload_hash) is UNIQUE, so re-running
    the same bundle is a no-op for unchanged, processed resources. Landed-but-unprocessed rows (a type with no
    mapping yet, an orphan whose patient came later) come back, so they get processed once they can be."""
    landed_ids: list[UUID] = []
    for resource in _bundle_entries(bundle):
        resource_type = resource.get("resourceType")
        source_ref = resource.get("id")
        if not resource_type or not source_ref:
            continue
        row = s.execute(
            text("""INSERT INTO raw_record (source_system, source_ref, resource_type, payload,
                    payload_hash, fetched_at)
                    VALUES (:src, :ref, :rtype, :payload, :hash, :fetched)
                    ON CONFLICT (source_system, source_ref, payload_hash)
                    DO UPDATE SET fetched_at = EXCLUDED.fetched_at WHERE raw_record.processed_at IS NULL
                    RETURNING id"""),
            {"src": source_system, "ref": source_ref, "rtype": resource_type,
             "payload": json.dumps(resource), "hash": _payload_hash(resource),
             "fetched": datetime.now(timezone.utc)},
        ).first()
        if row:
            landed_ids.append(row[0])
    return landed_ids


def _find_or_create_patient(s: Session, source_system: str, fhir_patient: dict) -> UUID:
    """Identity resolution (7A.5 stage 4). Deterministic match on (source_system,
    source_patient_ref) first; falls back to a demographic match; else creates a new
    canonical patient. Every decision writes patient_identity and a system audit row (spec 8 rule 2).

    SPEC-QUESTION(Alessandra): 7A.5 scores matches (0.9 auto-link, 0.6-0.9 identity_review hold). Only the
    exact case-insensitive name + birth date match is built; the hold path needs the admin task flow first."""
    source_patient_ref = fhir_patient["id"]

    existing = s.execute(
        text("""SELECT patient_id FROM patient_identity
                WHERE source_system = :src AND source_patient_ref = :ref AND active"""),
        {"src": source_system, "ref": source_patient_ref},
    ).scalar()
    if existing:
        return existing

    name = (fhir_patient.get("name") or [{}])[0]
    given = " ".join(name.get("given", []))
    family = name.get("family", "")
    birth_date = fhir_patient.get("birthDate")

    match = None
    if family and birth_date:
        match = s.execute(
            text("""SELECT id FROM patient WHERE lower(family_name) = lower(:fam) AND lower(given_name) = lower(:giv)
                    AND birth_date = :dob LIMIT 1"""),
            {"fam": family, "giv": given, "dob": birth_date},
        ).scalar()

    if match:
        patient_id, match_method, score = match, "demographic_score", 0.9
    else:
        patient_id, match_method, score = uuid4(), "same_source_mrn", 1.0
        s.execute(
            text("""INSERT INTO patient (id, mrn, given_name, family_name, birth_date, sex,
                    source_system, source_ref)
                    VALUES (:id, :mrn, :giv, :fam, :dob, :sex, :src, :ref)"""),
            {"id": patient_id, "mrn": f"{source_system}:{source_patient_ref}",
             "giv": given, "fam": family, "dob": birth_date,
             "sex": fhir_patient.get("gender"), "src": source_system, "ref": source_patient_ref},
        )

    s.execute(
        text("""INSERT INTO patient_identity (patient_id, source_system, source_patient_ref,
                match_method, match_score) VALUES (:pid, :src, :ref, :method, :score)
                ON CONFLICT (source_system, source_patient_ref) DO NOTHING"""),
        {"pid": patient_id, "src": source_system, "ref": source_patient_ref,
         "method": match_method, "score": score},
    )
    # Principal None = actor_kind 'system'; never a fake user id (audit_log.actor_user_id is a foreign key).
    write_audit(s, None, "update" if match else "create", "PatientIdentity", patient_id=patient_id,
                reason=f"{match_method}: {source_system}/{source_patient_ref}")
    return patient_id


def _upsert(s: Session, object_type: str, table: str, source_system: str, source_ref: str,
            raw_record_id: UUID, cols: dict) -> dict:
    """Stage 5 (7A.5): upsert on (source_system, source_ref) so re-ingesting never duplicates (spec 8 rule 1).
    Only newly landed payloads get here, so an existing row means the source changed it: the current row
    is copied to object_version and its version bumped. Never hard-deletes."""
    params = {**cols, "src": source_system, "ref": source_ref, "raw": raw_record_id}
    current = s.execute(text(f"SELECT * FROM {table} WHERE source_system = :src AND source_ref = :ref"),
                        params).mappings().first()
    if current is None:
        names, values = ", ".join(cols), ", ".join(f":{c}" for c in cols)
        return dict(s.execute(
            text(f"""INSERT INTO {table} (id, {names}, source_system, source_ref, raw_record_id)
                     VALUES (:id, {values}, :src, :ref, :raw) RETURNING *"""),
            {**params, "id": uuid4()},
        ).mappings().one())
    s.execute(
        # Rows ingested before upserts existed already have a version-1 snapshot of their original payload.
        text("""INSERT INTO object_version (object_type, object_id, version, data, raw_record_id)
                VALUES (:t, :i, :v, :d, :r) ON CONFLICT (object_type, object_id, version) DO NOTHING"""),
        {"t": object_type, "i": current["id"], "v": current["version"],
         "d": json.dumps(dict(current), default=str), "r": current["raw_record_id"]},
    )
    sets = ", ".join(f"{c} = :{c}" for c in cols)
    return dict(s.execute(
        text(f"""UPDATE {table} SET {sets}, version = version + 1, raw_record_id = :raw, ingested_at = now()
                 WHERE id = :id RETURNING *"""),
        {**params, "id": current["id"]},
    ).mappings().one())


def _normalize_lab_value(
    loinc_code: str | None,
    value_num: float | None,
    unit: str | None,
) -> tuple[float | None, str | None]:
    """Normalize a numeric lab value for deterministic facts.

    The current spec does not define the full conversion table, so values
    with known source units are preserved until an explicit conversion rule
    exists. Unknown/missing units are also preserved rather than guessed.
    """
    if value_num is None:
        return None, unit

    if unit:
        return float(value_num), unit

    return float(value_num), None


def _interpretation(value: float | None, low: float | None, high: float | None) -> str | None:
    """7A.5 stage 3: recompute H/L/N from the reference range when the source omitted it."""
    if value is None or (low is None and high is None):
        return None
    if high is not None and value > high:
        return "H"
    if low is not None and value < low:
        return "L"
    return "N"


def _text(concept: dict | None) -> str | None:
    """A CodeableConcept's text, else its first coding's display."""
    concept = concept or {}
    return concept.get("text") or (concept.get("coding") or [{}])[0].get("display")


def _observation(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    code = (r.get("code", {}).get("coding") or [{}])[0]
    value_num, unit, value_text = None, None, None
    if "valueQuantity" in r:
        value_num = r["valueQuantity"].get("value")
        unit = r["valueQuantity"].get("unit")
    elif "valueString" in r:
        value_text = r["valueString"]
    elif "valueCodeableConcept" in r:  # e.g. smoking status
        value_text = _text(r["valueCodeableConcept"])
    ref_range = (r.get("referenceRange") or [{}])[0]
    low, high = ref_range.get("low", {}).get("value"), ref_range.get("high", {}).get("value")
    value_norm, unit_norm = _normalize_lab_value(code.get("code"), value_num, unit)
    interp = (r.get("interpretation") or [{}])[0].get("coding", [{}])[0].get("code")
    return "Observation", "observation", {
        "patient_id": patient_id,
        # A category's code, else its text (some sources send only {"text": "laboratory"}); never guessed.
        "category": ((r.get("category") or [{}])[0].get("coding") or [{}])[0].get("code")
        or ((r.get("category") or [{}])[0].get("text") or "unknown").strip().lower(),
        "loinc_code": code.get("code"), "display": code.get("display") or r.get("code", {}).get("text", "Observation"),
        "value_num": value_num, "value_text": value_text, "unit": unit, "ref_low": low, "ref_high": high,
        "interpretation": interp or _interpretation(value_num, low, high),
        "effective_at": r.get("effectiveDateTime"), "value_norm": value_norm, "unit_norm": unit_norm,
    }


def _condition(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    code = (r.get("code", {}).get("coding") or [{}])[0]
    return "Condition", "condition", {
        "patient_id": patient_id, "code": code.get("code"), "display": _text(r.get("code")) or "Condition",
        "clinical_status": (r.get("clinicalStatus", {}).get("coding") or [{}])[0].get("code"),
        "effective_at": r.get("onsetDateTime"),
    }


def _allergy(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    reaction = (r.get("reaction") or [{}])[0]
    return "Allergy", "allergy", {
        "patient_id": patient_id, "substance": _text(r.get("code")) or "Unknown substance",
        "reaction": _text((reaction.get("manifestation") or [{}])[0]), "criticality": r.get("criticality"),
        "effective_at": r.get("recordedDate") or r.get("onsetDateTime"),
    }


def _medication_request(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    med_name = _text(r.get("medicationCodeableConcept"))
    # Exact-name match to the seeded medication; an unmatched name just doesn't link to inventory.
    medication_id = s.execute(text("SELECT id FROM medication WHERE name = :name"),
                              {"name": med_name}).scalar() if med_name else None
    return "MedicationRequest", "medication_request", {
        "patient_id": patient_id, "medication_id": medication_id, "status": r.get("status", "unknown"),
        "dosage_text": (r.get("dosageInstruction") or [{}])[0].get("text", ""),
        "requested_by": None,  # SPEC-QUESTION: golden fixtures don't carry a requester user id
        "effective_at": r.get("authoredOn"),
    }


def _encounter(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    period = r.get("period", {})
    return "Encounter", "encounter", {
        "patient_id": patient_id, "type": _text((r.get("type") or [{}])[0]),
        "reason": _text((r.get("reasonCode") or [{}])[0]),
        "start_at": period.get("start"), "end_at": period.get("end"), "effective_at": period.get("start"),
    }


_IMAGING = re.compile(r"\b(imaging|x-?ray|ct|mri|radiolog\w*|ultrasound)\b", re.IGNORECASE)


def _note(s: Session, patient_id: UUID, r: dict) -> tuple[str, str, dict]:
    """DocumentReference -> note (spec 8); imaging reports become kind 'imaging_report' (7A.3)."""
    attachment = (r.get("content") or [{}])[0].get("attachment", {})
    try:
        body = base64.b64decode(attachment.get("data") or "", validate=True).decode("utf-8", errors="replace")
    except ValueError:  # malformed base64 must not abort the whole ingest (spec 8 rule 4); fall back to the type
        body = ""
    return "Note", "note", {
        "patient_id": patient_id, "kind": "imaging_report" if _IMAGING.search(_text(r.get("type")) or "") else "progress",
        "author_name": (r.get("author") or [{}])[0].get("display"),
        "body": " ".join(body.split()) or _text(r.get("type")) or "Document",  # 7A.5: collapse whitespace
        "effective_at": r.get("date"),
    }


def _specimen(s: Session, patient_id: UUID, r: dict) -> None:
    """Specimen -> specimen (spec 8). That table has no source columns, so it upserts on its unique accession."""
    accession = (r.get("accessionIdentifier") or {}).get("value") or r["id"]
    s.execute(
        text("""INSERT INTO specimen (id, patient_id, accession, site, collected_at)
                VALUES (:id, :pid, :acc, :site, :at)
                ON CONFLICT (accession) DO UPDATE SET patient_id = EXCLUDED.patient_id, site = EXCLUDED.site,
                collected_at = EXCLUDED.collected_at"""),
        {"id": uuid4(), "pid": patient_id, "acc": accession, "site": _text(r.get("type")),
         "at": (r.get("collection") or {}).get("collectedDateTime")},
    )


_HANDLERS = {
    "Observation": _observation,
    "Condition": _condition,
    "AllergyIntolerance": _allergy,
    "MedicationRequest": _medication_request,
    "Encounter": _encounter,
    "DocumentReference": _note,
}


def process_raw_records(s: Session, source_system: str, raw_record_ids: list[UUID]) -> dict[str, int]:
    """Stages 4-5 and 8 (7A.5): map newly landed raw_record rows into clinical tables, then run alert rules."""
    if not raw_record_ids:
        return {}

    rows = s.execute(
        text("SELECT id, resource_type, payload FROM raw_record WHERE id = ANY(:ids) AND processed_at IS NULL"),
        {"ids": raw_record_ids},
    ).mappings().all()

    # Patient resources must resolve identity first so other resources can attach.
    patients = [r for r in rows if r["resource_type"] == "Patient"]
    others = [r for r in rows if r["resource_type"] != "Patient"]

    patient_id_by_fhir_ref: dict[str, UUID] = {}
    counts: dict[str, int] = {}
    touched: set[UUID] = set()

    def done(r) -> None:
        s.execute(text("UPDATE raw_record SET processed_at = :now WHERE id = :id"),
                  {"now": datetime.now(timezone.utc), "id": r["id"]})
        counts[r["resource_type"]] = counts.get(r["resource_type"], 0) + 1

    for r in patients:
        resource = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        patient_id_by_fhir_ref[resource["id"]] = _find_or_create_patient(s, source_system, resource)
        done(r)

    for r in others:
        rtype = r["resource_type"]
        if rtype not in _HANDLERS and rtype != "Specimen":
            continue  # spec 8 rule 4: unknown types are skipped (kept in raw_record), never crash
        resource = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]

        ref_obj = resource.get("subject") or resource.get("patient") or {}
        subject_ref = ref_obj.get("reference", "")
        fhir_patient_id = subject_ref.split("/")[-1] if subject_ref else None
        patient_id = patient_id_by_fhir_ref.get(fhir_patient_id)
        if patient_id is None and fhir_patient_id:
            # Patient wasn't in this bundle's landed set (already processed earlier run).
            patient_id = s.execute(
                text("""SELECT patient_id FROM patient_identity
                        WHERE source_system = :src AND source_patient_ref = :ref AND active"""),
                {"src": source_system, "ref": fhir_patient_id},
            ).scalar()
        if patient_id is None:
            continue  # can't attach an orphaned clinical resource; SPEC-QUESTION: log this?

        if rtype == "Specimen":
            _specimen(s, patient_id, resource)
        else:
            object_type, table, cols = _HANDLERS[rtype](s, patient_id, resource)
            row = _upsert(s, object_type, table, source_system, resource["id"], r["id"], cols)
            if object_type == "MedicationRequest":
                links.med_to_inventory(s, row)
            index.index_object(s, object_type, row)  # stage 7: re-chunk and re-embed searchable text
            evaluate_object(s, object_type, row["id"], patient_id, row)
        touched.add(patient_id)
        done(r)

    for patient_id in touched | set(patient_id_by_fhir_ref.values()):  # stage 6: cross-source rules per patient
        raise_source_conflicts(s, patient_id)
    return counts


def raise_source_conflicts(s: Session, patient_id: UUID) -> None:
    """SOURCE_CONFLICT (spec 11, 12): both records are kept; the attending is told which source lacks one."""
    for c in links.cross_source_conflict(s, patient_id):
        what = f"{c['name']} allergy" if c["object_type"] == "Allergy" else c["name"]
        missing = ", ".join(SOURCE_LABELS.get(m, m) for m in c["missing_from"])
        title = f"{what} not in {missing} records"
        for uid in _attendings_for(s, patient_id):
            raise_alert(s, AlertDraft("SOURCE_CONFLICT", "warning", title, detail=(
                f"Recorded by {SOURCE_LABELS.get(c['source_system'], c['source_system'])}; absent from {missing}."),
                patient_id=patient_id, user_id=uid, source_ids=[str(c["id"])]), c["id"])


def ingest_bundle(s: Session, p: Principal, payload: IngestBundleRequest) -> dict:
    """Entry point called from ontology.apply_action('ingest_bundle', ...)."""
    provider = s.execute(
        text("SELECT name, fhir_base_url, kind FROM provider WHERE id = :id"),
        {"id": payload.provider_id},
    ).mappings().first()
    if not provider:
        raise LookupError(f"Provider {payload.provider_id} not found")

    adapter = HapiAdapter(provider_id=payload.provider_id, base_url=provider["fhir_base_url"])
    bundle = adapter.fetch_everything(payload.fhir_patient_id)

    source_system = provider.get("name") or provider["kind"]

    landed_ids = land_bundle(s, source_system, bundle)
    counts = process_raw_records(s, source_system, landed_ids)
    return {"landed": len(landed_ids), "processed": counts}