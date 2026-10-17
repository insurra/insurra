from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router
from app.core.config import Settings, get_settings
from app.core.database import make_engine, session_factory
from app.core.errors import ERROR_RESPONSES, install_error_handlers
from app.schemas.common import Health
from app.services.kb_loader import CountryKBLoader

VERSION = "0.1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.kb_loader.discover()  # Fail startup on malformed configuration.
        yield
        engine.dispose()

    app = FastAPI(
        title="AI Insurance Companion",
        version=VERSION,
        lifespan=lifespan,
        description="Phase 1. Synthetic demo authentication; no AI or real submissions.",
    )
    app.state.settings = settings
    app.state.session_factory = session_factory(engine)
    app.state.kb_loader = CountryKBLoader(settings.kb_root)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "X-Demo-Session"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    install_error_handlers(app)
    app.include_router(router)

    @app.get("/health", response_model=Health, responses=ERROR_RESPONSES, tags=["System"])
    def health():
        return Health(status="ok", version=VERSION)

    return app


app = create_app()
