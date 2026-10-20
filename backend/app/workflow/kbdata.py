"""Raw verified-source catalog reads for CN/ID (claim procedures, evidence, products, emergency).

Only active knowledge contexts are readable. The country is validated against a fixed allow-list,
never used as a filesystem path component.
"""

import json
import re
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError

ACTIVE_COUNTRIES = ("CN", "ID")


def _root() -> Path:
    return get_settings().kb_root


def require_country(country_code: str) -> str:
    code = (country_code or "").upper()
    if code not in ACTIVE_COUNTRIES:
        raise AppError(
            422,
            "UNSUPPORTED_COUNTRY",
            "Only China (CN) and Indonesia (ID) are active in this release.",
        )
    return code


@lru_cache(maxsize=64)
def _read(path: str, mtime: float):  # noqa: ARG001 - mtime busts the cache after KB updates
    return json.loads(Path(path).read_text(encoding="utf-8"))


def raw(country_code: str, name: str):
    code = require_country(country_code)
    path = _root() / code / f"{name}.json"
    if not path.is_file():
        return []
    return _read(str(path), path.stat().st_mtime)


def procedures(country_code: str) -> list[dict]:
    return [p for p in raw(country_code, "claims_procedures") if isinstance(p, dict)]


def evidence_items(country_code: str) -> list[dict]:
    return [p for p in raw(country_code, "claim_evidence") if isinstance(p, dict)]


def products(country_code: str) -> list[dict]:
    return [p for p in raw(country_code, "products") if isinstance(p, dict)]


def companies(country_code: str) -> list[dict]:
    return [p for p in raw(country_code, "companies") if isinstance(p, dict)]


def product(country_code: str, product_id: str | None) -> dict | None:
    if not product_id:
        return None
    return next((p for p in products(country_code) if p.get("product_id") == product_id), None)


def procedure_for_product(country_code: str, product_id: str | None) -> dict | None:
    if not product_id:
        return None
    return next(
        (p for p in procedures(country_code) if product_id in p.get("relevant_product_ids", [])),
        None,
    )


def company(country_code: str, insurer_id: str | None) -> dict | None:
    if not insurer_id:
        return None
    return next((c for c in companies(country_code) if c.get("insurer_id") == insurer_id), None)


def _norm(value: str | None) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", " ", (value or "").casefold()).strip()


# Policy type or kind strings mapped to catalog product categories (conservative, explicit).
KIND_TO_CATEGORY = {
    "BPJS": "public_social_health",
    "JKN": "public_social_health",
    "PUBLIC_SOCIAL_HEALTH": "public_social_health",
    "INTERNATIONAL_STUDENT": "international_student",
    "STUDENT": "international_student",
    "EMPLOYER": "employer_group",
    "GROUP": "employer_group",
    "EMPLOYER_GROUP": "employer_group",
    "PRIVATE_MEDICAL": "private_medical",
    "PRIVATE": "private_medical",
    "TRAVEL": "travel",
    "CRITICAL_ILLNESS": "critical_illness",
    "LIFE": "life",
    "PERSONAL_ACCIDENT": "personal_accident",
    "ACCIDENT": "personal_accident",
}


def category_for_kind(kind: str | None) -> str | None:
    return KIND_TO_CATEGORY.get(re.sub(r"[\s-]+", "_", (kind or "").strip()).upper())


def match_product(
    country_code: str, provider: str | None, policy_name: str | None, kind: str | None
) -> dict | None:
    """Deterministic, conservative linking of a stored policy to one catalog product.

    A product is returned only when the policy name equals a catalog product name, or when the
    insurer brand/legal name appears in the provider text and exactly one product of the
    matching category exists for that insurer. Public schemes match on category alone.
    """
    catalog = products(country_code)
    name = _norm(policy_name)
    if name:
        for item in catalog:
            if name in {_norm(item.get("english_name")), _norm(item.get("original_product_name"))}:
                return item
    category = category_for_kind(kind)
    if category in ("public_social_health", "international_student"):
        found = [p for p in catalog if p.get("product_category") == category]
        return found[0] if len(found) == 1 else None
    provider_text = _norm(provider)
    if not provider_text or category is None:
        return None
    insurers = []
    for item in companies(country_code):
        names = {_norm(item.get("brand_name")), _norm(item.get("legal_entity_name"))}
        if any(n and (n in provider_text or provider_text in n) for n in names):
            insurers.append(item.get("insurer_id"))
    candidates = [
        p
        for p in catalog
        if p.get("insurer_id") in insurers and p.get("product_category") == category
    ]
    return candidates[0] if len(candidates) == 1 else None


def emergency(country_code: str) -> dict:
    data = raw(country_code, "emergency")
    return data if isinstance(data, dict) else {}


def red_flags(country_code: str) -> dict:
    data = raw(country_code, "red_flags")
    return data if isinstance(data, dict) else {}


def injection_patterns() -> list[str]:
    path = _root() / "injection_patterns.json"
    if not path.is_file():
        return []
    data = _read(str(path), path.stat().st_mtime)
    return [item["pattern"] for item in data.get("data", []) if isinstance(item, dict)]
