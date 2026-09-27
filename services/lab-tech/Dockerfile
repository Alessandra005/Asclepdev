FROM python:3.12-slim
WORKDIR /srv
COPY packages/contracts /pkgs/contracts
# numpy + Pillow draw the mock heatmap, thumbnail and top tiles (real files the gateway serves).
RUN pip install --no-cache-dir /pkgs/contracts fastapi "uvicorn[standard]" "numpy==2.5.3" "pillow==12.3.0"
COPY services/lab-tech /srv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
