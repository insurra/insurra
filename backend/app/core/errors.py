from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app.schemas.common import ApiError


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        self.status_code, self.code, self.message, self.details = (
            status_code,
            code,
            message,
            details,
        )


def error_response(request: Request, status: int, code: str, message: str, details=None):
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        status_code=status,
        content=ApiError(
            code=code, message=message, details=details, request_id=request_id
        ).model_dump(mode="json"),
        headers={"X-Request-ID": request_id},
    )


def install_error_handlers(app: FastAPI):
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        return error_response(request, exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo input values: uploads, questions, headers may contain private content.
        details = {
            "errors": [{"location": list(e["loc"]), "type": e["type"]} for e in exc.errors()]
        }
        return error_response(
            request, 422, "VALIDATION_ERROR", "Data permintaan tidak valid.", details
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error_response(
            request, exc.status_code, "HTTP_ERROR", "Permintaan tidak dapat diproses."
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        return error_response(
            request,
            503,
            "DATABASE_UNAVAILABLE",
            "Database sementara tidak dapat dihubungi. Silakan coba kembali.",
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        return error_response(request, 500, "INTERNAL_ERROR", "Terjadi kesalahan internal.")


ERROR_RESPONSES = {code: {"model": ApiError} for code in [401, 403, 404, 409, 422, 500, 501, 503]}


def not_implemented():
    raise AppError(501, "NOT_IMPLEMENTED", "Fitur tersedia pada fase berikutnya.")
