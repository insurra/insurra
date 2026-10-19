"""Deterministic approval binding only. This module never executes an action."""

import hashlib
import json


def payload_sha256(payload: dict) -> str:
    clean = (
        {k: v for k, v in payload.items() if k != "_execution_meta"}
        if isinstance(payload, dict) and "_execution_meta" in payload
        else payload
    )
    canonical = json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
