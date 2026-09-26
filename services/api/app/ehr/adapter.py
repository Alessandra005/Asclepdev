"""Common adapter contract for FHIR-backed EHR systems."""

from datetime import date
from typing import Protocol
from uuid import UUID


class EHRAdapter(Protocol):
    """Read and write the subset of FHIR needed by Asclep."""

    provider_id: UUID

    def search_patient(self, family: str, given: str | None, birth_date: date | None) -> list[dict]:
        """Find FHIR Patient resources matching supplied demographics."""
        ...

    def fetch_everything(self, fhir_patient_id: str) -> dict:
        """Fetch a FHIR Bundle from Patient/$everything."""
        ...

    def write_diagnostic_report(self, report: dict) -> str:
        """Write a DiagnosticReport and return its FHIR resource id."""
        ...