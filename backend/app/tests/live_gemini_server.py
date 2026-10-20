"""Isolated, opt-in ASGI server for real-Gemini Playwright verification."""

import os

from app.core.config import Settings
from app.main import create_app
from app.tests.live_gemini_e2e_support import install_test_triage

database_url = os.environ.get("DATABASE_URL", "")
if os.environ.get("INSURRA_LIVE_GEMINI") != "1":
    raise RuntimeError("The live Gemini e2e server requires explicit INSURRA_LIVE_GEMINI=1 opt-in")
if not database_url.startswith("sqlite:///") or ".cache/e2e-live-gemini-" not in database_url:
    raise RuntimeError("The live Gemini e2e server requires its isolated SQLite test database")

app = create_app(Settings())
if not app.state.settings.gemini_api_key.get_secret_value():
    raise RuntimeError("Configure GEMINI_API_KEY in the local environment before live e2e")
install_test_triage(app)
