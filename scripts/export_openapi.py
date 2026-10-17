"""Export without a running server, database connection, or provider credentials."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.main import app

(ROOT / "backend" / "openapi.json").write_text(
    json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"
)
