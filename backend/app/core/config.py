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
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-3.5-flash-lite"
    environment: str = "development"
    session_ttl_hours: int = 24
    kb_root: Path = ROOT / "kb"
    # Comma-separated ISO codes. Folders under kb_root for other codes stay on disk, inactive.
    # Also bounds the residence country allowed when an account profile is saved.
    active_kb_countries: str = "CN,ID"
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"
    frontend_url: str = "http://127.0.0.1:3000"
    backend_url: str = "http://localhost:8000"
    email_delivery_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from_email: str = "no-reply@insurra.com"
    smtp_from_name: str = "Insurra"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    session_secret: SecretStr = SecretStr("")
    account_session_ttl_days: int = 7
    sandbox_step_seconds: int = 10
    claim_poll_interval_seconds: int = 0
    claim_poll_limit: int = 60
    agent_worker_enabled: bool = False
    agent_worker_interval_seconds: int = 15
    freeze_legacy_actions: bool = False
    supabase_url: str = ""
    supabase_anon_key: SecretStr = SecretStr("")

    @property
    def is_supabase_auth_active(self) -> bool:
        return bool(self.supabase_url and self.supabase_url.strip())

    @property
    def is_email_delivery_active(self) -> bool:
        return bool(
            self.email_delivery_enabled
            or (self.smtp_host and self.smtp_host.strip())
            or self.is_supabase_auth_active
        )

    @property
    def active_kb_country_codes(self) -> frozenset[str]:
        return frozenset(
            c.strip().upper() for c in self.active_kb_countries.split(",") if c.strip()
        )

    @model_validator(mode="after")
    def restrict_origin(self):
        if self.frontend_origin == "*":
            raise ValueError("FRONTEND_ORIGIN must be an explicit trusted origin")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
