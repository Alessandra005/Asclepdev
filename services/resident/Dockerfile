FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
# faster-whisper transcribes the LiveScribing audio in-process (CPU, int8); httpx talks to the local VLM.
RUN pip install --no-cache-dir /pkgs/contracts fastapi "uvicorn[standard]" python-multipart httpx faster-whisper
COPY services/resident /srv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
