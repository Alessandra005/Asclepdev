from datetime import date
from uuid import UUID

import pytest

from app.ehr.external import CernerAdapter, EpicAdapter
from app.ehr.hapi import HapiAdapter


def test_hapi_search_patient_builds_fhir_query(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = HapiAdapter(UUID(int=1), "http://ehr-a/fhir")
    captured: dict[str, object] = {}

    def fake_request(method: str, path: str, payload: dict | None = None) -> dict:
        captured.update(method=method, path=path, payload=payload)
        return {"entry": [{"resource": {"resourceType": "Patient", "id": "p1"}}]}

    monkeypatch.setattr(adapter, "_request", fake_request)
    assert adapter.search_patient("Hale", "Gregory", date(1962, 4, 12)) == [{"resourceType": "Patient", "id": "p1"}]
    assert captured["method"] == "GET"
    assert "family=Hale" in str(captured["path"])
    assert "birthdate=1962-04-12" in str(captured["path"])


def test_external_adapters_are_explicit_stubs() -> None:
    with pytest.raises(NotImplementedError):
        EpicAdapter(UUID(int=1)).fetch_everything("patient")
    with pytest.raises(NotImplementedError):
        CernerAdapter(UUID(int=1)).write_diagnostic_report({})