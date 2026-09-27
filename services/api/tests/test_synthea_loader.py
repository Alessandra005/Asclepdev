import importlib.util
import json
from pathlib import Path

import pytest


def _find_loader_path() -> Path | None:
    """Walk upward from this file looking for services/mock-ehr/load_synthea.py.
    Returns None when running somewhere that doesn't have it (e.g. inside the
    api container, which only has services/api copied in) instead of crashing."""
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "services" / "mock-ehr" / "load_synthea.py"
        if candidate.exists():
            return candidate
    return None


LOADER_PATH = _find_loader_path()

if LOADER_PATH is not None:
    LOADER_SPEC = importlib.util.spec_from_file_location("load_synthea", LOADER_PATH)
    assert LOADER_SPEC is not None and LOADER_SPEC.loader is not None
    LOADER_MODULE = importlib.util.module_from_spec(LOADER_SPEC)
    LOADER_SPEC.loader.exec_module(LOADER_MODULE)


@pytest.mark.skipif(LOADER_PATH is None, reason="services/mock-ehr not present in this checkout")
def test_transaction_bundle_uses_stable_put_urls() -> None:
    source = {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Patient", "id": "p1"}}]}
    transaction = LOADER_MODULE.transaction_bundle(source)
    assert transaction["type"] == "transaction"
    assert transaction["entry"][0]["request"] == {"method": "PUT", "url": "Patient/p1"}


def test_golden_fixtures_are_valid_json() -> None:
    golden_dir = None
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "data" / "seed" / "golden"
        if candidate.exists():
            golden_dir = candidate
            break
    if golden_dir is None:
        pytest.skip("data/seed/golden not present in this checkout")
    fixtures = list(golden_dir.glob("*.json"))
    assert fixtures, "expected at least one golden fixture"
    for fixture in fixtures:
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        assert payload["resourceType"] == "Bundle"
        assert payload["type"] == "transaction"