"""Verify both committed artifacts without changing either; no server or credentials needed."""

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.main import app

snapshot = ROOT / "backend/openapi.json"
if json.loads(snapshot.read_text()) != app.openapi():
    raise SystemExit("OpenAPI drift: run make generate-types")
with TemporaryDirectory() as folder:
    output = Path(folder) / "types.ts"
    subprocess.run(
        [
            str(ROOT / "frontend/node_modules/.bin/openapi-typescript"),
            str(snapshot),
            "--output",
            str(output),
        ],
        cwd=ROOT / "frontend",
        check=True,
    )
    if output.read_bytes() != (ROOT / "frontend/src/lib/api/types.gen.ts").read_bytes():
        raise SystemExit("TypeScript contract drift: run make generate-types")
print("Python OpenAPI snapshot and generated TypeScript contracts match.")
