"""Alert engine: one alert per recipient, jsonb-safe source_ids, MED_BACKORDER falls back to attendings."""
import json
from uuid import uuid4

from app.alerts import engine
from app.alerts.engine import AlertDraft
from app.alerts.rules import med_backorder

REYES, WU = uuid4(), uuid4()


class Recorder:
    """Keeps inserted alerts; _already_fired sees them, so dedupe is exercised for real."""

    def __init__(self):
        self.alerts = []

    def execute(self, stmt, params=None):
        sql, outer = str(stmt), self

        class _R:
            def first(self):
                src = json.loads(params["src"])
                return next((a for a in outer.alerts if a["rid"] == params["rid"] and a["uid"] == params["uid"]
                             and set(src) <= set(json.loads(a["src"]))), None)

            def scalar(self):
                outer.alerts.append(params)
                return uuid4()

            def mappings(self):
                class _M:
                    def first(self):
                        return {"on_hand": 0, "backordered": True}
                return _M()

            def scalars(self):
                class _S:
                    def all(self):
                        return [REYES, WU] if "attending" in sql else []
                return _S()
        return _R()


def test_every_recipient_gets_one_alert_and_source_ids_are_json():
    s, obj, pid = Recorder(), uuid4(), uuid4()
    for uid in (REYES, WU, REYES):  # REYES twice: the repeat is deduped
        engine.raise_alert(s, AlertDraft("CRITICAL_LAB", "critical", "K 6.4", patient_id=pid, user_id=uid), obj)
    assert [a["uid"] for a in s.alerts] == [REYES, WU]
    assert json.loads(s.alerts[0]["src"]) == [str(obj)]


def test_med_backorder_without_requester_goes_to_attendings():
    row = {"status": "active", "medication_id": uuid4(), "requested_by": None}
    drafts = med_backorder.check(Recorder(), uuid4(), uuid4(), row)
    assert [d.user_id for d in drafts] == [REYES, WU]
