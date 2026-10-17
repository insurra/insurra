from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    database_url: str = "sqlite:///./dev.db"
    frontend_origin: str = "http://localhost:3000"
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = "gpt-6.1-sol"
    openai_fast_model: str = "gpt-6-luna"
    environment: str = "development"
    session_ttl_hours: int = 24
    kb_root: Path = ROOT / "kb"
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"
    frontend_url: str = "http://127.0.0.1:3000"
    backend_url: str = "http://localhost:8000"
    session_secret: SecretStr = SecretStr("")
    account_session_ttl_days: int = 7

    @model_validator(mode="after")
    def restrict_origin(self):
        if self.frontend_origin == "*":
            raise ValueError("FRONTEND_ORIGIN must be an explicit trusted origin")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
