"""Lab Technician (spec section 9). Owner: Brandon.

MOCK mode (LABTECH_MOCK=1) returns the label listed for the slide in data/seed/slides.csv and writes real
images the gateway serves: heatmaps/<slide>.png, thumbs/<slide>.png, tiles/<slide>_<n>.jpg under the data dir.
Scores and the heatmap are seeded by the slide id, so a slide always gets the same result.
Replace mock_classify() with the real CONCH pipeline; keep the response model identical.
"""
import csv
import hashlib
import os
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from PIL import Image, ImageDraw, ImageFilter

from asclep_contracts import ClassifyRequest, ClassifyResult, TopTile

app = FastAPI(title="Asclep Lab Technician")
MOCK = os.getenv("LABTECH_MOCK", "1") == "1"
BACKBONE = os.getenv("LABTECH_BACKBONE", "conch")
DATA_DIR = Path(os.getenv("LABTECH_DATA_DIR", "/srv/data"))
LABELS = ("LUAD", "LUSC", "benign")
THUMB_W, CELL, DOWNSAMPLE, TOP_K = 512, 16, 32, 6  # spec 9: ~32x thumbnail, 6 top tiles
# inferno colormap anchors (spec 9 step 7), interpolated linearly
INFERNO = np.array([[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]], dtype=float)


@app.get("/health")
def health():
    return {"status": "ok", "backbone": BACKBONE, "weights_loaded": not MOCK, "mock": MOCK}


def expected_label(file_path: str) -> str | None:
    """The label the demo slide is known to carry (data/seed/slides.csv: specimen_accession,file_name,expected_label)."""
    try:
        with (DATA_DIR / "seed" / "slides.csv").open() as f:
            rows = {r["file_name"]: r["expected_label"] for r in csv.DictReader(f)}
    except (OSError, KeyError):
        return None
    label = rows.get(Path(file_path).name)
    return label if label in LABELS else None


def thumbnail(file_path: str, rng: np.random.Generator) -> Image.Image:
    """The slide itself when Pillow can read it; otherwise a synthetic H&E-like field (no OpenSlide in the mock)."""
    try:
        img = Image.open(DATA_DIR / file_path).convert("RGB")
        img.thumbnail((THUMB_W, THUMB_W))
        return img
    except OSError:
        pass
    w, h = THUMB_W, 384
    img = Image.new("RGB", (w, h), (244, 240, 242))
    draw = ImageDraw.Draw(img)
    for _ in range(40):  # overlapping pink stroma blobs, purple nuclei speckle on top
        x, y, r = rng.uniform(80, w - 80), rng.uniform(60, h - 60), rng.uniform(20, 70)
        pink = tuple(int(c) for c in rng.uniform([214, 140, 180], [236, 170, 205]))
        draw.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=pink)
    px = np.asarray(img.filter(ImageFilter.GaussianBlur(3))).astype(float)
    tissue = px.mean(axis=2) < 230
    nuclei = tissue & (rng.random((h, w)) < 0.06)
    px[nuclei] = [92, 52, 128]
    return Image.fromarray(px.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))


def heat_grid(img: Image.Image, rng: np.random.Generator) -> np.ndarray:
    """Per-tile score in [0, 1] on a CELL-px grid: a few smooth hot spots, zero off tissue."""
    gh, gw = img.height // CELL, img.width // CELL
    yy, xx = np.mgrid[0:gh, 0:gw]
    heat = np.zeros((gh, gw))
    for _ in range(3):
        cy, cx, s = rng.uniform(0, gh), rng.uniform(0, gw), rng.uniform(2, 5)
        heat += rng.uniform(0.5, 1.0) * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s * s))
    tissue = np.asarray(img.convert("L").resize((gw, gh))) < 225
    heat *= tissue
    return heat / heat.max() if heat.max() > 0 else heat


def colorize(heat: np.ndarray, size: tuple[int, int]) -> Image.Image:
    """inferno, alpha 0.45 where there is signal (spec 9 step 7), smoothed to the thumbnail size."""
    idx = heat * (len(INFERNO) - 1)
    lo = np.floor(idx).astype(int).clip(0, len(INFERNO) - 2)
    rgb = INFERNO[lo] + (INFERNO[lo + 1] - INFERNO[lo]) * (idx - lo)[..., None]
    alpha = np.where(heat > 0.05, 0.45 * 255, 0)[..., None]
    rgba = Image.fromarray(np.concatenate([rgb, alpha], axis=2).astype(np.uint8), "RGBA")
    return rgba.resize(size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(4))


def scores_for(label: str | None, rng: np.random.Generator) -> dict[str, float]:
    """Known slides score 0.78-0.92 for their label; an unknown slide gets an uncertain 0.55 LUAD."""
    top, conf = (label, round(rng.uniform(0.78, 0.92), 2)) if label else ("LUAD", 0.55)
    rest = [lab for lab in LABELS if lab != top]
    second = round((1 - conf) * 0.7, 2)
    return {top: conf, rest[0]: second, rest[1]: round(1 - conf - second, 2)}


def mock_classify(req: ClassifyRequest) -> ClassifyResult:
    start = time.monotonic()
    rng = np.random.default_rng(int(hashlib.sha256(str(req.slide_id).encode()).hexdigest()[:8], 16))
    scores = scores_for(expected_label(req.file_path), rng)
    label = max(scores, key=scores.get)
    img = thumbnail(req.file_path, rng)
    heat = heat_grid(img, rng)
    sid = req.slide_id
    paths = {"thumb": f"thumbs/{sid}.png", "heat": f"heatmaps/{sid}.png"}
    for sub in ("thumbs", "heatmaps", "tiles"):
        (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)
    img.save(DATA_DIR / paths["thumb"])
    colorize(heat, img.size).save(DATA_DIR / paths["heat"])
    tiles = []
    for n, flat in enumerate(np.argsort(heat, axis=None)[::-1][:TOP_K]):
        gy, gx = divmod(int(flat), heat.shape[1])
        path = f"tiles/{sid}_{n}.jpg"
        img.crop((gx * CELL, gy * CELL, gx * CELL + CELL, gy * CELL + CELL)).resize((256, 256)).save(DATA_DIR / path)
        tiles.append(TopTile(path=path, x=gx * CELL * DOWNSAMPLE, y=gy * CELL * DOWNSAMPLE, score=round(float(heat[gy, gx]), 2)))
    tissue_tiles = int((heat > 0).sum())
    flags = (["uncertain"] if scores[label] < 0.60 else []) + (["low_tissue"] if tissue_tiles < 100 else [])
    return ClassifyResult(
        model_name="CONCH", model_version="mock", label=label, confidence=scores[label], class_scores=scores,
        heatmap_path=paths["heat"], thumbnail_path=paths["thumb"], top_tiles=tiles, tiles_analyzed=tissue_tiles,
        runtime_ms=int((time.monotonic() - start) * 1000), flags=flags,
    )


@app.post("/classify", response_model=ClassifyResult)
def classify(req: ClassifyRequest) -> ClassifyResult:
    if MOCK:
        return mock_classify(req)
    raise NotImplementedError("Brandon: CONCH pipeline, spec 9 steps 1 to 8")
