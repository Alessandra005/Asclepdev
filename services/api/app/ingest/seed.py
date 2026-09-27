"""Database and ingestion seed script (spec section 16). Owner: Alessandra."""
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.principal import Principal
from app.ehr.hapi import HapiAdapter
from app.ingest.pipeline import IngestBundleRequest
from app.ontology.api import apply_action

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingest.seed")

SYSTEM_PRINCIPAL = Principal(user_id=UUID("00000000-0000-0000-0000-000000000000"), role="admin")

DEFAULT_PROVIDERS = [
    {"id": UUID("11111111-1111-1111-1111-111111111111"), "name": "ehr-a",
     "fhir_base_url": "http://ehr-a:8080/fhir", "kind": "clinic"},
    {"id": UUID("22222222-2222-2222-2222-222222222222"), "name": "ehr-b",
     "fhir_base_url": "http://ehr-b:8080/fhir", "kind": "hospital"},
]

GOLDEN_DIR = Path("/srv/data/seed/golden")

# Spec 16 seed step 3: Gregory's Riverside (ehr-a) history stays in ehr-a until the demo's transcript
# request pulls it, so the chart visibly fills in on stage. Loaded into HAPI, not ingested.
HELD_FOR_TRANSCRIPT_DEMO = {(DEFAULT_PROVIDERS[0]["id"], "gregory-a")}

MEDICATIONS = [
    {"name": "Pembrolizumab 100 mg/4 mL", "on_hand": 0, "reorder_point": 5, "backordered": True, "restock_days": 6},
    {"name": "Carboplatin 450 mg/45 mL", "on_hand": 14, "reorder_point": 5, "backordered": False, "restock_days": None},
    {"name": "Pemetrexed 500 mg", "on_hand": 3, "reorder_point": 5, "backordered": False, "restock_days": 2},
    {"name": "Albuterol inhaler", "on_hand": 40, "reorder_point": 10, "backordered": False, "restock_days": None},
]


def ensure_medications_and_inventory(s: Session) -> dict[str, UUID]:
    """Seed medication + inventory_item rows. Returns name -> medication_id."""
    ids: dict[str, UUID] = {}
    for med in MEDICATIONS:
        med_id = s.execute(
            text("SELECT id FROM medication WHERE name = :name"), {"name": med["name"]}
        ).scalar()
        if med_id is None:
            med_id = uuid.uuid4()
            s.execute(
                text("INSERT INTO medication (id, name) VALUES (:id, :name)"),
                {"id": med_id, "name": med["name"]},
            )
        ids[med["name"]] = med_id

        restock_at = None
        if med["restock_days"] is not None:
            restock_at = datetime.now(timezone.utc) + timedelta(days=med["restock_days"])

        existing = s.execute(
            text("SELECT id FROM inventory_item WHERE medication_id = :mid"), {"mid": med_id}
        ).scalar()
        if existing is None:
            s.execute(
                text("""INSERT INTO inventory_item (medication_id, on_hand, reorder_point, backordered, expected_restock_at)
                        VALUES (:mid, :oh, :rp, :bo, :restock)"""),
                {"mid": med_id, "oh": med["on_hand"], "rp": med["reorder_point"],
                 "bo": med["backordered"], "restock": restock_at},
            )
    s.commit()
    logger.info("Medication + inventory seeds verified.")
    return ids

def ensure_care_team(s: Session) -> None:
    """SPEC-QUESTION(Ron): who owns real care-team assignment? Seeding a minimal
    attending link per golden patient so alert rules have someone to notify."""
    s.execute(
        text("""INSERT INTO care_team_member (patient_id, user_id, relationship)
                SELECT p.id, :uid, 'attending' FROM patient p
                ON CONFLICT DO NOTHING"""),
        {"uid": UUID("00000000-0000-0000-0000-000000000001")},  # your test admin user
    )
    s.commit()
    logger.info("Care team seeds verified.")

    
def _wait_for_hapi(base_url: str, timeout: float = 90.0) -> None:
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urlopen(f"{base_url.rstrip('/')}/metadata", timeout=3.0):
                return
        except (URLError, OSError) as exc:
            last_error = exc
            time.sleep(2.0)
    raise TimeoutError(f"{base_url} did not become ready within {timeout}s: {last_error}")


