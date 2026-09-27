"""Ingestion pipeline (spec section 7A.3-7A.5). Owner: Alessandra.

Two stages:
  1. land_bundle: every FHIR resource in a $everything Bundle -> raw_record (append-only).
  2. process_raw_records: unprocessed raw_record rows -> typed clinical tables,
     with patient identity resolution and object_version history.
"""
import hashlib
import json
from datetime import date, datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.ehr.hapi import HapiAdapter

# Only these resource types are mapped into clinical tables today. Everything else
# still lands in raw_record for history/audit, but isn't surfaced through ontology yet. 
_MAPPED_TYPES = {"Patient", "Encounter", "Observation", "Condition",
                  "AllergyIntolerance", "MedicationRequest"}


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
    the same bundle is a no-op for unchanged resources."""
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
                    ON CONFLICT (source_system, source_ref, payload_hash) DO NOTHING
                    RETURNING id"""),
            {"src": source_system, "ref": source_ref, "rtype": resource_type,
             "payload": json.dumps(resource), "hash": _payload_hash(resource),
             "fetched": datetime.now(timezone.utc)},
        ).first()
        if row:
            landed_ids.append(row[0])
    return landed_ids


def _find_or_create_patient(s: Session, source_system: str, fhir_patient: dict) -> UUID:
    """Identity resolution (7A.4). Deterministic match on (source_system,
    source_patient_ref) first; falls back to demographic match; else creates a new
    canonical patient."""
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

    # Try a same-name-and-birthdate match against an already-linked patient from
    # a *different* source (cross-source identity resolution).
    match = None
    if family and birth_date:
        match = s.execute(
            text("""SELECT id FROM patient WHERE family_name = :fam AND given_name = :giv
                    AND birth_date = :dob LIMIT 1"""),
            {"fam": family, "giv": given, "dob": birth_date},
        ).scalar()

    if match:
        patient_id = match
        match_method = "demographic"
        score = 0.9
    else:
        patient_id = uuid4()
        match_method = "new"
        score = 1.0
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
    return patient_id


def _record_version(s: Session, object_type: str, object_id: UUID, data: dict, raw_record_id: UUID) -> None:
    version = s.execute(
        text("SELECT COALESCE(MAX(version), 0) + 1 FROM object_version WHERE object_type = :t AND object_id = :i"),
        {"t": object_type, "i": object_id},
    ).scalar()
    s.execute(
        text("""INSERT INTO object_version (object_type, object_id, version, data, raw_record_id)
                VALUES (:t, :i, :v, :d, :r)"""),
        {"t": object_type, "i": object_id, "v": version, "d": json.dumps(data), "r": raw_record_id},
    )


def _process_observation(s: Session, patient_id: UUID, resource: dict, source_system: str, raw_record_id: UUID) -> None:
    code = (resource.get("code", {}).get("coding") or [{}])[0]
    display_fallback = resource.get("code", {}).get("text", "Observation")
    
    value_num, unit, value_text = None, None, None
    if "valueQuantity" in resource:
        value_num = resource["valueQuantity"].get("value")
        unit = resource["valueQuantity"].get("unit")
    elif "valueString" in resource:
        value_text = resource["valueString"]
    elif "valueCodeableConcept" in resource:
        # Extra safety check if smoking status is stored as a concept string
        value_text = resource["valueCodeableConcept"].get("text") or (resource["valueCodeableConcept"].get("coding") or [{}])[0].get("display")

    ref_range = (resource.get("referenceRange") or [{}])[0]

    obs_id = uuid4()
    s.execute(
        text("""INSERT INTO observation (id, patient_id, category,
                loinc_code, display, value_num, value_text, unit, ref_low, ref_high,
                interpretation, source_system, source_ref, effective_at)
                VALUES (:id, :pid, :cat, :code, :disp, :vnum, :vtext, :unit, :lo, :hi,
                :interp, :src, :ref, :eff)"""),
        {"id": obs_id, "pid": patient_id,
         "cat": (resource.get("category") or [{}])[0].get("coding", [{}])[0].get("code", "unknown"),
         "code": code.get("code"), 
         "disp": code.get("display") or display_fallback,  # <-- USE display_fallback HERE
         "vnum": value_num, "vtext": value_text, "unit": unit,
         "lo": ref_range.get("low", {}).get("value"), "hi": ref_range.get("high", {}).get("value"),
         "interp": (resource.get("interpretation") or [{}])[0].get("coding", [{}])[0].get("code"),
         "src": source_system, "ref": resource.get("id"), "eff": resource.get("effectiveDateTime")},
    )
    _record_version(s, "Observation", obs_id, resource, raw_record_id)


