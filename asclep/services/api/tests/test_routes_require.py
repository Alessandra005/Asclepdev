"""Enforces spec section 13: every non-public route depends on require()."""
from fastapi.routing import APIRoute

from app.main import app

PUBLIC_PATHS = {"/api/v1/health", "/api/v1/auth/login"}


def _has_require(dependant) -> bool:
    for dep in dependant.dependencies:
        if getattr(dep.call, "_asclep_require", None) or _has_require(dep):
            return True
    return False


def test_every_route_uses_require():
    missing = [
        r.path for r in app.routes
        if isinstance(r, APIRoute) and r.path not in PUBLIC_PATHS and not _has_require(r.dependant)
    ]
    assert not missing, f"Routes without require(): {missing}"
