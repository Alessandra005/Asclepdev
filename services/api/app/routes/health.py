import httpx
from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.db import engine

router = APIRouter(tags=["health"])


def _ping(url: str) -> str:
    try:
        return "up" if httpx.get(url, timeout=1.5).status_code < 500 else "down"
    except Exception:
        return "down"


@router.get("/health")
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db = "up"
    except Exception:
        db = "down"
    return {
        "db": db,
        "lab_tech": _ping(f"{settings.labtech_url}/health"),
        "resident": _ping(f"{settings.resident_url}/health"),
        "ehr_a": _ping(f"{settings.ehr_a_url}/metadata"),
        "ehr_b": _ping(f"{settings.ehr_b_url}/metadata"),
    }
