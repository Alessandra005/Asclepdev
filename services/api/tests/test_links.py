from uuid import uuid4

from app.ontology import links


class Scripted:
    """Answers each query in order: the patient's sources, the provider names, allergies, active meds."""

    def __init__(self, *answers):
        self.answers, self.links = list(answers), []

    def execute(self, stmt, params=None):
        if "INSERT INTO ontology_link" in str(stmt):
            self.links.append(params)
            return type("R", (), {"first": lambda self: (1,)})()
        rows = self.answers.pop(0)
        return type("R", (), {"scalars": lambda self: iter(rows), "mappings": lambda self: iter(rows)})()


def test_only_ehr_providers_count_as_a_missing_source() -> None:
    allergy = {"id": uuid4(), "key": "penicillin", "name": "Penicillin", "source_system": "ehr-a"}
    s = Scripted(["ehr-a", "ehr-b", "note-drop", "asclep"], ["ehr-a", "ehr-b"], [allergy], [])
    found = links.cross_source_conflict(s, uuid4())
    assert [(c["name"], c["missing_from"]) for c in found] == [("Penicillin", ["ehr-b"])]
