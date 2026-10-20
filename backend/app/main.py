import asyncio
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pydantic import TypeAdapter

from app.agent.worker import run_periodic_worker
from app.api.auth import public_router as public_auth_router
from app.api.v1.foundation import sandbox_alias_router
from app.api.v1.router import router
from app.core.config import Settings, get_settings
from app.core.database import make_engine, session_factory
from app.core.errors import ERROR_RESPONSES, install_error_handlers
from app.schemas.common import Health
from app.schemas.foundation import AskStreamEvent
from app.schemas.kb import CountryResources
from app.services.kb_loader import CountryKBLoader

VERSION = "0.1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.kb_loader.discover()  # Fail startup on malformed configuration.
        application.state.kb_loader.load_injection_patterns()
        stop_event = asyncio.Event()
        worker_task = None
        if settings.agent_worker_enabled:
            worker_task = asyncio.create_task(
                run_periodic_worker(
                    application.state.session_factory,
                    settings.agent_worker_interval_seconds,
                    stop_event,
                )
            )
        try:
            yield
        finally:
            if worker_task is not None:
                stop_event.set()
                worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await worker_task
            engine.dispose()

    app = FastAPI(
        title="AI Insurance Companion",
        version=VERSION,
        lifespan=lifespan,
        description=(
            "Phase 1.5 shared foundations. Demo sessions only; product workflows return 501."
        ),
    )
    app.state.settings = settings
    app.state.session_factory = session_factory(engine)
    app.state.kb_loader = CountryKBLoader(settings.kb_root, settings.active_kb_country_codes)
    cors_origins = [settings.frontend_origin, settings.frontend_url]
    if settings.environment == "development":
        for o in list(cors_origins):
            if "localhost" in o:
                cors_origins.append(o.replace("localhost", "127.0.0.1"))
            elif "127.0.0.1" in o:
                cors_origins.append(o.replace("127.0.0.1", "localhost"))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys([o for o in cors_origins if o])),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Demo-Session"],
        expose_headers=["X-Request-ID", "X-Total-Count"],
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
    app.include_router(public_auth_router)
    app.include_router(sandbox_alias_router)

    @app.get("/health", response_model=Health, responses=ERROR_RESPONSES, tags=["System"])
    def health():
        return Health(status="ok", version=VERSION)

    def openapi():
        if app.openapi_schema is None:
            schema = get_openapi(
                title=app.title, version=app.version, description=app.description, routes=app.routes
            )
            for name, model in {
                "AskStreamEvent": AskStreamEvent,
                "CountryResources": CountryResources,
            }.items():
                component = TypeAdapter(model).json_schema(
                    ref_template="#/components/schemas/{model}"
                )
                for child_name, definition in component.pop("$defs", {}).items():
                    schema["components"]["schemas"].setdefault(child_name, definition)
                schema["components"]["schemas"][name] = component
            app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = openapi
    return app


app = create_app()
