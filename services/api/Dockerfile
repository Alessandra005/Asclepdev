FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
RUN pip install --no-cache-dir /pkgs/contracts
# Local text embeddings for /search (spec 6: sentence-transformers + bge-small, pgvector). CPU-only torch, in its
# own layer so rebuilds reuse it. Build with EMBED=0 for a light image (/search then returns no chunks).
ARG EMBED=1
RUN if [ "$EMBED" = "1" ]; then pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu; fi
COPY services/api /srv
RUN if [ "$EMBED" = "1" ]; then pip install --no-cache-dir -e ".[embed]"; else pip install --no-cache-dir -e .; fi
# Migrations are idempotent; running them on boot means `make up` alone gives a working database.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
