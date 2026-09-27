FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
# faster-whisper transcribes the LiveScribing audio in-process (CPU, int8); httpx talks to the local VLM;
# Mellea (pinned, per AGENT_CONTEXT) runs the agent that confirms possible symptoms; anthropic runs report + Ask.
RUN pip install --no-cache-dir /pkgs/contracts fastapi "uvicorn[standard]" python-multipart httpx faster-whisper \
    "mellea==0.8.0" "anthropic==1.8.0"
COPY services/resident /srv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
