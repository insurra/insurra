"""Executable insurer sandbox. Real backend code, persisted state, never a real insurer decision.

Lifecycle: SUBMITTED -> PROCESSING -> ADDITIONAL_INFO_REQUIRED | APPROVED | REJECTED.
Transitions are time based (settings.sandbox_step_seconds) and applied lazily on read, or forced
through the clearly labelled sandbox operator control.

Decision rules, in order, evaluated by the sandbox itself against the verified KB:
1. Service date outside the policy period: REJECTED_IN_SANDBOX.
2. Filing deadline stated in calendar days by the verified procedure has passed: REJECTED_IN_SANDBOX.
3. A mandatory evidence kind from the verified requirements is absent: ADDITIONAL_INFO_REQUIRED.
4. Otherwise: APPROVED_IN_SANDBOX.
"""

import hashlib
import re
import secrets
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.services.approval import payload_sha256
from app.workflow import evidence as ev
from app.workflow import kbdata
from app.workflow.checks import filing_deadline_days
from app.workflow.claims import ACCEPTS, _evidence_kind
from app.workflow.models import WfSandboxClaimRow
from app.workflow.owner import Owner

SUBMITTED, PROCESSING = "SUBMITTED", "PROCESSING"
ADDITIONAL_INFO, APPROVED, REJECTED = "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED"
LABEL = "SANDBOX (test environment, not a real insurer)"


class SandboxError(Exception):
    def __init__(self, errors: list[dict]):
        self.errors = errors


def _now() -> datetime:
    return datetime.now(UTC)


def _step() -> timedelta:
    return timedelta(seconds=max(0, get_settings().sandbox_step_seconds))


def validate(payload: dict) -> list[dict]:
    errors: list[dict] = []

    def need(path: str, value):
        if value in (None, "", [], {}):
            errors.append({"field": path, "code": "MISSING_FIELD"})
            return False
        return True

    need("claim_reference", payload.get("claim_reference"))
    need("claim_type", payload.get("claim_type"))
    need("claimant", payload.get("claimant"))
    policy = payload.get("policy") or {}
    need("policy.insurer", policy.get("insurer"))
    need("policy.reference", policy.get("reference"))
    service = payload.get("service") or {}
    need("service.provider", service.get("provider"))
    service_date = (
        ev.parse_date(service.get("date")) if need("service.date", service.get("date")) else None
    )
    if service.get("date") and service_date is None:
        errors.append({"field": "service.date", "code": "INVALID_DATE"})
    if service_date and service_date > date.today():
        errors.append({"field": "service.date", "code": "DATE_IN_FUTURE"})
    amount = payload.get("amount") or {}
    if need("amount.value", amount.get("value")):
        money = ev.parse_money(amount.get("value"))
        if money is None or money <= 0:
            errors.append({"field": "amount.value", "code": "INVALID_AMOUNT"})
    if need("amount.currency", amount.get("currency")) and not re.fullmatch(
        r"[A-Z]{3}", str(amount.get("currency"))
    ):
        errors.append({"field": "amount.currency", "code": "INVALID_CURRENCY"})
    if not payload.get("attachments"):
        errors.append({"field": "attachments", "code": "MISSING_FIELD"})
    if payload.get("pathway_mode", "REIMBURSEMENT") != "REIMBURSEMENT":
        errors.append({"field": "pathway_mode", "code": "UNSUPPORTED_PRODUCT"})
    return errors


def _evaluate(payload: dict) -> tuple[str, str, list[str]]:
    service = ev.parse_date((payload.get("service") or {}).get("date"))
    policy = payload.get("policy") or {}
    start, end = ev.parse_date(policy.get("start")), ev.parse_date(policy.get("end"))
    if service and start and end and not (start <= service <= end):
        return REJECTED, "The service date is outside the policy period.", []
    procedure = kbdata.procedure_for_product(
        payload.get("country_code", ""), payload.get("product_id")
    )
    days = filing_deadline_days((procedure or {}).get("filing_deadlines"))
    if service and days is not None and date.today() > service + timedelta(days=days):
        return REJECTED, "The published filing deadline has passed.", []
    attached = {a.get("evidence_kind") for a in payload.get("attachments", [])}
    missing = []
    for item in kbdata.evidence_items(payload.get("country_code", "")):
        if not item.get("mandatory", True):
            continue
        if item.get("product_id") != payload.get("product_id"):
            continue
        kind = _evidence_kind(item)
        if kind == "OTHER" or set(ACCEPTS.get(kind, (kind,))) & attached:
            continue
        # Inpatient-only evidence does not apply to an outpatient claim.
        claim_type = (payload.get("claim_type") or "").casefold()
        text = (item.get("claim_type") or "").casefold()
        if ("outpatient" in claim_type and "inpatient" in text and "outpatient" not in text) or (
            "inpatient" in claim_type and "outpatient" in text and "inpatient" not in text
        ):
            continue
        missing.append(kind)
    if missing:
        return ADDITIONAL_INFO, "Mandatory supporting evidence is missing.", sorted(set(missing))
    return APPROVED, "The sandbox rules found no issue with this submission.", []


