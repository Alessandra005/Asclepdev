FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
RUN pip install --no-cache-dir /pkgs/contracts
COPY services/api /srv
RUN pip install --no-cache-dir -e .
# Migrations are idempotent; running them on boot means `make up` alone gives a working database.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
