"""Lab Technician contract (spec section 9)."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SubtypeLabel = Literal["LUAD", "LUSC", "benign"]
LabFlag = Literal["uncertain", "low_tissue", "non_he_stain_suspected"]


class ClassifyRequest(BaseModel):
    slide_id: UUID
    file_path: str


class TopTile(BaseModel):
    path: str
    x: int
    y: int
    score: float


class ClassifyResult(BaseModel):
    model_name: str
    model_version: str
    label: SubtypeLabel
    confidence: float = Field(ge=0, le=1, description="Model score, NOT a calibrated probability")
    class_scores: dict[SubtypeLabel, float]
    heatmap_path: str | None = None
    thumbnail_path: str | None = None
    top_tiles: list[TopTile] = []
    tiles_analyzed: int
    runtime_ms: int
    flags: list[LabFlag] = []
