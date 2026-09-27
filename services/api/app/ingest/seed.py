"""Database and ingestion seed script (spec section 16). Owner: Alessandra."""
import csv
import json
import logging
import shutil
import time
from datetime import datetime, timedelta
from datetime import time as clock
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.log import write_audit
from app.auth.principal import Principal
from app.config import settings
from app.dev_seed import GREGORY, LINDA, PRIYA, REYES
from app.ehr.hapi import HapiAdapter
from app.ingest import feeds
from app.ingest.pipeline import IngestBundleRequest
from app.ontology.api import apply_action, create_task_for_attending

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingest.seed")

SYSTEM_PRINCIPAL = Principal(user_id=UUID("00000000-0000-0000-0000-000000000000"), role="admin", actor_kind="system")

DEFAULT_PROVIDERS = [
    {"id": UUID("11111111-1111-1111-1111-111111111111"), "name": "ehr-a",
     "fhir_base_url": "http://ehr-a:8080/fhir", "kind": "clinic"},
    {"id": UUID("22222222-2222-2222-2222-222222222222"), "name": "ehr-b",
     "fhir_base_url": "http://ehr-b:8080/fhir", "kind": "hospital"},
]

SEED_DIR = Path("/srv/data/seed")
GOLDEN_DIR = SEED_DIR / "golden"
SLIDES_CSV = SEED_DIR / "slides.csv"
# Spec 17 step 4: Gregory's slide is analyzed on stage, so it gets an "analyze" task and no pre-computed finding.
ANALYZE_LIVE = {"NSO-GH-2026-001"}
# Spec 16: Dr. Reyes has 9 appointments today, Gregory at 10:30 and Linda at 11:15.
GOLDEN_VISITS = {GREGORY: (clock(10, 30), "Biopsy results"), LINDA: (clock(11, 15), "Potassium follow-up"),
                 PRIYA: (clock(9, 30), "Treatment planning")}
OTHER_SLOTS = [clock(8, 0), clock(8, 30), clock(9, 0), clock(13, 0), clock(13, 30), clock(14, 0), clock(14, 30)]

# Spec 16 seed step 3: Gregory's Riverside (ehr-a) history stays in ehr-a until the demo's transcript
# request pulls it, so the chart visibly fills in on stage. Loaded into HAPI, not ingested.
HELD_FOR_TRANSCRIPT_DEMO = {(DEFAULT_PROVIDERS[0]["id"], "gregory-a")}

def ensure_medications_and_inventory(s: Session) -> None:
    """Spec 16 inventory seed, from the same CSV the live feed polls: data/seed/inventory.csv is copied to the
    inbox once, so an edit made there for the demo survives a reseed."""
    inbox = feeds.INBOX / "inventory.csv"
    if not inbox.exists():
        inbox.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SEED_DIR / "inventory.csv", inbox)
    feeds.sync_inventory(s, inbox)
    s.commit()
    logger.info("Medication + inventory seeds verified.")


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


def seed_slides(s: Session) -> None:
    """Spec 16 step 4: slides from slides.csv, seeded (not uploaded) so the file name matches what the Lab
    Technician keys on. Every slide but Gregory's gets its pre-computed Finding now (spec 17 backup plan)."""
    from app.routes.lab import _post, store_finding
    from asclep_contracts import ClassifyResult

    for row in csv.DictReader(SLIDES_CSV.open(encoding="utf-8")):
        accession, path = row["specimen_accession"], f"slides/{row['file_name']}"
        specimen = s.execute(text("SELECT id, patient_id FROM specimen WHERE accession = :a"),
                             {"a": accession}).mappings().first()
        if specimen is None:
            logger.warning(f"slides.csv: no specimen {accession} (was its bundle ingested?)")
            continue
        slide_id = s.execute(text("SELECT id FROM slide WHERE file_path = :f"), {"f": path}).scalar() or \
            s.execute(text("INSERT INTO slide (specimen_id, file_path) VALUES (:sp, :f) RETURNING id"),
                      {"sp": specimen["id"], "f": path}).scalar()
        if accession in ANALYZE_LIVE:
            create_task_for_attending(s, specimen["patient_id"], "analyze_slide", "Biopsy slide ready to analyze",
                                      slide_id)
        elif not s.execute(text("SELECT 1 FROM finding WHERE slide_id = :id"), {"id": slide_id}).first():
            try:
                result = _post(f"{settings.labtech_url}/classify", {"slide_id": str(slide_id), "file_path": path},
                               ClassifyResult, "Lab Technician")
            except Exception as e:  # lab-tech down: the slide stays analyzable from the Lab tab
                logger.error(f"Pre-computing the finding for {accession} failed: {e}")
            else:
                finding = store_finding(s, slide_id, specimen["patient_id"], result)
                write_audit(s, None, "create", "Finding", finding["id"], specimen["patient_id"], ai="lab_tech",
                            ran_on="local")
                logger.info(f"{accession}: {result.label} ({result.confidence:.2f}), expected {row['expected_label']}")
        s.commit()


def seed_appointments(s: Session) -> None:
    """Today's schedule for Dr. Reyes: the golden patients at their scripted times, then her other care-team
    patients (Synthea) in the remaining slots, up to 9 visits. Re-running adds nothing."""
    tz = ZoneInfo(settings.demo_tz)
    today = datetime.now(tz).date()
    others = s.execute(text("""SELECT patient_id FROM care_team_member WHERE user_id = :u
                               AND NOT (patient_id = ANY(:golden)) ORDER BY patient_id LIMIT :n"""),
                       {"u": REYES, "golden": list(GOLDEN_VISITS), "n": len(OTHER_SLOTS)}).scalars()
    visits = [(pid, at, reason) for pid, (at, reason) in GOLDEN_VISITS.items()] + \
        [(pid, at, "Follow-up") for pid, at in zip(others, OTHER_SLOTS)]
    for pid, at, reason in visits:
        start = datetime.combine(today, at, tz)
        s.execute(text("""INSERT INTO appointment (patient_id, user_id, start_at, end_at, reason)
                          SELECT :p, :u, :s, :e, :r WHERE EXISTS (SELECT 1 FROM patient WHERE id = :p)
                          AND NOT EXISTS (SELECT 1 FROM appointment WHERE patient_id = :p AND user_id = :u
                                          AND start_at = :s)"""),
                  {"p": pid, "u": REYES, "s": start, "e": start + timedelta(minutes=30), "r": reason})
    s.commit()
    logger.info(f"Appointments for {today}: {len(visits)} scheduled for Dr. Reyes.")


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

        seed_slides(session)
        seed_appointments(session)
        notes = feeds.ingest_note_drops(session, SEED_DIR / "notes")  # Gregory's shadowing notes (spec 7A.3)
        session.commit()
        logger.info(f"Seed notes ingested: {notes}.")

        from app.alerts.engine import sweep_all
        raised = sweep_all(session)
        session.commit()
        logger.info(f"Sweep raised {len(raised)} alert(s).")


if __name__ == "__main__":
    seed_ingestion()