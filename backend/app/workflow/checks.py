"""Deterministic evidence consistency checks. No model reasoning is used for any comparison."""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from app.workflow.evidence import (
    INVOICE_KINDS,
    RECORD_KINDS,
    money_str,
    norm_name,
    parse_date,
    parse_money,
)

PASS, FAIL, UNABLE = "PASS", "FAIL", "UNABLE_TO_VERIFY"


@dataclass
class Check:
    code: str
    label: str
    status: str
    detail: str
    item_kinds: list[str] = field(default_factory=list)


@dataclass
class Facts:
    claimant: str | None
    service_date: str | None
    amount: str | None
    currency: str | None
    policy_start: str | None
    policy_end: str | None
    filing_deadline_text: str | None
    today: date
    other_invoice_ids: set[str] = field(default_factory=set)


def _values(evidence: list[dict], kinds: tuple[str, ...], key: str) -> list[str]:
    output = []
    for item in evidence:
        if item["kind"] in kinds:
            value = (item["fields"].get(key) or {}).get("value")
            if value:
                output.append(str(value))
    return output


def _all_equal(values: list[str], normalizer) -> bool:
    return len({normalizer(v) for v in values}) <= 1


def filing_deadline_days(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"within\s+(\d{1,3})\s+calendar\s+days", text, re.IGNORECASE)
    return int(match.group(1)) if match else None


