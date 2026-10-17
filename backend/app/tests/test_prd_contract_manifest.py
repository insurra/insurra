"""The normalized PRD HTTP operations must remain visible in OpenAPI."""

import copy
import json
import runpy
from pathlib import Path

import pytest

from app.main import app

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "docs/prd/API_CONTRACT_MANIFEST.json"


def test_prd_http_contracts_are_unique_and_registered():
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))["http_contracts"]
    assert len(entries) == 21  # Source PRD - Kontrak API.csv: 18 HTTP rows, 3 tool rows.
    seen = {(entry["method"], entry["path"]) for entry in entries}
    assert len(entries) == len(seen)
    schema = app.openapi()
    for entry in entries:
        operation = schema["paths"][entry["path"]][entry["method"].lower()]
        assert any(status.startswith("2") for status in operation["responses"])
        if "multipart" in entry["request"].lower():
            assert "multipart/form-data" in operation["requestBody"]["content"]
        if "?task=" in entry["prd_path"] or "?type=" in entry["prd_path"]:
            parameter = "task" if "?task=" in entry["prd_path"] else "type"
            assert any(
                item["name"] == parameter and item["in"] == "query"
                for item in operation.get("parameters", [])
            )


@pytest.mark.parametrize("defect", ["route", "multipart", "query", "success", "boundary"])
def test_prd_verifier_detects_transport_regressions(defect):
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))["http_contracts"]
    schema = copy.deepcopy(app.openapi())
    if defect == "route":
        del schema["paths"]["/api/v1/documents"]["post"]
    elif defect == "multipart":
        schema["paths"]["/api/v1/documents"]["post"]["requestBody"]["content"] = {}
    elif defect == "query":
        schema["paths"]["/api/v1/completeness"]["get"]["parameters"] = []
    elif defect == "success":
        schema["paths"]["/api/v1/home/summary"]["get"]["responses"]["200"] = {
            "description": "No payload"
        }
    else:
        del schema["paths"]["/api/v1/home/summary"]["get"]["responses"]["501"]
    audit = runpy.run_path(str(ROOT / "scripts/verify_prd_contracts.py"))["audit_openapi"]
    assert audit(entries, schema)
