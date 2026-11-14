"""FastAPI application factory for the local Klyraudio service."""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_VERSION, ServiceContext
from .errors import ApiError
from .logging_setup import configure_logging
from .routes import build_router
from .security import LocalOnlyMiddleware
from .services import build_services

logger = logging.getLogger("klyraudio.api")


def _web_directory() -> Path | None:
    override = os.environ.get("KLYRAUDIO_WEB_DIR")
    candidates = []
    if override:
        candidates.append(Path(override))
    candidates.append(Path(__file__).resolve().parents[3] / "apps" / "web" / "dist")
    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate
    return None


def create_app(
    data_dir: Path | None = None,
    *,
    workers: bool = True,
) -> FastAPI:
    context = ServiceContext(data_dir)
    context.started_at = time.time()
    configure_logging(
        context.paths.logs,
        os.environ.get("KLYRAUDIO_LOG_LEVEL", "INFO"),
    )
    services = build_services(context)
    web_dir = _web_directory()
    docs_enabled = os.environ.get("KLYRAUDIO_DISABLE_DOCS", "0").lower() not in {"1", "true", "yes"}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if workers:
            services.jobs.start()
        logger.info(
            "Klyraudio local service ready",
            extra={"event": "service_started"},
        )
        try:
            yield
        finally:
            if workers:
                services.jobs.shutdown()
            logger.info("Klyraudio local service stopped", extra={"event": "service_stopped"})

    app = FastAPI(
        title="Klyraudio Local API",
        version=APP_VERSION,
        description=(
            "Local-only API for Klyraudio. Audio, prompts, projects, and models stay on this "
            "computer. This interface is intended for the local Klyraudio UI."
        ),
        lifespan=lifespan,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )
    app.state.services = services

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "Unhandled request error",
                extra={"request_id": request_id, "event": "request_failed"},
            )
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "internal_error",
                        "message": "The local service encountered an unexpected error.",
                        "details": {},
                        "request_id": request_id,
                    }
                },
            )
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "duration_ms": int((time.perf_counter() - started) * 1000),
                "event": f"{request.method} {request.url.path} {response.status_code}",
            },
        )
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Range", "X-Request-Id"],
        expose_headers=["Content-Range", "Content-Length", "Accept-Ranges", "X-Request-Id"],
        max_age=600,
    )
    app.add_middleware(LocalOnlyMiddleware)

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "")
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload(request_id))

    @app.exception_handler(RequestValidationError)
    async def validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "")
        details = [
            {
                "location": list(error.get("loc", [])),
                "message": error.get("msg", "Invalid value"),
                "type": error.get("type", "validation_error"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_failed",
                    "message": "The request contained invalid values.",
                    "details": {"errors": details},
                    "request_id": request_id,
                }
            },
        )

    app.include_router(build_router(services))
    if web_dir:
        app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")

    return app


def create_default_app() -> FastAPI:
    return create_app()
