from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.seeds.demo import seed_personas


@pytest.fixture
def kb_countries() -> str:
    """Active KB countries for the app under test. Modules that exercise the inactive legacy
    `kb/AU` configuration override this fixture locally instead of reactivating it globally."""
    return "CN,ID"


@pytest.fixture
def app(tmp_path, monkeypatch, kb_countries):
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(config, "head")
    application = create_app(
        Settings(
            database_url=url,
            gemini_api_key="",
            frontend_origin="http://localhost:3000",
            frontend_url="http://127.0.0.1:3000",
            google_client_id="synthetic-client",
            google_client_secret="synthetic-secret",
            session_secret="synthetic-session-secret",
            active_kb_countries=kb_countries,
        )
    )
    with application.state.session_factory() as db:
        assert seed_personas(db) == 2
        assert seed_personas(db) == 0
    yield application
    get_settings.cache_clear()


@pytest.fixture
def client(app):
    with TestClient(app) as http:
        yield http


@pytest.fixture
def demo(client):
    def create(persona="raka"):
        response = client.post("/api/v1/demo/sessions", json={"persona_id": persona})
        assert response.status_code == 201, response.text
        data = response.json()
        return data, {"X-Demo-Session": data["session_token"]}

    return create


@pytest.fixture
def db_session(app):
    with app.state.session_factory() as db:
        yield db
