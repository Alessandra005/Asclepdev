"""Lab Technician (spec section 9). Owner: Brandon.

Starts in MOCK mode so everyone can build against the contract immediately.
Replace mock_classify() with the real CONCH pipeline; keep the response model identical.
"""
import os

from fastapi import FastAPI

from asclep_contracts import ClassifyRequest, ClassifyResult, TopTile

app = FastAPI(title="Asclep Lab Technician")
MOCK = os.getenv("LABTECH_MOCK", "1") == "1"
BACKBONE = os.getenv("LABTECH_BACKBONE", "conch")


@app.get("/health")
def health():
    return {"status": "ok", "backbone": BACKBONE, "weights_loaded": not MOCK, "mock": MOCK}


def mock_classify(req: ClassifyRequest) -> ClassifyResult:
    return ClassifyResult(
        model_name="CONCH", model_version="mock",
        label="LUAD", confidence=0.87,
        class_scores={"LUAD": 0.87, "LUSC": 0.10, "benign": 0.03},
        heatmap_path=f"heatmaps/{req.slide_id}.png", thumbnail_path=f"thumbs/{req.slide_id}.png",
        top_tiles=[TopTile(path=f"tiles/{req.slide_id}_0.jpg", x=10240, y=8192, score=0.91)],
        tiles_analyzed=2000, runtime_ms=40, flags=[],
    )


@app.post("/classify", response_model=ClassifyResult)
def classify(req: ClassifyRequest) -> ClassifyResult:
    if MOCK:
        return mock_classify(req)
    raise NotImplementedError("Brandon: CONCH pipeline, spec 9 steps 1 to 8")
