"""Read normalized fields once; never extract or invent financial facts."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from app.schemas.valen import NumericFact
from app.services.workspace import CoverageView, FieldValue, parsed_date

SUFFIXES = (
    "limit_amount|used_amount|currency|period_start|period_end|excess|"
    "network_only|requires_referral|claim_mode|coverage_status|exclusion_quote"
)


def amount(field: FieldValue) -> Decimal | None:
    if not isinstance(field.value, str) or not re.fullmatch(r"\d+(?:\.\d+)?", field.value):
        return None
    try:
        value = Decimal(field.value)
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def benefit_fields(coverage: CoverageView) -> dict[str, dict[str, FieldValue]]:
    output: dict[str, dict[str, FieldValue]] = {}
    for key, field in coverage.fields.items():
        match = re.fullmatch(rf"benefit_([a-z_]+)_({SUFFIXES})", key)
        if match:
            output.setdefault(match[1], {})[match[2]] = field
    return output


def financial_facts(coverage: CoverageView, today: date) -> list[NumericFact]:
    output = []
    for category, fields in benefit_fields(coverage).items():
        limit = amount(fields.get("limit_amount", FieldValue()))
        used = amount(fields.get("used_amount", FieldValue()))
        currency = fields.get("currency", FieldValue()).value
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
            currency = None
        start = parsed_date(fields.get("period_start", FieldValue()).value)
        end = parsed_date(fields.get("period_end", FieldValue()).value)
        period_known = bool(start and end and start <= today <= end)
        remaining = (
            max(limit - used, Decimal(0))
            if limit is not None and used is not None and currency and period_known
            else None
        )
        relevant = ["limit_amount", "used_amount", "currency", "period_start", "period_end"]
        verified = all(fields.get(k, FieldValue()).status == "FOUND" for k in relevant)
        label = "FROM_DOCUMENT" if verified and remaining is not None else "ESTIMATE"
        if remaining is None:
            label = "NEEDS_CONFIRMATION"
        output.append(
            NumericFact(
                category=category,
                currency=currency,
                limit=format(limit, "f") if limit is not None else None,
                used=format(used, "f") if used is not None else None,
                remaining=format(remaining, "f") if remaining is not None else None,
                period_start=start,
                period_end=end,
                label=label,
                over_limit=bool(
                    limit is not None and used is not None and used > limit and period_known
                ),
                explanation=(
                    "Sisa dibatasi nol bila pemakaian melampaui limit; konfirmasi kepada penyedia."
                    if remaining == 0 and used is not None and limit is not None and used > limit
                    else "Dihitung sistem dari data polis pada periode yang sama."
                    if remaining is not None
                    else (
                        "Sisa: tidak diketahui. "
                        "Pemakaian, mata uang, atau periode belum dapat dipastikan."
                    )
                ),
            )
        )
    return output
