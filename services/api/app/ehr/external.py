"""Production EHR adapter seams kept outside the demo path."""

from datetime import date
from uuid import UUID


class EpicAdapter:
    """Placeholder for SMART on FHIR and Epic Toolbox integration."""

    def __init__(self, provider_id: UUID) -> None:
        self.provider_id = provider_id

    def search_patient(self, family: str, given: str | None, birth_date: date | None) -> list[dict]:
        """Production path: obtain a SMART token and call Epic's R4 Patient search."""
        raise NotImplementedError("Epic SMART on FHIR integration is outside the synthetic-data MVP")

    def fetch_everything(self, fhir_patient_id: str) -> dict:
        """Production path: call Epic Patient/$everything with the SMART access token."""
        raise NotImplementedError("Epic SMART on FHIR integration is outside the synthetic-data MVP")

    def write_diagnostic_report(self, report: dict) -> str:
        """Production path: use Epic's approved SMART write-back endpoint."""
        raise NotImplementedError("Epic write-back integration is outside the synthetic-data MVP")


class CernerAdapter:
    """Placeholder for SMART on FHIR and Oracle Health integration."""

    def __init__(self, provider_id: UUID) -> None:
        self.provider_id = provider_id

    def search_patient(self, family: str, given: str | None, birth_date: date | None) -> list[dict]:
        """Production path: obtain a SMART token and call Oracle Health Patient search."""
        raise NotImplementedError("Cerner SMART on FHIR integration is outside the synthetic-data MVP")

    def fetch_everything(self, fhir_patient_id: str) -> dict:
        """Production path: call Oracle Health Patient/$everything with SMART authorization."""
        raise NotImplementedError("Cerner SMART on FHIR integration is outside the synthetic-data MVP")

    def write_diagnostic_report(self, report: dict) -> str:
        """Production path: use Oracle Health's approved FHIR write-back endpoint."""
        raise NotImplementedError("Cerner write-back integration is outside the synthetic-data MVP")