from app.ingest.pipeline import _normalize_lab_value


def test_normalize_lab_value_preserves_known_unit() -> None:
    assert _normalize_lab_value("2345-7", 110, "mg/dL") == (110.0, "mg/dL")


def test_normalize_lab_value_preserves_missing_unit() -> None:
    assert _normalize_lab_value("2345-7", 110, None) == (110.0, None)


def test_normalize_lab_value_preserves_none_value() -> None:
    assert _normalize_lab_value("2345-7", None, "mg/dL") == (None, "mg/dL")


class UpsertSession:
    """Plays one row of a clinical table: SELECT finds it once inserted; UPDATE bumps its version."""

    def __init__(self):
        self.row, self.versions = None, []

    def execute(self, stmt, params=None):
        sql, outer = str(stmt), self

        class _R:
            def mappings(self):
                return self

            def first(self):
                return outer.row

            def one(self):
                if sql.lstrip().startswith("INSERT"):
                    outer.row = {"id": params["id"], "version": 1, "raw_record_id": params["raw"],
                                 "value_num": params["value_num"]}
                else:  # UPDATE
                    outer.row = {**outer.row, "version": outer.row["version"] + 1, "raw_record_id": params["raw"],
                                 "value_num": params["value_num"]}
                return outer.row

        if "object_version" in sql:
            self.versions.append(params)
        return _R()


def test_changed_payload_updates_in_place_and_versions_the_prior_row() -> None:
    from uuid import uuid4

    from app.ingest.pipeline import _upsert
    s, raw1, raw2 = UpsertSession(), uuid4(), uuid4()
    first = _upsert(s, "Observation", "observation", "ehr-b", "linda-k", raw1, {"value_num": 6.4})
    second = _upsert(s, "Observation", "observation", "ehr-b", "linda-k", raw2, {"value_num": 5.1})
    assert second["id"] == first["id"] and second["version"] == 2 and second["value_num"] == 5.1  # no duplicate row
    assert [(v["v"], v["r"]) for v in s.versions] == [(1, raw1)]  # the superseded row, not the new payload


def test_interpretation_recomputed_only_when_a_range_exists() -> None:
    from app.ingest.pipeline import _interpretation
    assert [_interpretation(v, 3.5, 5.1) for v in (6.4, 3.0, 4.2)] == ["H", "L", "N"]
    assert _interpretation(4.2, None, None) is None


def test_imaging_documents_become_imaging_reports() -> None:
    from app.ingest.pipeline import _note
    doc = {"type": {"text": "Chest X-ray note"}, "content": [{"attachment": {"data": "Q2hlc3QgIFgtcmF5Lg=="}}]}
    assert _note(None, "p", doc)[2]["kind"] == "imaging_report"
    assert _note(None, "p", doc)[2]["body"] == "Chest X-ray."
    assert _note(None, "p", {"type": {"text": "Contact note"}})[2]["kind"] == "progress"
    bad = {"type": {"text": "CT imaging report"}, "content": [{"attachment": {"data": "Q1O"}}]}
    assert _note(None, "p", bad)[2]["body"] == "CT imaging report"
