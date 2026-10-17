"""Verify the committed PRD HTTP mapping against FastAPI's OpenAPI schema.

Source CSVs are local-only. The normalized, tracked manifest enables CI checks
without publishing the PRD. This checks endpoint/transport presence, not the
semantic equivalence of every nested payload field.
"""

import argparse
import csv
import json
import sys
from difflib import unified_diff
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/prd/API_CONTRACT_MANIFEST.json"

# The PRD uses the same :id for multiple resources.
RESOURCE_IDS = {
    "documents": "document_id",
    "fields": "field_id",
    "claims": "claim_case_id",
    "actions": "action_id",
}
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def canonical_path(path: str) -> str:
    path = path.split("?", 1)[0].strip().rstrip("/")
    if not path.startswith("/api/"):
        raise ValueError(f"Unknown PRD API path: {path}")
    parts = path.split("/")
    for index, segment in enumerate(parts):
        if segment == ":id":
            resource = parts[index - 1]
            if resource not in RESOURCE_IDS:
                raise ValueError(f"Unknown :id resource: {path}")
            parts[index] = "{" + RESOURCE_IDS[resource] + "}"
    return "/api/v1/" + "/".join(parts[2:])


def expand_endpoints(method: str, expression: str) -> list[str]:
    """Expand middle-dot groups and the PRD's '/reject' shorthand."""
    paths = [part.strip() for part in expression.split("·")]
    expanded = []
    for path in paths:
        if path.startswith("/api/"):
            expanded.append(path)
        elif path == "/reject" and expanded and expanded[-1].endswith("/approve"):
            expanded.append(expanded[-1].removesuffix("/approve") + "/reject")
        else:
            raise ValueError(f"Unrecognized path in {method} {expression!r}: {path!r}")
    return expanded


def parse_prd_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        required = {"Method", "Endpoint / Tool", "Screen", "Request", "Response"}
        if not required <= set(reader.fieldnames or []):
            raise ValueError(f"Expected PRD columns {sorted(required)}")
        contracts = []
        for row in reader:
            method = row["Method"].strip().upper()
            if method == "TOOL":
                continue  # Internal tools are not HTTP routes.
            if method not in HTTP_METHODS:
                raise ValueError(f"Unexpected HTTP method: {method}")
            for raw_path in expand_endpoints(method, row["Endpoint / Tool"]):
                contracts.append(
                    {
                        "method": method,
                        "prd_path": raw_path,
                        "path": canonical_path(raw_path),
                        "screen": row["Screen"].strip(),
                        "request": row["Request"].strip(),
                        "response": row["Response"].strip(),
                    }
                )
    return sorted(contracts, key=lambda item: (item["path"], item["method"]))


def audit_openapi(contracts: list[dict[str, str]], schema: dict) -> list[str]:
    problems = []
    for contract in contracts:
        method, path = contract["method"].lower(), contract["path"]
        operation = schema.get("paths", {}).get(path, {}).get(method)
        if not operation:
            problems.append(f"MISSING {contract['method']} {path} ({contract['prd_path']})")
            continue
        responses = operation.get("responses", {})
        success = [response for code, response in responses.items() if code.startswith("2")]
        if not success:
            problems.append(f"NO 2XX CONTRACT {contract['method']} {path}")
        elif not any(
            media.get("schema")
            for response in success
            for media in response.get("content", {}).values()
        ):
            problems.append(f"NO 2XX PAYLOAD SCHEMA {contract['method']} {path}")
        request = contract["request"].lower()
        if "multipart" in request:
            content = operation.get("requestBody", {}).get("content", {})
            if "multipart/form-data" not in content:
                problems.append(f"EXPECTED MULTIPART {contract['method']} {path}")
        if "?task=" in contract["prd_path"] or "?type=" in contract["prd_path"]:
            key = "task" if "?task=" in contract["prd_path"] else "type"
            params = operation.get("parameters", [])
            if not any(param.get("name") == key and param.get("in") == "query" for param in params):
                problems.append(f"MISSING QUERY {key}: {contract['method']} {path}")
        if "501" not in responses and path not in {
            "/api/v1/consents",
            "/api/v1/profile",
            "/api/v1/audit",
        }:
            problems.append(f"MISSING HONEST 501 CONTRACT {contract['method']} {path}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Optional local original PRD Kontrak API CSV")
    args = parser.parse_args(argv)
    committed = json.loads(MANIFEST.read_text(encoding="utf-8"))["http_contracts"]
    failures = []
    if args.csv:
        if not args.csv.is_file():
            parser.error(f"Cannot read source PRD: {args.csv}")
        actual = parse_prd_csv(args.csv)
        if actual != committed:
            failures.append(
                "Original PRD CSV differs from committed API_CONTRACT_MANIFEST.json. "
                "Review differences before editing API contracts."
            )
            diff = unified_diff(
                json.dumps(committed, indent=2, ensure_ascii=False).splitlines(),
                json.dumps(actual, indent=2, ensure_ascii=False).splitlines(),
                fromfile="tracked contract manifest",
                tofile="local PRD CSV",
                lineterm="",
            )
            failures.extend(list(diff)[:90])
    sys.path.insert(0, str(ROOT / "backend"))
    from app.main import app

    failures.extend(audit_openapi(committed, app.openapi()))
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    compared = "matched" if args.csv else "not requested"
    print(
        f"PRD contract coverage OK: {len(committed)} HTTP operations; "
        f"local CSV comparison: {compared}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
