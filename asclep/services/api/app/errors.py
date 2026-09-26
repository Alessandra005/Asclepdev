"""Spec section 15 error format: {"error": {"code", "message", "request_id"}}."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

STATUS = {
    "UNAUTHENTICATED": 401,
    "FORBIDDEN_ROLE": 403,
    "FORBIDDEN_NOT_ON_CARE_TEAM": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "VALIDATION_ERROR": 422,
    "UPSTREAM_UNAVAILABLE": 502,
    "INTERNAL": 500,
}


class AsclepError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        self.status = STATUS[code]


def _body(request: Request, code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AsclepError)
    async def _asclep(request: Request, exc: AsclepError):
        return JSONResponse(_body(request, exc.code, exc.message), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        return JSONResponse(_body(request, "VALIDATION_ERROR", str(exc.errors())[:500]), status_code=422)
