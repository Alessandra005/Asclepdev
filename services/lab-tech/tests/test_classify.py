"""Lab Technician mock (spec 9, 18.5): the pipeline on a tiny fixture returns the contract and real image files."""
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app import main


def test_classify_returns_contract_label_and_real_files(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    (tmp_path / "seed").mkdir()
    (tmp_path / "seed" / "slides.csv").write_text("specimen_accession,file_name,expected_label\nS-1,ps.png,LUSC\n")
    (tmp_path / "slides").mkdir()
    Image.new("RGB", (600, 400), (220, 150, 190)).save(tmp_path / "slides" / "ps.png")  # tiny fixture slide
    client = TestClient(main.app)

    slide = str(uuid4())
    r = client.post("/classify", json={"slide_id": slide, "file_path": "slides/ps.png"})
    body = main.ClassifyResult.model_validate(r.json())
    assert body.label == "LUSC" and 0.78 <= body.confidence <= 0.92 and "uncertain" not in body.flags
    assert abs(sum(body.class_scores.values()) - 1) < 0.02
    paths = [body.heatmap_path, body.thumbnail_path] + [t.path for t in body.top_tiles]
    assert len(body.top_tiles) == 6 and all((tmp_path / p).is_file() for p in paths)
    assert paths[0].startswith("heatmaps/") and paths[1].startswith("thumbs/")  # the gateway serves only these
    assert client.post("/classify", json={"slide_id": slide, "file_path": "slides/ps.png"}).json()["class_scores"] \
        == r.json()["class_scores"]  # same slide, same result


def test_unknown_unreadable_slide_is_flagged_uncertain(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    r = main.mock_classify(main.ClassifyRequest(slide_id=uuid4(), file_path="slides/missing.svs"))
    assert r.confidence < 0.60 and "uncertain" in r.flags and (tmp_path / r.heatmap_path).is_file()
