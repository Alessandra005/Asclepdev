"""Development seed: demo users, the three demo patients and their care teams. Synthetic data only.

Run: docker compose -f infra/docker-compose.yml --env-file infra/.env exec api python -m app.dev_seed

A stopgap until Alessandra's `app.ingest.seed` (spec 16) lands. Patient ids match the desktop mock
(apps/desktop/src/renderer/api/mock/data.ts IDS) so mixed mode (real login + mocked patient pages) lines up.
Idempotent: re-running changes nothing. Also copies the patients into MongoDB for LiveScribing.
"""
from datetime import date

from sqlalchemy import text

from app.auth.security import hash_password
from app.db import SessionLocal
from app.live_scribe.store import get_store, mongo_errors, patient_document

PASSWORD = "asclep-demo"
GREGORY, LINDA, PRIYA = (f"6f1c2a10-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))

USERS = [  # (id, email, full name, role)
    ("0d000000-0000-4000-8000-000000000001", "admin@asclep.demo", "Jordan Kim", "admin"),
    ("0d000000-0000-4000-8000-000000000002", "reyes@asclep.demo", "Dr. Maya Reyes", "physician"),
    ("0d000000-0000-4000-8000-000000000003", "okafor@asclep.demo", "Ada Okafor, RN", "nurse"),
    ("0d000000-0000-4000-8000-000000000004", "lab@asclep.demo", "Sam Patel", "lab_staff"),
    ("0d000000-0000-4000-8000-000000000005", "wu@asclep.demo", "Dr. Henry Wu", "physician"),
]
PATIENTS = [  # (id, mrn, given, family, birth date, sex)
    (GREGORY, "NS-004417", "Gregory", "Hale", date(1962, 3, 14), "M"),
    (LINDA, "NS-002981", "Linda", "Morales", date(1955, 6, 2), "F"),
    (PRIYA, "NS-003350", "Priya", "Shah", date(1968, 1, 20), "F"),
]
REYES, OKAFOR, WU = USERS[1][0], USERS[2][0], USERS[4][0]
CARE_TEAM = [  # (patient, user, relationship)
    *((p, REYES, "attending") for p in (GREGORY, LINDA, PRIYA)),
    *((p, OKAFOR, "nurse") for p in (GREGORY, LINDA, PRIYA)),
    (LINDA, WU, "attending"),
    (PRIYA, WU, "attending"),
]


def main() -> None:
    pw = hash_password(PASSWORD)
    with SessionLocal() as s:
        for uid, email, name, role in USERS:
            s.execute(text("INSERT INTO app_user (id, email, full_name, password_hash, role) "
                           "VALUES (:i, :e, :n, :h, :r) ON CONFLICT (email) DO NOTHING"),
                      {"i": uid, "e": email, "n": name, "h": pw, "r": role})
        for pid, mrn, given, family, born, sex in PATIENTS:
            s.execute(text("INSERT INTO patient (id, mrn, given_name, family_name, birth_date, sex, source_system) "
                           "VALUES (:i, :m, :g, :f, :b, :s, 'ehr-b') ON CONFLICT (id) DO NOTHING"),
                      {"i": pid, "m": mrn, "g": given, "f": family, "b": born, "s": sex})
        for pid, uid, rel in CARE_TEAM:
            s.execute(text("INSERT INTO care_team_member (patient_id, user_id, relationship) "
                           "VALUES (:p, :u, :r) ON CONFLICT DO NOTHING"), {"p": pid, "u": uid, "r": rel})
        s.commit()
    store = get_store()
    with mongo_errors():
        for pid, mrn, given, family, born, sex in PATIENTS:
            store.upsert_patient(patient_document({"id": pid, "mrn": mrn, "given_name": given, "family_name": family,
                                                   "birth_date": born, "sex": sex, "source_system": "ehr-b"}))
    print(f"Seeded {len(USERS)} users (password {PASSWORD}), {len(PATIENTS)} patients, "
          f"{len(CARE_TEAM)} care-team links; patients copied to MongoDB.")


if __name__ == "__main__":
    main()