def ensure_providers(s: Session) -> None:
    for p in DEFAULT_PROVIDERS:
        s.execute(
            text("""INSERT INTO provider (id, name, fhir_base_url, kind) VALUES (:id, :name, :url, :kind)
                    ON CONFLICT (id) DO UPDATE SET fhir_base_url = EXCLUDED.fhir_base_url,
                    name = EXCLUDED.name, kind = EXCLUDED.kind"""),
            {"id": p["id"], "name": p["name"], "url": p["fhir_base_url"], "kind": p["kind"]},
        )
    s.commit()
    logger.info("Provider seeds verified.")


def _provider_for_filename(name: str) -> dict | None:
    if "ehr-a" in name:
        return DEFAULT_PROVIDERS[0]
    if "ehr-b" in name:
        return DEFAULT_PROVIDERS[1]
    return None


def _split_by_provider(fixtures: list[tuple[str, dict, dict]]) -> dict[UUID, list[tuple[str, dict]]]:
    grouped: dict[UUID, list[tuple[str, dict]]] = {}
    for name, bundle, provider in fixtures:
        grouped.setdefault(provider["id"], []).append((name, bundle))
    return grouped


def load_golden_bundles() -> list[tuple[UUID, str]]:
    if not GOLDEN_DIR.exists():
        raise FileNotFoundError(f"{GOLDEN_DIR} not found inside the container.")

    fixtures: list[tuple[str, dict, dict]] = []
    for fixture_path in sorted(GOLDEN_DIR.glob("*.json")):
        provider = _provider_for_filename(fixture_path.name)
        if provider is None:
            logger.warning(f"Skipping {fixture_path.name}: can't tell which provider it belongs to")
            continue
        bundle = json.loads(fixture_path.read_text(encoding="utf-8"))
        fixtures.append((fixture_path.name, bundle, provider))

    targets: dict[tuple[UUID, str], None] = {}

    for provider_id, items in _split_by_provider(fixtures).items():
        provider = next(p for _, b, p in fixtures if p["id"] == provider_id)
        adapter = HapiAdapter(provider_id=provider_id, base_url=provider["fhir_base_url"])

        patient_entries, other_entries = [], []
        for name, bundle in items:
            for entry in bundle.get("entry", []):
                resource = entry.get("resource", {})
                if resource.get("resourceType") == "Patient":
                    patient_entries.append(entry)
                    targets[(provider_id, resource["id"])] = None
                else:
                    other_entries.append(entry)

        if patient_entries:
            adapter._request("POST", "/", {"resourceType": "Bundle", "type": "transaction", "entry": patient_entries})
            logger.info(f"Loaded {len(patient_entries)} patient(s) into {provider['name']}")
        if other_entries:
            adapter._request("POST", "/", {"resourceType": "Bundle", "type": "transaction", "entry": other_entries})
            logger.info(f"Loaded {len(other_entries)} other resource(s) into {provider['name']}")

    return list(targets.keys())


def seed_ingestion() -> None:
    from app.db import SessionLocal

    for provider in DEFAULT_PROVIDERS:

        logger.info(f"Waiting for {provider['name']} to be ready...")
        _wait_for_hapi(provider["fhir_base_url"])
    logger.info("All mock EHR servers ready.")

    with SessionLocal() as session:
        ensure_providers(session)
        ensure_medications_and_inventory(session)
        targets = load_golden_bundles()

        for provider_id, fhir_patient_id in targets:
            if (provider_id, fhir_patient_id) in HELD_FOR_TRANSCRIPT_DEMO:
                logger.info(f"Holding back '{fhir_patient_id}' for the transcript-request demo (spec 16).")
                continue
            logger.info(f"Ingesting patient '{fhir_patient_id}' from provider {provider_id}...")
            try:
                req = IngestBundleRequest(provider_id=provider_id, fhir_patient_id=fhir_patient_id)
                res = apply_action(session, SYSTEM_PRINCIPAL, "ingest_bundle", req)
                session.commit()
                logger.info(f"Ingested {fhir_patient_id}: {res}")
            except Exception as e:
                session.rollback()
                logger.error(f"Failed ingesting {fhir_patient_id}: {e}")

        ensure_care_team(session)
        session.commit()

        from app.alerts.engine import sweep_all
        raised = sweep_all(session)
        session.commit()
        logger.info(f"Sweep raised {len(raised)} alert(s).")


if __name__ == "__main__":
    seed_ingestion()