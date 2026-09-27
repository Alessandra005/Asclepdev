from uuid import uuid4

from app.routes import lab

PID, OBS, NOTE = uuid4(), uuid4(), uuid4()
ROWS = {
    OBS: {"id": OBS, "patient_id": PID, "display": "Tobacco smoking status", "value_num": None,
          "value_text": "Former smoker, 40 pack-years", "unit": None, "loinc_code": "72166-2", "source_system": "ehr-a"},
    NOTE: {"id": NOTE, "patient_id": PID, "kind": "imaging_report", "body": "CT: " + "x" * 700, "source_system": "ehr-b"},
}


def test_context_carries_the_rows_facts_source_and_conflicts(monkeypatch) -> None:
    monkeypatch.setattr(lab.ontology, "peek", lambda s, t, i: ROWS[i])
    smoking = lab.context_text(None, "Observation", OBS, conflicted={str(OBS)})
    assert smoking.startswith("Tobacco smoking status: Former smoker, 40 pack-years")  # not "None None"
    assert "Recorded by Riverside." in smoking and smoking.endswith("Source conflict: another provider's records lack this.")
    note = lab.context_text(None, "Note", NOTE, conflicted=set())
    assert note.startswith("Imaging report, recorded by Northside: CT: ") and note.endswith("...")
    assert len(note) < 700


def test_report_headings_reach_the_desktop(monkeypatch) -> None:
    monkeypatch.setattr(lab.ontology, "peek", lambda s, t, i: ROWS[i])
    body = f"## AI finding (unverified)\nLUAD.\n\n## Relevant patient context\n- Former smoker. [[obj:Observation:{OBS}]]"
    view = lab.report_view(None, {"id": uuid4(), "finding_id": uuid4(), "body_md": body, "locked_check_passed": True},
                           PID)
    assert [(x["kind"], x["text"]) for x in view["sentences"]] == [
        ("heading", "AI finding (unverified)"), ("sentence", "LUAD."),
        ("heading", "Relevant patient context"), ("sentence", "Former smoker.")]
    assert view["sentences"][3]["citation_ids"] == [f"Observation:{OBS}"]
