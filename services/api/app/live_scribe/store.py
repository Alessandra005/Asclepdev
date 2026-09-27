"""MongoDB store for LiveScribing. Owner: Brandon.

Collections:
  patients         one document per patient, copied from Postgres (the ontology stays the source of truth)
  scribe_sessions  one document per visit: patient snapshot, conversation transcript, visual observations,
                   actions (possible symptoms) with the doctor's include checks, and the scribing report
Text only. Frames and audio never reach this database.
"""
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app.config import settings
from app.errors import AsclepError


def patient_document(row: dict[str, Any]) -> dict[str, Any]:
    """Postgres `patient` row -> Mongo `patients` document (and the snapshot kept on each session)."""
    birth = row["birth_date"]
    return {
        "_id": str(row["id"]),
        "mrn": row["mrn"],
        "name": f"{row['given_name']} {row['family_name']}",
        "given_name": row["given_name"],
        "family_name": row["family_name"],
        "birth_date": birth.isoformat() if isinstance(birth, date) else birth,
        "sex": row.get("sex"),
        "source_system": row.get("source_system"),
        "synced_at": datetime.now(UTC),
    }


class LiveScribeStore:
    def __init__(self, client: MongoClient, db_name: str):
        db = client[db_name]
        self.patients = db["patients"]
        self.sessions = db["scribe_sessions"]

    def upsert_patient(self, doc: dict[str, Any]) -> None:
        self.patients.replace_one({"_id": doc["_id"]}, doc, upsert=True)

    def create_session(self, doc: dict[str, Any]) -> None:
        self.sessions.insert_one(doc)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.sessions.find_one({"_id": session_id})

    def list_sessions(self, patient_id: str) -> list[dict[str, Any]]:
        return list(self.sessions.find({"patient_id": patient_id}).sort("started_at", -1).limit(50))

    def append_window(self, session_id: str, observations: list[dict], transcript: list[dict]) -> None:
        self.sessions.update_one(
            {"_id": session_id},
            {"$push": {"observations": {"$each": observations}, "transcript": {"$each": transcript}},
             "$inc": {"windows_analyzed": 1}},
        )

    def update_session(self, session_id: str, fields: dict[str, Any]) -> None:
        self.sessions.update_one({"_id": session_id}, {"$set": fields})


_client: MongoClient | None = None


def get_store() -> LiveScribeStore:
    """FastAPI dependency. Tests override it with an in-memory fake."""
    global _client
    if _client is None:
        _client = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=3000, tz_aware=True)
    return LiveScribeStore(_client, settings.mongo_db)


@contextmanager
def mongo_errors() -> Iterator[None]:
    """Turn driver errors (Mongo down, timeouts) into the spec 15 UPSTREAM_UNAVAILABLE envelope."""
    try:
        yield
    except PyMongoError as exc:
        raise AsclepError("UPSTREAM_UNAVAILABLE", "The LiveScribing database is unavailable.") from exc
