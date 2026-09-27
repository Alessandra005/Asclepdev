"""Stage 7 of ingestion (spec 7A.5): chunk and embed searchable text into `chunk` for /search. Owner: Alessandra.

sentence-transformers is the optional `embed` extra (the api image installs it; CI does not). Without it nothing is
embedded and search returns nothing, never an error.
"""
from functools import lru_cache
from pathlib import Path
from uuid import UUID

import yaml
from sqlalchemy import text
from sqlalchemy.orm import Session

MODEL = "BAAI/bge-small-en-v1.5"  # 384-dim, matches chunk.embedding vector(384)
_SEARCHABLE = {t: e["searchable_text"] for t, e in
               yaml.safe_load((Path(__file__).parent / "registry.yaml").read_text())["object_types"].items()
               if e.get("searchable_text")}


@lru_cache(maxsize=1)
def _model():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None
    return SentenceTransformer(MODEL, device="cpu")


def embed(texts: list[str]) -> list[list[float]] | None:
    """Unit-length vectors, so cosine distance is what pgvector's <=> ranks by. None when the extra is absent."""
    model = _model()
    return None if model is None else model.encode(texts, normalize_embeddings=True).tolist()


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"  # pgvector text input; no pgvector Python package needed


def chunks(body: str, size: int = 800, overlap: int = 100) -> list[str]:
    return [body[i:i + size] for i in range(0, max(len(body) - overlap, 1), size - overlap)]


def index_object(s: Session, object_type: str, row: dict) -> int:
    """Replace one object's chunks. Returns how many were written (0 when not searchable or no embedder)."""
    fields = _SEARCHABLE.get(object_type)
    if not fields:
        return 0
    s.execute(text("DELETE FROM chunk WHERE object_type = :t AND object_id = :id"), {"t": object_type, "id": row["id"]})
    if object_type == "Observation" and not row.get("value_text"):
        return 0  # spec 8 rule 3: only observations with text; numbers are served by facts, not search
    if object_type == "Note" and row.get("kind") == "visual_scribe":
        return 0  # ponytail: Scribe drafts stay out of Ask (spec 10.5); index on accept once that route exists
    if row.get("record_status", "current") != "current":
        return 0
    body = " ".join(str(row[f]) for f in fields if row.get(f)).strip()
    pieces = chunks(body) if body else []
    vectors = embed(pieces) if pieces else None
    if not vectors:
        return 0
    for piece, vec in zip(pieces, vectors):
        s.execute(text("""INSERT INTO chunk (id, patient_id, object_type, object_id, text, embedding, sensitivity)
                          VALUES (gen_random_uuid(), :p, :t, :o, :x, CAST(:v AS vector), :sens)"""),
                  {"p": row.get("patient_id"), "t": object_type, "o": row["id"], "x": piece, "v": vector_literal(vec),
                   "sens": row.get("sensitivity") or "normal"})
    return len(pieces)


def search(s: Session, user_id: UUID, query: str, patient_id: UUID | None, k: int = 8) -> list[dict]:
    """Nearest chunks among patients the user may see: the one asked about (already access-checked by the route),
    else their care-team patients plus active break-the-glass grants."""
    vectors = embed([query])
    if not vectors:
        return []
    scope = "c.patient_id = :pid" if patient_id else """c.patient_id IN (
        SELECT patient_id FROM care_team_member WHERE user_id = :uid
        UNION SELECT patient_id FROM emergency_access WHERE user_id = :uid AND expires_at > now())"""
    return [dict(r) for r in s.execute(text(f"""
        SELECT c.object_type, c.object_id, c.patient_id, c.text, c.sensitivity,
               1 - (c.embedding <=> CAST(:v AS vector)) AS score
        FROM chunk c WHERE {scope} ORDER BY c.embedding <=> CAST(:v AS vector) LIMIT :k"""),
        {"v": vector_literal(vectors[0]), "pid": patient_id, "uid": user_id, "k": k}).mappings().all()]
