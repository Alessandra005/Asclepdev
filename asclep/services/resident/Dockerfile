FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
RUN pip install --no-cache-dir /pkgs/contracts fastapi "uvicorn[standard]" python-multipart
COPY services/resident /srv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