def _history(row: WfSandboxClaimRow, status: str, note: str) -> None:
    row.history = [*row.history, {"status": status, "at": _now().isoformat(), "note": note}]


def submit(db: Session, owner: Owner, payload: dict, idempotency_key: str) -> WfSandboxClaimRow:
    existing = db.scalar(
        select(WfSandboxClaimRow).where(WfSandboxClaimRow.idempotency_key == idempotency_key)
    )
    if existing is not None:
        return existing
    errors = validate(payload)
    if errors:
        raise SandboxError(errors)
    digest = payload_sha256(payload)
    prior = None
    for row in db.scalars(
        select(WfSandboxClaimRow).where(
            WfSandboxClaimRow.owner_kind == owner.kind, WfSandboxClaimRow.owner_id == owner.id
        )
    ):
        if row.payload.get("claim_reference") == payload["claim_reference"]:
            prior = row
            break
    if prior is not None:
        if prior.payload_digest == digest:
            return prior
        if prior.status != ADDITIONAL_INFO:
            raise AppError(
                409,
                "SANDBOX_DUPLICATE_CLAIM",
                "A sandbox claim already exists for this claim case.",
                {"sandbox_reference": prior.claim_ref},
            )
        prior.payload, prior.payload_digest = payload, digest
        prior.status, prior.decision_reason, prior.missing_items = SUBMITTED, None, []
        prior.advance_at = _now() + _step()
        prior.updated_at = _now()
        prior.idempotency_key = idempotency_key
        _history(prior, SUBMITTED, "Resubmitted with additional information")
        db.flush()
        return prior
    row = WfSandboxClaimRow(
        claim_ref=f"SBX-{_now().year}-{secrets.token_hex(4).upper()}",
        idempotency_key=idempotency_key,
        owner_kind=owner.kind,
        owner_id=owner.id,
        payload=payload,
        payload_digest=digest,
        status=SUBMITTED,
        history=[],
        submitted_at=_now(),
        updated_at=_now(),
        advance_at=_now() + _step(),
    )
    _history(row, SUBMITTED, "Claim received by the sandbox")
    db.add(row)
    db.flush()
    return row


def advance(db: Session, row: WfSandboxClaimRow, now: datetime | None = None) -> bool:
    now = now or _now()
    changed = False
    for _ in range(2):
        due = row.advance_at is not None and now >= row.advance_at.replace(tzinfo=UTC)
        if not due:
            break
        if row.status == SUBMITTED:
            row.status = PROCESSING
            row.advance_at = now + _step()
            _history(row, PROCESSING, "Sandbox review started")
            changed = True
        elif row.status == PROCESSING:
            status, reason, missing = _evaluate(row.payload)
            row.status, row.decision_reason, row.missing_items = status, reason, missing
            row.advance_at = None
            _history(row, status, reason)
            changed = True
        else:
            break
    if changed:
        row.updated_at = now
        db.flush()
    return changed


def get_owned(db: Session, owner: Owner, claim_ref: str) -> WfSandboxClaimRow:
    row = db.scalar(select(WfSandboxClaimRow).where(WfSandboxClaimRow.claim_ref == claim_ref))
    if row is None or row.owner_kind != owner.kind or row.owner_id != owner.id:
        raise AppError(404, "NOT_FOUND", "Sandbox claim not found.")
    return row


def operator_decision(
    db: Session, row: WfSandboxClaimRow, outcome: str, reason: str, items: list[str]
) -> None:
    if row.status not in (SUBMITTED, PROCESSING):
        raise AppError(409, "SANDBOX_NOT_PENDING", "The sandbox claim is not awaiting a decision.")
    if row.status == SUBMITTED:
        _history(row, PROCESSING, "Sandbox review started")
    row.status, row.decision_reason = outcome, reason[:300]
    row.missing_items = items if outcome == ADDITIONAL_INFO else []
    row.advance_at = None
    row.updated_at = _now()
    _history(row, outcome, reason[:300] or "Decision set by the sandbox operator control")
    db.flush()


def view(row: WfSandboxClaimRow) -> dict:
    return {
        "claim_reference": row.claim_ref,
        "status": row.status,
        "decision_reason": row.decision_reason,
        "missing_items": row.missing_items or [],
        "history": row.history,
        "payload_digest": row.payload_digest,
        "submitted_at": row.submitted_at,
        "updated_at": row.updated_at,
        "environment": "SANDBOX",
        "notice": LABEL,
    }


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
