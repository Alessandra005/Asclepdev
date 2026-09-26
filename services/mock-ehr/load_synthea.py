"""Generate deterministic Synthea FHIR bundles and load them into HAPI."""

import argparse
from pathlib import Path
import json
import shutil
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PATIENTS_PER_PROVIDER = 150
SEED = 42


def run_synthea(synthea_jar: Path, output_dir: Path, patients: int = PATIENTS_PER_PROVIDER) -> None:
    """Generate FHIR R4 bundles with Synthea's default modules."""
    output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["java", "-jar", str(synthea_jar), "-s", str(SEED), "-p", str(patients),
        "--exporter.fhir.export=true",
        f"--exporter.baseDirectory={output_dir}"],
        check=True,
    )


def transaction_bundle(bundle: dict) -> dict:
    """Convert a Synthea bundle to deterministic PUT transactions for idempotency."""
    entries = []
    for entry in bundle.get("entry", []):
        resource = entry.get("resource")
        if not resource or not resource.get("resourceType") or not resource.get("id"):
            continue
        resource_type = resource["resourceType"]
        entries.append({
            "fullUrl": f"urn:uuid:{resource['id']}",
            "resource": resource,
            "request": {"method": "PUT", "url": f"{resource_type}/{resource['id']}"},
        })
    return {"resourceType": "Bundle", "type": "transaction", "entry": entries}


def post_bundle(bundle: dict, fhir_base_url: str, timeout: float = 120.0) -> None:
    """POST one transaction bundle to HAPI's transaction endpoint."""
    request = Request(f"{fhir_base_url.rstrip('/')}/", data=json.dumps(transaction_bundle(bundle)).encode("utf-8"), method="POST", headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"})
    with urlopen(request, timeout=timeout):
        pass


def load_directory(bundle_dir: Path, fhir_base_url: str) -> int:
    """Load hospital/practitioner info bundles first so conditional
    references resolve, then all patient bundles in lexical order."""
    all_files = sorted(bundle_dir.glob("*.json"))
    priority = [f for f in all_files if "hospitalInformation" in f.name or "practitionerInformation" in f.name]
    rest = [f for f in all_files if f not in priority]
    count = 0
    for bundle_path in priority + rest:
        with bundle_path.open(encoding="utf-8") as bundle_file:
            try:
                post_bundle(json.load(bundle_file), fhir_base_url)
            except HTTPError as exc:
                print(f"FAILED: {bundle_path.name}: {exc.code} {exc.read().decode(errors='replace')}")
                raise
        count += 1
    return count


def seed_provider(name: str, fhir_base_url: str, synthea_jar: Path, output_root: Path, patients: int = PATIENTS_PER_PROVIDER) -> int:
    """Generate and load one provider's background bundles."""
    provider_dir = output_root / name
    if provider_dir.exists():
        shutil.rmtree(provider_dir)
    run_synthea(synthea_jar, provider_dir, patients)
    return load_directory(provider_dir / "fhir", fhir_base_url)


def parse_args() -> argparse.Namespace:
    """Parse command-line options for the two mock providers."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthea-jar", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, default=Path("data/generated"))
    parser.add_argument("--ehr-a-url", default="http://localhost:8080/fhir")
    parser.add_argument("--ehr-b-url", default="http://localhost:8081/fhir")
    parser.add_argument("--skip-generation", action="store_true")
    return parser.parse_args()


def main() -> None:
    """Generate and load both synthetic EHR populations."""
    args = parse_args()
    if args.skip_generation:
        counts = [load_directory(args.output_root / "ehr-a" / "fhir", args.ehr_a_url), load_directory(args.output_root / "ehr-b" / "fhir", args.ehr_b_url)]
    else:
        counts = [seed_provider("ehr-a", args.ehr_a_url, args.synthea_jar, args.output_root), seed_provider("ehr-b", args.ehr_b_url, args.synthea_jar, args.output_root)]
    print(f"Loaded ehr-a={counts[0]} bundles, ehr-b={counts[1]} bundles; seed={SEED}")


if __name__ == "__main__":
    main()