"""Polled feeds (spec 7A.3) and the alert sweep (spec 12), every 60 s inside the api process. Owner: Alessandra.

- InventoryCsvAdapter: data/inbox/inventory.csv -> medication + inventory_item. Editing a row (the pitch's
  restock-date trick) shows up in Ask within a minute.
- NoteDropAdapter: data/inbox/notes/*.json -> note. Shadowing notes are not legal record (is_legal_record=false).
- sweep_all: re-runs the alert rules, so a changed inventory row raises MED_BACKORDER without a new order.
"""
import csv
import json
import logging
import threading
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.log import write_audit
from app.config import settings
from app.ontology import index

INBOX = Path("/srv/data/inbox")
POLL_SECONDS = 60
logger = logging.getLogger("ingest.feeds")


def sync_inventory(s: Session, path: Path = INBOX / "inventory.csv") -> int:
    """Upsert every CSV row; returns how many inventory rows changed (each change is audited)."""
    if not path.exists():
        return 0
    # Restock offsets count from today's midnight, so the date stays put between polls.
    midnight = datetime.combine(datetime.now(ZoneInfo(settings.demo_tz)).date(), time(), ZoneInfo(settings.demo_tz))
    changed = 0
    for row in csv.DictReader(path.open(encoding="utf-8")):
        name = row["medication_name"].strip()
        # medication.name is UNIQUE (migration 004): a seed racing the feed thread inserts once, then both select.
        s.execute(text("INSERT INTO medication (id, name) VALUES (gen_random_uuid(), :n) ON CONFLICT (name) DO NOTHING"),
                  {"n": name})
        med_id = s.execute(text("SELECT id FROM medication WHERE name = :n"), {"n": name}).scalar()
        offset = (row.get("expected_restock_offset_days") or "").strip()
        values = {"m": med_id, "oh": int(row["on_hand"]), "rp": int(row["reorder_point"]),
                  "bo": row["backordered"].strip().lower() == "true",
                  "at": midnight + timedelta(days=int(offset)) if offset else None}
        item = s.execute(text("""
            INSERT INTO inventory_item (id, medication_id, on_hand, reorder_point, backordered, expected_restock_at)
            SELECT gen_random_uuid(), :m, :oh, :rp, :bo, :at
            WHERE NOT EXISTS (SELECT 1 FROM inventory_item WHERE medication_id = :m) RETURNING id"""), values).scalar()
        item = item or s.execute(text("""
            UPDATE inventory_item SET on_hand = :oh, reorder_point = :rp, backordered = :bo,
                   expected_restock_at = :at, updated_at = now()
            WHERE medication_id = :m AND (on_hand, reorder_point, backordered, expected_restock_at)
                  IS DISTINCT FROM (:oh, :rp, :bo, CAST(:at AS timestamptz)) RETURNING id"""), values).scalar()
        if item:
            write_audit(s, None, "update", "InventoryItem", item, reason="inventory-feed")
            changed += 1
    return changed


def ingest_note_drops(s: Session, folder: Path = INBOX / "notes") -> int:
    """Each JSON file is one note: {id, patient_mrn, kind, author_name, body, effective_at}. Unchanged files are
    skipped by payload hash (7A.5 stage 2); a changed file versions the note like any other source."""
    from app.ingest.pipeline import _payload_hash, _upsert

    added = 0
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            ref, kind, body = str(doc["id"]), doc["kind"], " ".join(doc["body"].split())
        except (ValueError, KeyError, AttributeError) as e:
            logger.warning(f"Skipping note drop {path.name}: {e}")
            continue
        raw_id = s.execute(text("""
            INSERT INTO raw_record (id, source_system, source_ref, resource_type, payload, payload_hash, fetched_at)
            VALUES (gen_random_uuid(), 'note-drop', :ref, 'DroppedNote', CAST(:p AS jsonb), :h, now())
            ON CONFLICT (source_system, source_ref, payload_hash) DO NOTHING RETURNING id"""),
            {"ref": ref, "p": json.dumps(doc), "h": _payload_hash(doc)}).scalar()
        if raw_id is None:
            continue  # already ingested, unchanged
        patient_id = s.execute(text("SELECT id FROM patient WHERE mrn = :m AND record_status = 'current'"),
                               {"m": doc.get("patient_mrn")}).scalar()
        if patient_id is None:
            s.execute(text("UPDATE raw_record SET error = 'unknown patient_mrn' WHERE id = :id"), {"id": raw_id})
            continue
        row = _upsert(s, "Note", "note", "note-drop", ref, raw_id, {
            "patient_id": patient_id, "kind": kind, "author_name": doc.get("author_name"), "body": body,
            "effective_at": doc.get("effective_at"), "is_legal_record": kind not in ("shadowing", "visual_scribe")})
        index.index_object(s, "Note", row)
        s.execute(text("UPDATE raw_record SET processed_at = now() WHERE id = :id"), {"id": raw_id})
        added += 1
    return added


def tick(s: Session) -> dict:
    from app.alerts.engine import sweep_all

    result = {"inventory_changed": sync_inventory(s), "notes_ingested": ingest_note_drops(s)}
    result["alerts_raised"] = len(sweep_all(s))
    return result


def start() -> threading.Event:
    """Run tick() now and every POLL_SECONDS on a daemon thread; set the returned event to stop."""
    from app.db import SessionLocal

    stop = threading.Event()

    def loop() -> None:
        try:
            index.embed(["warm up"])  # load the model now, not on demo step 3's consent click
        except Exception:  # e.g. no network for the first download: search stays empty, the feeds still run
            logger.exception("Embedding model warm-up failed")
        while True:
            with SessionLocal() as s:
                try:
                    result = tick(s)
                    s.commit()
                    if any(result.values()):
                        logger.info(f"Feeds: {result}")
                except Exception:  # a bad row or a DB blip must not kill the loop; retried next tick
                    s.rollback()
                    logger.exception("Feed tick failed")
            if stop.wait(POLL_SECONDS):
                return

    threading.Thread(target=loop, name="asclep-feeds", daemon=True).start()
    return stop
