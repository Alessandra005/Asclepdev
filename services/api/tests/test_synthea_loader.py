import importlib.util
import json
from pathlib import Path

LOADER_PATH = Path(__file__).parents[3] / "services" / "mock-ehr" / "load_synthea.py"
LOADER_SPEC = importlib.util.spec_from_file_location("load_synthea", LOADER_PATH)
assert LOADER_SPEC is not None and LOADER_SPEC.loader is not None
LOADER_MODULE = importlib.util.module_from_spec(LOADER_SPEC)
LOADER_SPEC.loader.exec_module(LOADER_MODULE)


def test_transaction_bundle_uses_stable_put_urls() -> None:
    source = {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Patient", "id": "p1"}}]}
    transaction = LOADER_MODULE.transaction_bundle(source)
    assert transaction["type"] == "transaction"
    assert transaction["entry"][0]["request"] == {"method": "PUT", "url": "Patient/p1"}


def test_golden_fixtures_are_valid_json() -> None:
    golden_dir = Path(__file__).parents[3] / "data" / "seed" / "golden"
    for fixture in golden_dir.glob("*.json"):
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        assert payload["resourceType"] == "Bundle"
        assert payload["type"] == "transaction"