def run_checks(facts: Facts, evidence: list[dict]) -> list[Check]:
    checks: list[Check] = []
    invoices = [e for e in evidence if e["kind"] in INVOICE_KINDS]

    # 1. Claimant versus the name on invoices and records.
    names = _values(evidence, INVOICE_KINDS, "payer_name") + _values(
        evidence, RECORD_KINDS, "patient_name"
    )
    if not facts.claimant or not names:
        checks.append(
            Check(
                "CLAIMANT_MATCH",
                "Claimant matches evidence name",
                UNABLE,
                "Claimant name or evidence name is missing.",
            )
        )
    elif all(norm_name(n) == norm_name(facts.claimant) for n in names):
        checks.append(
            Check(
                "CLAIMANT_MATCH",
                "Claimant matches evidence name",
                PASS,
                "The claimant name matches every provided document.",
            )
        )
    else:
        checks.append(
            Check(
                "CLAIMANT_MATCH",
                "Claimant matches evidence name",
                FAIL,
                "A document names a different person than the claimant.",
                ["INVOICE"],
            )
        )

    # 2. Service date inside the policy period (inclusive).
    service = parse_date(facts.service_date) or next(
        (parse_date(v) for v in _values(evidence, INVOICE_KINDS, "billing_date")), None
    )
    start, end = parse_date(facts.policy_start), parse_date(facts.policy_end)
    if service is None or start is None or end is None:
        checks.append(
            Check(
                "SERVICE_DATE_IN_POLICY",
                "Service date is within the policy period",
                UNABLE,
                "Service date or policy period is missing.",
            )
        )
    elif start <= service <= end:
        checks.append(
            Check(
                "SERVICE_DATE_IN_POLICY",
                "Service date is within the policy period",
                PASS,
                f"{service.isoformat()} is inside {start.isoformat()} to {end.isoformat()}.",
            )
        )
    else:
        checks.append(
            Check(
                "SERVICE_DATE_IN_POLICY",
                "Service date is within the policy period",
                FAIL,
                f"{service.isoformat()} is outside {start.isoformat()} to {end.isoformat()}.",
                ["INVOICE"],
            )
        )

    # 3. Invoice total versus payment evidence.
    totals = [parse_money(v) for v in _values(evidence, INVOICE_KINDS, "total_amount")]
    paid = [parse_money(v) for v in _values(evidence, ("PAYMENT_RECEIPT",), "paid_amount")]
    if not totals or not paid or None in totals or None in paid:
        checks.append(
            Check(
                "INVOICE_PAYMENT_AMOUNT",
                "Invoice total matches payment evidence",
                UNABLE,
                "Payment evidence or invoice total is not available.",
            )
        )
    elif set(totals) == set(paid):
        checks.append(
            Check(
                "INVOICE_PAYMENT_AMOUNT",
                "Invoice total matches payment evidence",
                PASS,
                "The invoice total equals the amount paid.",
            )
        )
    else:
        checks.append(
            Check(
                "INVOICE_PAYMENT_AMOUNT",
                "Invoice total matches payment evidence",
                FAIL,
                "The invoice total and the amount paid differ.",
                ["INVOICE", "PAYMENT"],
            )
        )

    # 4. Provider identity across documents.
    providers = _values(
        evidence, INVOICE_KINDS + RECORD_KINDS + ("PAYMENT_RECEIPT",), "hospital_name"
    )
    if len(providers) < 2:
        checks.append(
            Check(
                "PROVIDER_MATCH",
                "Provider is consistent across documents",
                UNABLE,
                "At least two documents with a provider are needed.",
            )
        )
    elif _all_equal(providers, norm_name):
        checks.append(
            Check(
                "PROVIDER_MATCH",
                "Provider is consistent across documents",
                PASS,
                "All documents name the same provider.",
            )
        )
    else:
        checks.append(
            Check(
                "PROVIDER_MATCH",
                "Provider is consistent across documents",
                FAIL,
                "Documents name different providers.",
                ["INVOICE", "RECORD"],
            )
        )

    # 5. Date consistency between invoice, record and payment.
    dates = [parse_date(v) for v in _values(evidence, INVOICE_KINDS, "billing_date")]
    dates += [parse_date(v) for v in _values(evidence, RECORD_KINDS, "visit_date")]
    dates = [d for d in dates if d]
    if len(dates) < 2:
        checks.append(
            Check(
                "DATE_CONSISTENCY",
                "Service dates agree across documents",
                UNABLE,
                "At least two dated documents are needed.",
            )
        )
    elif len(set(dates)) == 1:
        checks.append(
            Check(
                "DATE_CONSISTENCY",
                "Service dates agree across documents",
                PASS,
                "All dated documents show the same date.",
            )
        )
    else:
        checks.append(
            Check(
                "DATE_CONSISTENCY",
                "Service dates agree across documents",
                FAIL,
                "Dated documents show different dates.",
                ["INVOICE", "RECORD"],
            )
        )

    # 6. Currency consistency.
    currencies = {
        c.upper() for c in _values(evidence, INVOICE_KINDS + ("PAYMENT_RECEIPT",), "currency")
    }
    if facts.currency:
        currencies.add(facts.currency.upper())
    if not currencies:
        checks.append(
            Check("CURRENCY_MATCH", "Currency is consistent", UNABLE, "No currency is recorded.")
        )
    elif len(currencies) == 1:
        checks.append(
            Check(
                "CURRENCY_MATCH",
                "Currency is consistent",
                PASS,
                f"Every amount uses {next(iter(currencies))}.",
            )
        )
    else:
        checks.append(
            Check(
                "CURRENCY_MATCH",
                "Currency is consistent",
                FAIL,
                "More than one currency appears: " + ", ".join(sorted(currencies)) + ".",
                ["INVOICE"],
            )
        )

    # 7. Claim amount versus the invoice total.
    claim_amount = parse_money(facts.amount)
    if claim_amount is None or not totals or None in totals:
        checks.append(
            Check(
                "CLAIM_AMOUNT_MATCH",
                "Claim amount matches the invoice",
                UNABLE,
                "Claim amount or invoice total is missing.",
            )
        )
    elif claim_amount in set(totals):
        checks.append(
            Check(
                "CLAIM_AMOUNT_MATCH",
                "Claim amount matches the invoice",
                PASS,
                "The claim amount equals the invoice total.",
            )
        )
    else:
        checks.append(
            Check(
                "CLAIM_AMOUNT_MATCH",
                "Claim amount matches the invoice",
                FAIL,
                f"Claim amount {money_str(claim_amount)} differs from the invoice total.",
                ["INVOICE"],
            )
        )

    # 8. Filing deadline, only when a verified procedure states one in calendar days.
    days = filing_deadline_days(facts.filing_deadline_text)
    if days is None or service is None:
        checks.append(
            Check(
                "FILING_DEADLINE",
                "Within the verified filing deadline",
                UNABLE,
                "No verified deadline in calendar days is available for this claim.",
            )
        )
    else:
        deadline = service + timedelta(days=days)
        if facts.today <= deadline:
            checks.append(
                Check(
                    "FILING_DEADLINE",
                    "Within the verified filing deadline",
                    PASS,
                    f"The published deadline is {deadline.isoformat()}.",
                )
            )
        else:
            checks.append(
                Check(
                    "FILING_DEADLINE",
                    "Within the verified filing deadline",
                    FAIL,
                    f"The published deadline {deadline.isoformat()} has passed.",
                    ["INVOICE"],
                )
            )

    # 9. The same invoice must not be used for another claim case.
    ids = {
        f"{(e['fields'].get('invoice_code') or {}).get('value', '')}|{e['fields']['invoice_number']['value']}"
        for e in invoices
        if (e["fields"].get("invoice_number") or {}).get("value")
    }
    if not ids:
        checks.append(
            Check(
                "DUPLICATE_INVOICE",
                "Invoice is not used in another claim",
                UNABLE,
                "No invoice number is recorded.",
            )
        )
    elif ids & facts.other_invoice_ids:
        checks.append(
            Check(
                "DUPLICATE_INVOICE",
                "Invoice is not used in another claim",
                FAIL,
                "This invoice number already appears in another claim case.",
                ["INVOICE"],
            )
        )
    else:
        checks.append(
            Check(
                "DUPLICATE_INVOICE",
                "Invoice is not used in another claim",
                PASS,
                "No other claim case uses this invoice number.",
            )
        )
    return checks


def invoice_identity(fields: dict) -> str | None:
    number = (fields.get("invoice_number") or {}).get("value")
    if not number:
        return None
    return f"{(fields.get('invoice_code') or {}).get('value', '')}|{number}"


def decimal_or_none(value) -> Decimal | None:
    return parse_money(value)
