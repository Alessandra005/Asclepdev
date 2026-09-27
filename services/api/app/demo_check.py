"""Golden demo checks (spec 18.5). Run: make demo-check. Owner: Ron.

Talks to the running gateway over HTTP as the demo users, so it checks what the desktop will see.
Prints one PASS/FAIL line per check and exits non-zero if any fail.
"""
import sys
from pathlib import Path

import httpx
from sqlalchemy import text

from app.db import SessionLocal

BASE = "http://localhost:8000/api/v1"
GREGORY = "6f1c2a10-0000-4000-8000-000000000001"
PASSWORD = "asclep-demo"
GREGORY_QUESTION = ("Gregory Hale's biopsy came back, what did it show, and if I order pembrolizumab "
                    "how long until we have it?")
SLIDES_WANTED = 8  # spec 16: 8 TCGA demo slides, pre-embedded


def _token(email: str) -> dict:
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": PASSWORD}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def check_services() -> tuple[bool, str]:
    health = httpx.get(f"{BASE}/health", timeout=10).json()
    down = [k for k, v in health.items() if v != "up"]
    return not down, f"down: {', '.join(down)}" if down else "db, lab-tech, resident, ehr-a, ehr-b up"


def check_gregory_thin_chart() -> tuple[bool, str]:
    """Before the demo, Gregory has no Riverside (ehr-a) records: the transcript request pulls them live."""
    with SessionLocal() as s:
        n = s.execute(text("""SELECT (SELECT count(*) FROM condition WHERE patient_id = :p AND source_system = 'ehr-a')
                                   + (SELECT count(*) FROM allergy WHERE patient_id = :p AND source_system = 'ehr-a')
                                   + (SELECT count(*) FROM observation WHERE patient_id = :p AND source_system = 'ehr-a')"""),
                      {"p": GREGORY}).scalar()
    return n == 0, "no ehr-a records yet" if n == 0 else f"{n} ehr-a records already merged (run make seed to reset)"


def check_embeddings() -> tuple[bool, str]:
    cached = list((Path("/srv/data/embeddings")).glob("*.pt"))
    return len(cached) >= SLIDES_WANTED, f"{len(cached)}/{SLIDES_WANTED} slide embeddings cached"


def check_gregory_ask() -> tuple[bool, str]:
    r = httpx.post(f"{BASE}/ask", headers=_token("reyes@asclep.demo"),
                   json={"question": GREGORY_QUESTION, "patient_id": GREGORY}, timeout=120)
    if r.status_code != 200:
        return False, f"/ask returned {r.status_code}"
    kinds = {c.get("kind") for c in r.json().get("citations", [])}
    ok = {"finding", "inventory"} <= kinds
    return ok, "cites the finding and the inventory row" if ok else f"citation kinds: {sorted(kinds) or 'none'}"


def check_wu_denied() -> tuple[bool, str]:
    r = httpx.get(f"{BASE}/patients/{GREGORY}", headers=_token("wu@asclep.demo"), timeout=10)
    code = r.json().get("error", {}).get("code") if r.status_code == 403 else None
    return code == "FORBIDDEN_NOT_ON_CARE_TEAM", f"HTTP {r.status_code} {code or ''}".strip()


CHECKS = [("All services healthy", check_services), ("Gregory has no ehr-a records", check_gregory_thin_chart),
          ("Demo slides pre-embedded", check_embeddings), ("Gregory Ask query", check_gregory_ask),
          ("Dr. Wu denied on Gregory", check_wu_denied)]


def main() -> int:
    failed = 0
    for name, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as exc:  # a check that cannot run is a failure, never a skip
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
