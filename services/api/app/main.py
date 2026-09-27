import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.errors import install_error_handlers
from app.routes.admin import router as admin_router
from app.routes.alerts import router as alerts_router
from app.routes.clinical import router as clinical_router
from app.routes.dashboard import router as dashboard_router
from app.routes.health import router as health_router
from app.routes.lab import router as lab_router
from app.routes.live_scribe import router as live_scribe_router
from app.routes.patients import router as patients_router
from app.routes.transcripts import router as transcripts_router

app = FastAPI(title="Asclep Gateway", version="0.1.0")
install_error_handlers(app)
# Desktop renderer: Vite dev server in development, Origin "null" when packaged (apps/desktop/docs/BACKEND_HANDOFF.md).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "null"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-Id"],
)


@app.middleware("http")
async def request_id(request: Request, call_next):
    request.state.request_id = f"req_{uuid.uuid4().hex[:10]}"
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


API = "/api/v1"
app.include_router(health_router, prefix=API)
app.include_router(auth_router, prefix=API)
app.include_router(patients_router, prefix=API)
app.include_router(live_scribe_router, prefix=API)
# New routers: add here, and make sure every route uses require() (see tests/test_routes_require.py)
app.include_router(alerts_router, prefix=API)
app.include_router(transcripts_router, prefix=API)
app.include_router(clinical_router, prefix=API)
app.include_router(dashboard_router, prefix=API)
app.include_router(lab_router, prefix=API)
app.include_router(admin_router, prefix=API)