def _process_condition(s: Session, patient_id: UUID, resource: dict, source_system: str, raw_record_id: UUID) -> None:
    code = (resource.get("code", {}).get("coding") or [{}])[0]
    cond_id = uuid4()
    s.execute(
        text("""INSERT INTO condition (id, patient_id, code, display, clinical_status,
                source_system, source_ref, effective_at)
                VALUES (:id, :pid, :code, :disp, :status, :src, :ref, :eff)"""),
        {"id": cond_id, "pid": patient_id, "code": code.get("code"),
         "disp": code.get("display", "Condition"),
         "status": (resource.get("clinicalStatus", {}).get("coding") or [{}])[0].get("code"),
         "src": source_system, "ref": resource["id"], "eff": resource.get("onsetDateTime")},
    )
    _record_version(s, "Condition", cond_id, resource, raw_record_id)


def _process_allergy(s: Session, patient_id: UUID, resource: dict, source_system: str, raw_record_id: UUID) -> None:
    code = resource.get("code", {})
    substance = (code.get("coding") or [{}])[0].get("display") or code.get("text", "Unknown substance")
    reaction = (resource.get("reaction") or [{}])[0]
    allergy_id = uuid4()
    s.execute(
        text("""INSERT INTO allergy (id, patient_id, substance, reaction, criticality,
                source_system, source_ref)
                VALUES (:id, :pid, :sub, :rxn, :crit, :src, :ref)"""),
        {"id": allergy_id, "pid": patient_id, "sub": substance,
         "rxn": (reaction.get("manifestation") or [{}])[0].get("coding", [{}])[0].get("display"),
         "crit": resource.get("criticality"), "src": source_system, "ref": resource["id"]},
    )
    _record_version(s, "Allergy", allergy_id, resource, raw_record_id)


def _process_medication_request(s: Session, patient_id: UUID, resource: dict, source_system: str, raw_record_id: UUID) -> None:
    med_id = uuid4()
    dosage = (resource.get("dosageInstruction") or [{}])[0].get("text", "")
    s.execute(
        text("""INSERT INTO medication_request (id, patient_id, status, dosage_text,
                source_system, source_ref)
                VALUES (:id, :pid, :status, :dose, :src, :ref)"""),
        {"id": med_id, "pid": patient_id, "status": resource.get("status", "unknown"),
         "dose": dosage, "src": source_system, "ref": resource["id"]},
    )
    _record_version(s, "MedicationRequest", med_id, resource, raw_record_id)


def process_raw_records(s: Session, source_system: str, raw_record_ids: list[UUID]) -> dict[str, int]:
    """Stage 2 (7A.4-7A.5): map unprocessed raw_record rows into clinical tables."""
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

    for r in patients:
        resource = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        pid = _find_or_create_patient(s, source_system, resource)
        patient_id_by_fhir_ref[resource["id"]] = pid
        _record_version(s, "Patient", pid, resource, r["id"])
        s.execute(text("UPDATE raw_record SET processed_at = :now WHERE id = :id"),
                  {"now": datetime.now(timezone.utc), "id": r["id"]})
        counts["Patient"] = counts.get("Patient", 0) + 1

    handlers = {
        "Observation": _process_observation,
        "Condition": _process_condition,
        "AllergyIntolerance": _process_allergy,
        "MedicationRequest": _process_medication_request,
    }

    for r in others:
        rtype = r["resource_type"]
        if rtype not in handlers:
            continue
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

        handlers[rtype](s, patient_id, resource, source_system, r["id"])
        s.execute(text("UPDATE raw_record SET processed_at = :now WHERE id = :id"),
                  {"now": datetime.now(timezone.utc), "id": r["id"]})
        counts[rtype] = counts.get(rtype, 0) + 1

    return counts


def ingest_bundle(s: Session, p: Principal, payload: IngestBundleRequest) -> dict:
    """Entry point called from ontology.apply_action('ingest_bundle', ...)."""
    provider = s.execute(
        text("SELECT fhir_base_url, kind FROM provider WHERE id = :id"),
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