"""HAPI FHIR R4 adapter used by both synthetic mock EHR providers."""

import json
from datetime import date
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID


class HapiAdapter:
    """Small stdlib-only client for the HAPI FHIR REST API."""

    def __init__(self, provider_id: UUID, base_url: str, timeout: float = 30.0) -> None:
        self.provider_id = provider_id
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def search_patient(self, family: str, given: str | None, birth_date: date | None) -> list[dict]:
        """Search Patient resources using HAPI's standard query parameters."""
        params: dict[str, str] = {"family": family}
        if given is not None:
            params["given"] = given
        if birth_date is not None:
            params["birthdate"] = birth_date.isoformat()
        payload = self._request("GET", f"/Patient?{urlencode(params)}")
        return [entry["resource"] for entry in payload.get("entry", []) if "resource" in entry]

    def fetch_everything(self, fhir_patient_id: str) -> dict:
        """Fetch all resources linked to one FHIR Patient."""
        return self._request("GET", f"/Patient/{fhir_patient_id}/$everything")

    def write_diagnostic_report(self, report: dict) -> str:
        """Submit a DiagnosticReport through HAPI's transaction endpoint."""
        resource = report.get("resource", report)
        if resource.get("resourceType") == "Bundle" and resource.get("type") == "transaction":
            transaction = resource
        else:
            resource_type = resource.get("resourceType", "DiagnosticReport")
            resource_id = resource.get("id")
            url = f"{resource_type}/{resource_id}" if resource_id else resource_type
            transaction = {
                "resourceType": "Bundle",
                "type": "transaction",
                "entry": [{"resource": resource, "request": {"method": "PUT" if resource_id else "POST", "url": url}}],
            }
        response = self._request("POST", "/", transaction)
        for entry in response.get("entry", []):
            location = entry.get("response", {}).get("location", "")
            if "/DiagnosticReport/" in location:
                return location.split("/DiagnosticReport/", 1)[1].split("/", 1)[0]
            resource_id = entry.get("resource", {}).get("id")
            if resource_id:
                return resource_id
        raise ValueError("HAPI transaction response did not contain a DiagnosticReport id")

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        """Send one JSON request and decode the FHIR JSON response."""
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HAPI request failed with HTTP {error.code}: {detail}") from error