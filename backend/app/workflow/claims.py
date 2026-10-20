"""Claim case domain: requirements from verified KB data, evidence, checks, readiness and draft."""

import hashlib
import re
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.services.events import dispatch
from app.workflow import audit, kbdata, states
from app.workflow import evidence as ev
from app.workflow.checks import Facts, invoice_identity, run_checks
from app.workflow.models import (
    WfActionRow,
    WfClaimCaseRow,
    WfClaimDraftRow,
    WfClaimEvidenceRow,
    WfClaimItemRow,
    WfClaimStatusEventRow,
)
from app.workflow.owner import Owner, PolicyView, owner_policy

COMPLETE, MISSING, NEEDS_REVIEW, NOT_APPLICABLE, CONFLICT = (
    "COMPLETE",
    "MISSING",
    "NEEDS_REVIEW",
    "NOT_APPLICABLE",
    "CONFLICT",
)
ACCEPTS = {
    "FAPIAO": ("FAPIAO",),
    "MEDICAL_INVOICE": ("MEDICAL_INVOICE", "FAPIAO"),
    "ITEMIZED_BILL": ("ITEMIZED_BILL",),
    "MEDICAL_RECORD": ("MEDICAL_RECORD", "MEDICAL_SUMMARY"),
    "MEDICAL_SUMMARY": ("MEDICAL_SUMMARY", "MEDICAL_RECORD"),
    "PAYMENT_RECEIPT": ("PAYMENT_RECEIPT",),
}
GENERIC_CLAIM_TYPES = [
    "Medical reimbursement",
    "Accident-related claim",
    "Travel insurance claim",
    "Employer group insurance claim",
    "Other insurer-specific claim",
]
DRAFT_FIELDS = [
    ("policy_reference", "Member Information", "Policy reference", True),
    ("insurer", "Member Information", "Insurer", True),
    ("member_name", "Member Information", "Member name", True),
    ("relationship", "Member Information", "Relationship to policyholder", False),
    ("visit_date", "Visit Details", "Date of visit", True),
    ("provider_name", "Visit Details", "Provider name", True),
    ("claim_type", "Visit Details", "Claim type", True),
    ("total_claim_amount", "Claim Details", "Total claim amount", True),
    ("currency", "Claim Details", "Currency", True),
    ("diagnosis", "Claim Details", "Diagnosis or treatment", False),
]
EDITABLE_CASE_FIELDS = {
    "title",
    "claim_type",
    "service_date",
    "provider_name",
    "amount",
    "currency",
    "claimant_name",
    "insured_person",
}


def _now() -> datetime:
    return datetime.now(UTC)


def not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Claim case not found.")


def get_case(db: Session, owner: Owner, claim_id: UUID) -> WfClaimCaseRow:
    case = db.get(WfClaimCaseRow, claim_id)
    # Missing and foreign objects are indistinguishable by design.
    if case is None or case.owner_kind != owner.kind or case.owner_id != owner.id:
        raise not_found()
    return case


def _evidence_kind(item: dict) -> str:
    text = f"{item.get('evidence_id', '')} {item.get('evidence_item_name', '')}".casefold()
    if "fapiao" in text:
        return "FAPIAO"
    if "kuitansi" in text or "invoice" in text:
        return "MEDICAL_INVOICE"
    if "expense" in text or "itemized" in text or "breakdown" in text:
        return "ITEMIZED_BILL"
    if "resume" in text or "summary" in text or "discharge" in text:
        return "MEDICAL_SUMMARY"
    if "record" in text or "consultation" in text:
        return "MEDICAL_RECORD"
    if "payment" in text or "receipt" in text:
        return "PAYMENT_RECEIPT"
    return "OTHER"


def _applies(item_claim_type: str | None, case_claim_type: str) -> bool:
    item, case = (item_claim_type or "").casefold(), case_claim_type.casefold()
    for tag, other in (("outpatient", "inpatient"), ("inpatient", "outpatient")):
        if tag in case and other in item and tag not in item:
            return False
    return True


def pathway_mode(country_code: str, product_id: str | None) -> str:
    product = kbdata.product(country_code, product_id)
    if product and product.get("product_category") == "public_social_health":
        return "PUBLIC_SCHEME_PATHWAY"
    return "REIMBURSEMENT"


def claim_type_options(country_code: str, product_id: str | None) -> list[str]:
    procedure = kbdata.procedure_for_product(country_code, product_id)
    if procedure and procedure.get("claim_types"):
        return list(procedure["claim_types"])
    return list(GENERIC_CLAIM_TYPES)


def build_items(db: Session, case: WfClaimCaseRow) -> None:
    db.query(WfClaimItemRow).filter_by(claim_id=case.id, user_added=False).delete()
    procedure = kbdata.procedure_for_product(case.country_code, case.product_id)
    mode = pathway_mode(case.country_code, case.product_id)
    position = 0

    def add(code, label, kind, reason, **extra):
        nonlocal position
        position += 1
        db.add(
            WfClaimItemRow(
                claim_id=case.id,
                code=code,
                label=label,
                kind=kind,
                reason=reason,
                position=position,
                **extra,
            )
        )

    add(
        "POLICY",
        "Policy information",
        "INFO",
        "Identifies the insured person and the policy period used by the claim checks.",
    )
    add(
        "SERVICE_DATE",
        "Service or visit date",
        "INFO",
        "The date of service is needed to compare against the policy period and filing deadline.",
    )
    add(
        "PROVIDER_AMOUNT",
        "Provider and claim amount",
        "INFO",
        "The claim form needs the provider, amount and currency taken from your documents.",
    )
    if case.product_id is not None:
        for item in kbdata.evidence_items(case.country_code):
            specific = item.get("product_id") == case.product_id
            generic = item.get("product_id") is None and item.get("insurer_id") is None
            if not (specific or (generic and mode == "REIMBURSEMENT")):
                continue
            applies = _applies(item.get("claim_type"), case.claim_type)
            verified = item.get("verification_status") == "VERIFIED"
            base_reason = item.get("description") or "Listed in the claim evidence requirements."
            if item.get("special_conditions"):
                base_reason = f"{base_reason} {item['special_conditions']}"
            reason = base_reason if verified else f"Insurer requirement unverified. {base_reason}"
            add(
                item["evidence_id"],
                item.get("evidence_item_name", "Supporting document"),
                "DOCUMENT",
                reason,
                label_original=item.get("evidence_item_name_original"),
                source_url=item.get("source_url"),
                kb_ref=item["evidence_id"],
                accepted_formats=item.get("accepted_formats", []),
                mandatory=bool(item.get("mandatory", True)),
                evidence_kind=_evidence_kind(item),
                not_applicable=not applies,
            )
        for index, form in enumerate((procedure or {}).get("required_forms", []), start=1):
            add(
                f"FORM_{index}",
                form,
                "FORM",
                "Official form named by the claim procedure. INSURRA prepares the "
                "content for your review.",
                source_url=(procedure or {}).get("source_url"),
                kb_ref=(procedure or {}).get("procedure_id"),
                mandatory=mode == "REIMBURSEMENT",
            )


def create_case(
    db: Session,
    owner: Owner,
    *,
    policy_ref: str,
    claim_type: str,
    title: str | None = None,
    origin: str = "CLAIMS_CENTER",
    origin_ref: str | None = None,
    idempotency_key: str | None = None,
    product_override: str | None = None,
    synthetic: bool = False,
    claimant_name: str | None = None,
    insured_person: str = "Self",
) -> WfClaimCaseRow:
    policy = owner_policy(db, owner, policy_ref)
    if policy is None:
        raise AppError(404, "NOT_FOUND", "Policy not found.")
    if idempotency_key:
        existing_by_key = db.scalar(
            select(WfClaimCaseRow).where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.idempotency_key == idempotency_key,
            )
        )
        if existing_by_key is not None:
            return existing_by_key
    if origin_ref:
        existing_by_origin = db.scalar(
            select(WfClaimCaseRow).where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.origin == origin,
                WfClaimCaseRow.origin_ref == origin_ref,
            )
        )
        if existing_by_origin is not None:
            return existing_by_origin
    country = kbdata.require_country(policy.country_code or owner.country_code or "")
    if product_override:
        product = kbdata.product(country, product_override)
    else:
        product = kbdata.match_product(country, policy.provider, policy.name, policy.kind)
    count = db.query(WfClaimCaseRow).filter_by(owner_kind=owner.kind, owner_id=owner.id).count()
    reference = f"CLM-{_now().year}-{count + 1:03d}"
    while (
        db.query(WfClaimCaseRow)
        .filter_by(owner_kind=owner.kind, owner_id=owner.id, reference=reference)
        .first()
    ):
        count += 1
        reference = f"CLM-{_now().year}-{count + 1:03d}"
    procedure = kbdata.procedure_for_product(country, product["product_id"]) if product else None
    case = WfClaimCaseRow(
        owner_kind=owner.kind,
        owner_id=owner.id,
        reference=reference,
        title=(title or claim_type)[:200],
        claim_type=claim_type[:120],
        country_code=country,
        coverage_ref=policy.ref,
        coverage_label=(policy.name or policy.provider or policy.kind)[:200],
        insured_person=insured_person[:200],
        claimant_name=(claimant_name or owner.display_name)[:200],
        product_id=product["product_id"] if product else None,
        procedure_id=procedure["procedure_id"] if procedure else None,
        policy_start=policy.start,
        policy_end=policy.end,
        status=states.DRAFT,
        origin=origin,
        origin_ref=origin_ref,
        idempotency_key=idempotency_key,
        is_synthetic=synthetic,
        conflict_notes={"acknowledged": {}, "origins": {}},
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(case)
    db.flush()
    build_items(db, case)
    states.add_event(db, case, "CASE_CREATED", to_status=states.DRAFT, source="USER")
    audit.record(
        db,
        owner,
        "CLAIM_CASE_CREATED",
        "CLAIMS",
        "Claim case created",
        summary=f"{claim_type} claim case {reference} was created.",
        actor_type="USER",
        tool="create_claim_case",
        claim_id=case.id,
        details={
            "claim_reference": reference,
            "claim_type": claim_type,
            "country_code": country,
            "origin": origin,
            "reason_code": "NO_VERIFIED_PROCEDURE" if procedure is None else "KB_PROCEDURE",
        },
    )
    audit.agent_event(
        db,
        owner,
        "get_applicable_claim_procedure",
        "OK",
        case.id,
        {"reason_code": "MATCHED" if procedure else "NO_VERIFIED_PROCEDURE"},
    )
    dispatch(db, owner, "claim.created", case.id)
    return case


def case_evidence(db: Session, case: WfClaimCaseRow) -> list[WfClaimEvidenceRow]:
    return list(
        db.scalars(
            select(WfClaimEvidenceRow)
            .where(WfClaimEvidenceRow.claim_id == case.id)
            .order_by(WfClaimEvidenceRow.created_at, WfClaimEvidenceRow.id)
        )
    )


def case_items(db: Session, case: WfClaimCaseRow) -> list[WfClaimItemRow]:
    return list(
        db.scalars(
            select(WfClaimItemRow)
            .where(WfClaimItemRow.claim_id == case.id)
            .order_by(WfClaimItemRow.position, WfClaimItemRow.code)
        )
    )


def case_draft(db: Session, case: WfClaimCaseRow) -> WfClaimDraftRow | None:
    return db.scalar(select(WfClaimDraftRow).where(WfClaimDraftRow.claim_id == case.id))


def _other_invoice_ids(db: Session, case: WfClaimCaseRow) -> set[str]:
    rows = db.execute(
        select(WfClaimEvidenceRow.fields)
        .join(WfClaimCaseRow, WfClaimCaseRow.id == WfClaimEvidenceRow.claim_id)
        .where(
            WfClaimCaseRow.owner_kind == case.owner_kind,
            WfClaimCaseRow.owner_id == case.owner_id,
            WfClaimCaseRow.id != case.id,
            WfClaimEvidenceRow.evidence_kind.in_(ev.INVOICE_KINDS),
        )
    ).all()
    return {i for (fields,) in rows if (i := invoice_identity(fields or {}))}


def evaluate_checks(
    db: Session, case: WfClaimCaseRow, rows: list[WfClaimEvidenceRow]
) -> list[dict]:
    procedure = kbdata.procedure_for_product(case.country_code, case.product_id)
    facts = Facts(
        claimant=case.claimant_name,
        service_date=case.service_date,
        amount=case.amount,
        currency=case.currency,
        policy_start=case.policy_start,
        policy_end=case.policy_end,
        filing_deadline_text=(procedure or {}).get("filing_deadlines"),
        today=date.today(),
        other_invoice_ids=_other_invoice_ids(db, case),
    )
    typed = [{"kind": r.evidence_kind, "fields": r.fields or {}} for r in rows]
    acknowledged = (case.conflict_notes or {}).get("acknowledged", {})
    output = []
    for check in run_checks(facts, typed):
        output.append(
            {
                "code": check.code,
                "label": check.label,
                "status": check.status,
                "detail": check.detail,
                "acknowledged": check.code in acknowledged and check.status == "FAIL",
                "acknowledgement_note": (acknowledged.get(check.code) or {}).get("note"),
            }
        )
    return output


def _group_conflict(item: WfClaimItemRow, checks: list[dict]) -> bool:
    kinds = ACCEPTS.get(item.evidence_kind or "", ())
    group = (
        "INVOICE"
        if set(kinds) & set(ev.INVOICE_KINDS)
        else ("RECORD" if set(kinds) & set(ev.RECORD_KINDS) else "PAYMENT")
    )
    hints = {
        "CLAIMANT_MATCH": {"INVOICE", "RECORD"},
        "SERVICE_DATE_IN_POLICY": {"INVOICE"},
        "INVOICE_PAYMENT_AMOUNT": {"INVOICE", "PAYMENT"},
        "PROVIDER_MATCH": {"INVOICE", "RECORD"},
        "DATE_CONSISTENCY": {"INVOICE", "RECORD"},
        "CURRENCY_MATCH": {"INVOICE"},
        "CLAIM_AMOUNT_MATCH": {"INVOICE"},
        "FILING_DEADLINE": {"INVOICE"},
        "DUPLICATE_INVOICE": {"INVOICE"},
    }
    return any(
        c["status"] == "FAIL" and not c["acknowledged"] and group in hints.get(c["code"], set())
        for c in checks
    )


def evaluate_items(
    case: WfClaimCaseRow,
    items: list[WfClaimItemRow],
    rows: list[WfClaimEvidenceRow],
    checks: list[dict],
    draft: WfClaimDraftRow | None,
) -> list[dict]:
    output = []
    for item in items:
        status, detail, action, verification = MISSING, None, "ADD", "NOT_PROVIDED"
        matching = [r for r in rows if r.evidence_kind in ACCEPTS.get(item.evidence_kind or "", ())]
        if item.not_applicable:
            status, verification, action = NOT_APPLICABLE, "NOT_APPLICABLE", None
            detail = "Does not apply to this claim type."
        elif item.code == "POLICY":
            if case.coverage_ref and case.policy_start and case.policy_end:
                status, verification, action = COMPLETE, "DECLARED", "VIEW"
                detail = f"{case.coverage_label} · {case.policy_start} to {case.policy_end}"
            else:
                status, verification, action = NEEDS_REVIEW, "UNVERIFIED", "ADD"
                detail = (
                    "Policy period is not recorded. Add the policy dates to enable date checks."
                )
        elif item.code == "SERVICE_DATE":
            if case.service_date:
                status, verification, action = COMPLETE, "USER_CONFIRMED", "EDIT"
                detail = case.service_date
        elif item.code == "PROVIDER_AMOUNT":
            have = [bool(case.provider_name), bool(case.amount), bool(case.currency)]
            if all(have):
                status, verification, action = COMPLETE, "USER_CONFIRMED", "EDIT"
                detail = f"{case.provider_name} · {case.currency} {case.amount}"
            elif any(have):
                status, verification, action = NEEDS_REVIEW, "UNVERIFIED", "ADD"
                detail = "Provider, amount and currency are all required."
        elif item.kind == "FORM":
            if draft is not None and case.review_confirmed:
                status, verification, action = COMPLETE, "USER_CONFIRMED", "VIEW"
                detail = "Prepared by INSURRA and confirmed by you."
            elif draft is not None:
                status, verification, action = NEEDS_REVIEW, "UNVERIFIED", "REVIEW"
                detail = "Prepared by INSURRA. Review it before approval."
            else:
                detail = "INSURRA prepares this from your confirmed evidence."
                action = "CREATE_DRAFT"
        elif matching:
            missing = [
                m for r in matching for m in ev.missing_required(r.evidence_kind, r.fields or {})
            ]
            pending = [m for r in matching for m in ev.unconfirmed(r.evidence_kind, r.fields or {})]
            if _group_conflict(item, checks):
                status, verification, action = CONFLICT, "CONFLICT", "RESOLVE"
                detail = "Evidence conflicts with other information. Review the consistency checks."
            elif missing:
                status, verification, action = NEEDS_REVIEW, "UPLOADED", "REVIEW"
                detail = "Required fields are missing: " + ", ".join(sorted(set(missing)))
            elif pending:
                status, verification, action = NEEDS_REVIEW, "UPLOADED", "REVIEW"
                detail = "Extracted values need your confirmation."
            else:
                status, verification, action = COMPLETE, "USER_CONFIRMED", "VIEW"
                detail = f"{len(matching)} file{'s' if len(matching) > 1 else ''} confirmed"
        else:
            if "Insurer requirement unverified" in (item.reason or ""):
                verification = "UNVERIFIED_REQUIREMENT"
                detail = "Insurer requirement unverified. No evidence attached yet."
            else:
                detail = (
                    "No evidence attached yet." if item.mandatory else "Optional. Not attached."
                )
        output.append(
            {
                "code": item.code,
                "label": item.label,
                "label_original": item.label_original,
                "kind": item.kind,
                "reason": item.reason,
                "source_url": item.source_url,
                "kb_ref": item.kb_ref,
                "mandatory": item.mandatory,
                "accepted_formats": item.accepted_formats or [],
                "status": status,
                "verification": verification,
                "details": detail,
                "resolution_action": action,
                "user_added": item.user_added,
                "evidence_ids": [str(r.id) for r in matching],
            }
        )
    return output


def counts(evaluated: list[dict]) -> dict:
    required = [
        i
        for i in evaluated
        if i["mandatory"] and i["status"] != NOT_APPLICABLE and i["kind"] in ("INFO", "DOCUMENT")
    ]
    return {
        "required_total": len(required),
        "complete": sum(1 for i in required if i["status"] == COMPLETE),
        "missing": sum(1 for i in required if i["status"] == MISSING),
        "needs_review": sum(1 for i in required if i["status"] in (NEEDS_REVIEW, CONFLICT)),
        "not_applicable": sum(1 for i in evaluated if i["status"] == NOT_APPLICABLE),
    }


def derive_status(
    case: WfClaimCaseRow,
    evaluated: list[dict],
    checks: list[dict],
    rows: list[WfClaimEvidenceRow],
    draft: WfClaimDraftRow | None,
) -> str:
    started = bool(rows or case.service_date or case.provider_name or case.amount)
    if not started:
        return states.DRAFT
    tally = counts(evaluated)
    if tally["missing"]:
        return states.MISSING_EVIDENCE
    if tally["needs_review"] or any(
        c["status"] == "FAIL" and not c["acknowledged"] for c in checks
    ):
        return states.NEEDS_REVIEW
    if draft is None or draft.missing_required or not case.review_confirmed:
        return states.NEEDS_REVIEW
    return states.READY_FOR_APPROVAL


def recompute(db: Session, owner: Owner, case: WfClaimCaseRow, *, source: str = "SYSTEM") -> dict:
    """Re-run deterministic evaluation and move pre-submission status when it changed."""
    rows = case_evidence(db, case)
    checks = evaluate_checks(db, case, rows)
    draft = case_draft(db, case)
    evaluated = evaluate_items(case, case_items(db, case), rows, checks, draft)
    if case.status in (*states.PRE_SUBMISSION, states.ADDITIONAL_INFO):
        target = derive_status(case, evaluated, checks, rows, draft)
        if case.status == states.ADDITIONAL_INFO and target in (states.DRAFT,):
            target = states.NEEDS_REVIEW
        if target != case.status and target in states.ALLOWED[case.status]:
            states.transition(db, case, target, source=source, event_type="READINESS_CHANGED")
    return {"checks": checks, "items": evaluated, "evidence": rows, "draft": draft}


def invalidate_pending_actions(db: Session, owner: Owner, case: WfClaimCaseRow, reason: str) -> int:
    """Any change to the claim invalidates prior approval and pending submissions."""
    from app.workflow.actions import invalidate_action

    pending = db.scalars(
        select(WfActionRow).where(
            WfActionRow.claim_id == case.id,
            WfActionRow.action_type == "sandbox_claim_submit",
            WfActionRow.status.in_(("AWAITING_APPROVAL", "APPROVED")),
        )
    ).all()
    for action in pending:
        invalidate_action(db, owner, action, reason)
    if pending and case.status == states.AWAITING_APPROVAL:
        states.transition(
            db,
            case,
            states.NEEDS_REVIEW,
            source="SYSTEM",
            note="Claim changed after approval was requested.",
        )
    return len(pending)


# ----- evidence -----------------------------------------------------------------------------


def add_evidence(
    db: Session,
    owner: Owner,
    case: WfClaimCaseRow,
    *,
    kind: str,
    filename: str,
    source_type: str,
    fields: dict | None = None,
    mime_type: str | None = None,
    content: bytes | None = None,
    source_document_id: str | None = None,
    synthetic: bool = False,
    confirmed: bool = False,
    injection_flag: bool = False,
) -> WfClaimEvidenceRow:
    if kind not in ev.EVIDENCE_KINDS:
        raise AppError(422, "INVALID_EVIDENCE_KIND", "Unsupported evidence type.")
    if kind != "REJECTION_LETTER" and case.status not in (
        *states.PRE_SUBMISSION,
        states.AWAITING_APPROVAL,
        states.ADDITIONAL_INFO,
    ):
        raise AppError(409, "CLAIM_LOCKED", "Evidence cannot be added after submission.")
    sha = hashlib.sha256(content).hexdigest() if content is not None else None
    if sha and db.query(WfClaimEvidenceRow).filter_by(claim_id=case.id, sha256=sha).first():
        raise AppError(409, "DUPLICATE_EVIDENCE", "This file is already attached to the claim.")
    prepared = {}
    for key, item in (fields or {}).items():
        item = dict(item)
        item["confirmed"] = bool(confirmed or item.get("confirmed"))
        prepared[key] = item
    row = WfClaimEvidenceRow(
        claim_id=case.id,
        evidence_kind=kind,
        filename=filename[:255],
        mime_type=mime_type,
        size_bytes=len(content) if content is not None else None,
        sha256=sha,
        content=content,
        source_type=source_type,
        source_document_id=source_document_id,
        fields=prepared,
        status="NEEDS_REVIEW",
        is_synthetic=synthetic,
        created_at=_now(),
    )
    db.add(row)
    db.flush()
    states.add_event(db, case, "EVIDENCE_ADDED", source="USER", note=f"{kind} attached")
    if kind != "REJECTION_LETTER":
        invalidate_pending_actions(db, owner, case, "EVIDENCE_CHANGED")
        case.review_confirmed = False
    audit.record(
        db,
        owner,
        "CLAIM_EVIDENCE_ADDED",
        "DOCUMENTS",
        "Document uploaded" if source_type != "USER_ENTERED" else "Evidence entered",
        summary=f"{kind.replace('_', ' ').title()} attached to claim {case.reference}.",
        actor_type="USER",
        tool="get_authorized_document_fields",
        claim_id=case.id,
        details={
            "claim_reference": case.reference,
            "document_kind": kind,
            "size_bytes": row.size_bytes or 0,
            "status": "FLAGGED_INSTRUCTION_REMOVED" if injection_flag else "ACCEPTED",
        },
    )
    if injection_flag:
        audit.record(
            db,
            owner,
            "SUSPICIOUS_DOCUMENT_INSTRUCTION",
            "SECURITY",
            "Suspicious document instruction ignored",
            summary="Instruction-like text in an uploaded document was treated as data and removed.",
            actor_type="BACKEND_EXECUTED",
            tool="remove_injection_lines",
            result_status="BLOCKED",
            claim_id=case.id,
            details={"document_kind": kind},
        )
    return row


def sync_case_from_evidence(db: Session, owner: Owner, case: WfClaimCaseRow) -> None:
    """Fill empty case facts from user-confirmed evidence fields. Never overwrite existing ones."""
    origins = (case.conflict_notes or {}).setdefault("origins", {})
    for row in case_evidence(db, case):
        fields = row.fields or {}

        def confirmed(key, fields=fields):
            item = fields.get(key) or {}
            return item.get("value") if item.get("confirmed") else None

        if row.evidence_kind in ev.INVOICE_KINDS:
            mapping = {
                "service_date": (
                    "billing_date",
                    lambda v: (ev.parse_date(v) or date.min).isoformat(),
                ),
                "provider_name": ("hospital_name", str),
                "amount": ("total_amount", lambda v: ev.money_str(ev.parse_money(v))),
                "currency": ("currency", lambda v: str(v).upper()),
            }
            for attr, (key, convert) in mapping.items():
                value = confirmed(key)
                if value and not getattr(case, attr):
                    converted = convert(value)
                    if converted and converted != "0001-01-01":
                        setattr(case, attr, converted)
                        origins[attr] = {
                            "origin": "EVIDENCE",
                            "evidence_id": str(row.id),
                            "label": row.filename,
                            "page": (fields[key] or {}).get("source_page"),
                        }
    case.conflict_notes = {**(case.conflict_notes or {}), "origins": origins}


def confirm_fields(
    db: Session,
    owner: Owner,
    case: WfClaimCaseRow,
    row: WfClaimEvidenceRow,
    values: dict[str, str],
) -> WfClaimEvidenceRow:
    specs = {s.key: s for s in ev.specs_for(row.evidence_kind)}
    fields = dict(row.fields or {})
    for key, raw_value in values.items():
        spec = specs.get(key)
        if spec is None:
            raise AppError(422, "INVALID_FIELD", "That field is not part of this evidence type.")
        try:
            value = ev.validate_field_value(spec, raw_value)
        except ValueError as exc:
            raise AppError(422, "INVALID_FIELD_VALUE", str(exc), {"field": key}) from exc
        previous = fields.get(key) or {}
        extracted = previous.get("extracted_value")
        origin = (
            "USER_ENTERED"
            if extracted is None
            else ("EXTRACTED" if value == extracted else "USER_CORRECTED")
        )
        fields[key] = {
            "value": value,
            "extracted_value": extracted,
            "source_page": previous.get("source_page"),
            "confirmed": True,
            "origin": origin,
        }
    for key, item in fields.items():
        if item.get("value") and key not in values:
            item["confirmed"] = True
    row.fields = fields
    row.status = (
        "CONFIRMED" if not ev.missing_required(row.evidence_kind, fields) else "NEEDS_REVIEW"
    )
    if row.evidence_kind != "REJECTION_LETTER":
        case.review_confirmed = False
        sync_case_from_evidence(db, owner, case)
        invalidate_pending_actions(db, owner, case, "EVIDENCE_CHANGED")
    audit.record(
        db,
        owner,
        "CLAIM_EVIDENCE_CONFIRMED",
        "DOCUMENTS",
        "Evidence fields confirmed",
        summary=f"Fields on {row.evidence_kind.replace('_', ' ').lower()} confirmed for {case.reference}.",
        actor_type="USER",
        claim_id=case.id,
        details={
            "claim_reference": case.reference,
            "document_kind": row.evidence_kind,
            "changed_fields": list(values),
        },
    )
    return row


def update_case_fields(db: Session, owner: Owner, case: WfClaimCaseRow, changes: dict) -> None:
    if case.status in states.POST_SUBMISSION and case.status != states.ADDITIONAL_INFO:
        raise AppError(409, "CLAIM_LOCKED", "This claim can no longer be edited.")
    origins = (case.conflict_notes or {}).setdefault("origins", {})
    for key, value in changes.items():
        if key not in EDITABLE_CASE_FIELDS:
            raise AppError(422, "INVALID_FIELD", "That field cannot be edited.")
        value = None if value in ("", None) else str(value).strip()
        if key == "service_date" and value and ev.parse_date(value) is None:
            raise AppError(422, "INVALID_FIELD_VALUE", "Service date must be a valid date.")
        if key == "service_date" and value:
            value = ev.parse_date(value).isoformat()
        if key == "amount" and value:
            money = ev.parse_money(value, case.currency)
            if money is None or money <= 0:
                raise AppError(422, "INVALID_FIELD_VALUE", "Amount must be greater than zero.")
            value = ev.money_str(money)
        if key == "currency" and value:
            if not re.fullmatch(r"[A-Za-z]{3}", value):
                raise AppError(422, "INVALID_FIELD_VALUE", "Currency must be a three letter code.")
            value = value.upper()
        if key in ("title", "claim_type") and not value:
            raise AppError(422, "INVALID_FIELD_VALUE", "This field cannot be empty.")
        setattr(case, key, value)
        if key in {"service_date", "provider_name", "amount", "currency", "claimant_name"}:
            origins[key] = {"origin": "USER", "label": "You entered this value"}
        if key == "claim_type":
            build_items(db, case)
    case.conflict_notes = {**(case.conflict_notes or {}), "origins": origins}
    case.review_confirmed = False
    case.updated_at = _now()
    invalidate_pending_actions(db, owner, case, "CLAIM_CHANGED")
    audit.record(
        db,
        owner,
        "CLAIM_UPDATED",
        "CLAIMS",
        "Claim information updated",
        summary=f"Information on claim {case.reference} was edited.",
        actor_type="USER",
        claim_id=case.id,
        details={"claim_reference": case.reference, "changed_fields": list(changes)},
    )


def acknowledge_check(
    db: Session, owner: Owner, case: WfClaimCaseRow, code: str, note: str
) -> None:
    rows = case_evidence(db, case)
    checks = {c["code"]: c for c in evaluate_checks(db, case, rows)}
    if code not in checks or checks[code]["status"] != "FAIL":
        raise AppError(409, "CHECK_NOT_IN_CONFLICT", "This check has no conflict to acknowledge.")
    notes = dict(case.conflict_notes or {})
    acknowledged = dict(notes.get("acknowledged", {}))
    acknowledged[code] = {"note": note.strip()[:300], "at": _now().isoformat()}
    notes["acknowledged"] = acknowledged
    case.conflict_notes = notes
    case.review_confirmed = False
    invalidate_pending_actions(db, owner, case, "CHECK_ACKNOWLEDGED")
    audit.record(
        db,
        owner,
        "CLAIM_CONFLICT_ACKNOWLEDGED",
        "CLAIMS",
        "Conflict acknowledged by user",
        summary=f"You documented a confirmation for a consistency check on {case.reference}.",
        actor_type="USER",
        claim_id=case.id,
        details={"claim_reference": case.reference, "check_codes": [code]},
    )


# ----- draft --------------------------------------------------------------------------------


def _field_source(case: WfClaimCaseRow, attr: str) -> dict:
    origin = ((case.conflict_notes or {}).get("origins") or {}).get(attr) or {}
    if origin.get("origin") == "EVIDENCE":
        return {
            "type": "EVIDENCE",
            "label": origin.get("label"),
            "evidence_id": origin.get("evidence_id"),
            "page": origin.get("page"),
        }
    if origin.get("origin") == "USER":
        return {"type": "USER_ENTERED", "label": "You entered this value"}
    return {"type": "CASE", "label": "Claim information"}


def build_draft_form(db: Session, case: WfClaimCaseRow, policy: PolicyView | None) -> dict:
    values = {
        "policy_reference": (
            policy.number_masked if policy else None,
            {"type": "POLICY", "label": "Policy data"},
        ),
        "insurer": (
            policy.provider if policy else None,
            {"type": "POLICY", "label": "Policy data"},
        ),
        "member_name": (case.claimant_name, _field_source(case, "claimant_name")),
        "relationship": (case.insured_person, {"type": "CASE", "label": "Claim information"}),
        "visit_date": (case.service_date, _field_source(case, "service_date")),
        "provider_name": (case.provider_name, _field_source(case, "provider_name")),
        "claim_type": (case.claim_type, {"type": "CASE", "label": "Claim information"}),
        "total_claim_amount": (case.amount, _field_source(case, "amount")),
        "currency": (case.currency, _field_source(case, "currency")),
    }
    diagnosis = None
    for row in case_evidence(db, case):
        item = (row.fields or {}).get("diagnosed_condition") or {}
        if item.get("confirmed") and item.get("value"):
            diagnosis = (
                item["value"],
                {
                    "type": "EVIDENCE",
                    "label": row.filename,
                    "evidence_id": str(row.id),
                    "page": item.get("source_page"),
                },
            )
            break
    values["diagnosis"] = diagnosis or (None, {"type": "NONE", "label": "Not provided"})
    form = {}
    for key, section, label, required in DRAFT_FIELDS:
        value, source = values[key]
        form[key] = {
            "value": value,
            "section": section,
            "label": label,
            "required": required,
            "source": source,
            "edited": False,
        }
    return form


def generate_draft(db: Session, owner: Owner, case: WfClaimCaseRow) -> WfClaimDraftRow:
    if case.status in states.POST_SUBMISSION and case.status != states.ADDITIONAL_INFO:
        raise AppError(409, "CLAIM_LOCKED", "This claim can no longer be edited.")
    if pathway_mode(case.country_code, case.product_id) != "REIMBURSEMENT":
        raise AppError(
            409,
            "NOT_A_REIMBURSEMENT_CLAIM",
            "This coverage is a public scheme service pathway, not a private reimbursement claim.",
        )
    policy = owner_policy(db, owner, case.coverage_ref)
    fresh = build_draft_form(db, case, policy)
    draft = case_draft(db, case)
    if draft is not None:
        for key, item in (draft.form or {}).items():
            if item.get("edited") and key in fresh:
                fresh[key] = {
                    **fresh[key],
                    "value": item["value"],
                    "edited": True,
                    "source": {"type": "USER_ENTERED", "label": "You edited this value"},
                }
    missing = [k for k, v in fresh.items() if v["required"] and not v["value"]]
    created = draft is None
    if draft is None:
        draft = WfClaimDraftRow(claim_id=case.id, form=fresh, missing_required=missing)
        db.add(draft)
    else:
        draft.form, draft.missing_required = fresh, missing
        draft.version += 1
    draft.updated_at = _now()
    draft.status = "DRAFT"
    case.review_confirmed = False
    db.flush()
    states.add_event(
        db,
        case,
        "DRAFT_GENERATED",
        source="AGENT",
        note="Claim form populated from authorized evidence",
    )
    audit.record(
        db,
        owner,
        "CLAIM_DRAFT_PREPARED",
        "CLAIMS",
        "Claim draft prepared",
        summary=f"INSURRA prepared the claim form for {case.reference} from your evidence.",
        actor_type="AI_PREPARED",
        tool="prepare_claim_draft",
        claim_id=case.id,
        details={"claim_reference": case.reference, "missing_items": missing},
    )
    audit.agent_event(
        db,
        owner,
        "prepare_claim_draft",
        "OK",
        case.id,
        {"missing_items": missing, "status": "CREATED" if created else "UPDATED"},
    )
    return draft


def edit_draft(
    db: Session, owner: Owner, case: WfClaimCaseRow, values: dict[str, str]
) -> WfClaimDraftRow:
    draft = case_draft(db, case)
    if draft is None:
        raise AppError(409, "DRAFT_NOT_PREPARED", "Create the claim draft first.")
    if case.status in states.POST_SUBMISSION and case.status != states.ADDITIONAL_INFO:
        raise AppError(409, "CLAIM_LOCKED", "This claim can no longer be edited.")
    form = dict(draft.form)
    for key, value in values.items():
        if key not in form:
            raise AppError(422, "INVALID_FIELD", "That draft field does not exist.")
        text = (value or "").strip()
        if key == "visit_date" and text:
            parsed = ev.parse_date(text)
            if parsed is None:
                raise AppError(422, "INVALID_FIELD_VALUE", "Visit date must be a valid date.")
            text = parsed.isoformat()
        if key == "total_claim_amount" and text:
            money = ev.parse_money(text, form.get("currency", {}).get("value"))
            if money is None or money <= 0:
                raise AppError(422, "INVALID_FIELD_VALUE", "Amount must be greater than zero.")
            text = ev.money_str(money)
        if key == "currency" and text:
            if not re.fullmatch(r"[A-Za-z]{3}", text):
                raise AppError(422, "INVALID_FIELD_VALUE", "Currency must be a three letter code.")
            text = text.upper()
        form[key] = {
            **form[key],
            "value": text or None,
            "edited": True,
            "source": {"type": "USER_ENTERED", "label": "You edited this value"},
        }
    draft.form = form
    draft.missing_required = [k for k, v in form.items() if v["required"] and not v["value"]]
    draft.version += 1
    draft.updated_at = _now()
    case.review_confirmed = False
    invalidate_pending_actions(db, owner, case, "DRAFT_EDITED")
    audit.record(
        db,
        owner,
        "CLAIM_DRAFT_EDITED",
        "CLAIMS",
        "Claim draft edited",
        summary=f"You edited the claim draft for {case.reference}.",
        actor_type="USER",
        claim_id=case.id,
        details={"claim_reference": case.reference, "changed_fields": list(values)},
    )
    return draft


def confirm_draft(db: Session, owner: Owner, case: WfClaimCaseRow) -> None:
    draft = case_draft(db, case)
    if draft is None:
        raise AppError(409, "DRAFT_NOT_PREPARED", "Create the claim draft first.")
    if draft.missing_required:
        raise AppError(
            409,
            "DRAFT_INCOMPLETE",
            "Required draft fields are still empty.",
            {"missing_items": draft.missing_required},
        )
    case.review_confirmed = True
    audit.record(
        db,
        owner,
        "CLAIM_DRAFT_CONFIRMED",
        "CLAIMS",
        "Claim draft reviewed",
        summary=f"You reviewed and confirmed the claim draft for {case.reference}.",
        actor_type="USER",
        claim_id=case.id,
        details={"claim_reference": case.reference},
    )


# ----- dispute & rejection review (Flow C) --------------------------------------------------

DISPUTE_DISCLAIMER = (
    "This review compares the stated rejection reason against recorded policy context and "
    "evidence to highlight points that may be clarified. It does not conclude that the insurer "
    "is at fault and does not guarantee that an appeal or claim will be accepted."
)


def review_claim_rejection(
    db: Session,
    owner: Owner,
    case: WfClaimCaseRow,
    *,
    rejection_reason: str | None = None,
    cited_clause: str | None = None,
    record_audit: bool = False,
) -> dict:
    """Match rejection letter / reason against policy clauses and evidence without concluding fault."""
    rows = case_evidence(db, case)
    rejection_rows = [r for r in rows if r.evidence_kind == "REJECTION_LETTER"]
    latest_rej = rejection_rows[-1] if rejection_rows else None
    rej_fields = (latest_rej.fields if latest_rej else {}) or {}

    extracted_reason = ((rej_fields.get("rejection_reason") or {}).get("value") or "").strip()
    extracted_clause = ((rej_fields.get("cited_clause") or {}).get("value") or "").strip()
    extracted_date = ((rej_fields.get("rejection_date") or {}).get("value") or "").strip()
    extracted_ref = ((rej_fields.get("insurer_reference") or {}).get("value") or "").strip()

    effective_reason = (
        (rejection_reason or "").strip()
        or extracted_reason
        or (
            "Sandbox review requested clarification or declined coverage."
            if case.status == states.REJECTED_SANDBOX
            else "Unverified rejection basis — upload or confirm the rejection letter details."
        )
    )
    effective_clause = (
        (cited_clause or "").strip()
        or extracted_clause
        or "Specific policy exclusion/clause reference not yet verified in the rejection letter"
    )

    product = kbdata.product(case.country_code, case.product_id) or {}
    procedure = kbdata.procedure_for_product(case.country_code, case.product_id) or {}
    dispute_channels = kbdata.consumer_disputes(case.country_code)
    checks = evaluate_checks(db, case, rows)

    reason_lower = f"{effective_reason} {effective_clause}".casefold()

    matched_clauses: list[dict] = []
    clarifiable_issues: list[dict] = []

    # 1. Policy period & waiting period matching
    if any(k in reason_lower for k in ("date", "period", "waiting", "expired", "lapse", "masa", "tanggal", "等待期", "期限")):
        date_check = next((c for c in checks if c["code"] == "SERVICE_DATE_IN_POLICY"), None)
        matched_clauses.append(
            {
                "clause_area": "Policy Coverage Period & Waiting Period",
                "policy_context": (
                    f"Recorded policy period: {case.policy_start or 'unverified'} to "
                    f"{case.policy_end or 'unverified'}; service date: {case.service_date or 'unverified'}."
                ),
                "comparison_status": (
                    "MATCHED_IN_EVIDENCE"
                    if date_check and date_check["status"] == "PASS"
                    else "NEEDS_CLARIFICATION"
                ),
            }
        )
        clarifiable_issues.append(
            {
                "code": "COVERAGE_PERIOD_ALIGNMENT",
                "title": "Clarify service date against active policy period",
                "detail": (
                    f"The rejection references timing or coverage period ({effective_clause}). "
                    f"Your recorded visit date ({case.service_date or 'not set'}) can be cross-referenced "
                    f"against policy effective dates ({case.policy_start or 'N/A'} – {case.policy_end or 'N/A'})."
                ),
                "suggested_evidence": "Active policy certificate and official hospital registration/visit record showing exact treatment date.",
            }
        )

    # 2. Medical necessity / diagnosis / pre-existing / exclusion matching
    if any(
        k in reason_lower
        for k in (
            "medical necessity",
            "diagnosis",
            "pre-existing",
            "exclusion",
            "outpatient",
            "inpatient",
            "medis",
            "diagnosa",
            "pengecualian",
            "既往症",
            "免责",
            "必要性",
        )
    ):
        matched_clauses.append(
            {
                "clause_area": "Benefit Scope & Medical Necessity Review",
                "policy_context": (
                    f"Product category: {product.get('product_category', 'unverified')}; "
                    f"claim type: {case.claim_type}."
                ),
                "comparison_status": "NEEDS_CLARIFICATION",
            }
        )
        clarifiable_issues.append(
            {
                "code": "CLINICAL_INDICATION_CLARIFICATION",
                "title": "Request clause-specific review with attending physician summary",
                "detail": (
                    "Where a denial cites medical necessity, benefit scope, or a general exclusion, "
                    "you can request the exact policy clause wording and submit the attending doctor's "
                    "clinical diagnosis note explaining symptom onset and treatment rationale."
                ),
                "suggested_evidence": "Medical record / discharge summary (Rekam Medis / 病历) and attending physician explanation.",
            }
        )

    # 3. Invoice / receipt / itemized breakdown matching
    if any(
        k in reason_lower
        for k in ("invoice", "receipt", "fapiao", "itemized", "document", "missing", "kuitansi", "dokumen", "发票", "清单")
    ):
        matched_clauses.append(
            {
                "clause_area": "Claim Evidence & Financial Documentation Requirements",
                "policy_context": (
                    f"Procedure administrator: {procedure.get('claims_administrator', 'Insurer Claims Dept')}; "
                    f"required forms: {', '.join(procedure.get('required_forms', [])) or 'standard claim form'}."
                ),
                "comparison_status": "NEEDS_CLARIFICATION",
            }
        )
        clarifiable_issues.append(
            {
                "code": "DOCUMENTATION_COMPLETENESS_CLARIFICATION",
                "title": "Provide itemized billing breakdown and verified invoice serials",
                "detail": (
                    "The rejection references documentation or billing format. Submitting the official "
                    "tax invoice/fapiao alongside the detailed fee breakdown allows the adjuster to "
                    "re-verify each billed line item."
                ),
                "suggested_evidence": "Official invoice (Fapiao / Kuitansi Asli) and itemized expense list (Perincian Biaya / 费用清单).",
            }
        )

    # Always provide a baseline clause comparison and clarification item if none of the specific keywords matched
    if not matched_clauses:
        matched_clauses.append(
            {
                "clause_area": "Written Denial Basis & Policy Clause Disclosure",
                "policy_context": (
                    f"Policy: {case.coverage_label or 'Recorded policy'} "
                    f"({case.policy_start or 'N/A'} to {case.policy_end or 'N/A'}) · Claim {case.reference}."
                ),
                "comparison_status": "NEEDS_CLARIFICATION",
            }
        )
    if not clarifiable_issues:
        clarifiable_issues.append(
            {
                "code": "WRITTEN_CLAUSE_AND_EVIDENCE_REVIEW",
                "title": "Request written explanation of the cited policy clause and re-evaluation",
                "detail": (
                    f"Stated reason: '{effective_reason}'. You may request the specific policy wording "
                    "relied upon by the assessor and ask which supplemental medical or billing records "
                    "are needed for an internal reconsideration."
                ),
                "suggested_evidence": "Rejection letter copy, policy schedule, medical invoice, and clinical summary.",
            }
        )

    has_invoice = any(r.evidence_kind in ev.INVOICE_KINDS for r in rows)
    has_record = any(r.evidence_kind in ev.RECORD_KINDS for r in rows)
    appeal_checklist = [
        {
            "code": "REJECTION_NOTICE",
            "label": "Insurer rejection letter / denial notice",
            "present": bool(rejection_rows),
            "status": "ATTACHED" if rejection_rows else "MISSING",
            "note": latest_rej.filename if latest_rej else "Upload the insurer's rejection letter (REJECTION_LETTER).",
        },
        {
            "code": "POLICY_SCHEDULE",
            "label": "Active policy reference & coverage period",
            "present": bool(case.coverage_ref and case.policy_start and case.policy_end),
            "status": "ATTACHED" if (case.coverage_ref and case.policy_start and case.policy_end) else "NEEDS_REVIEW",
            "note": f"{case.coverage_label or 'Policy'} ({case.policy_start or '?'} to {case.policy_end or '?'})",
        },
        {
            "code": "BILLING_PROOF",
            "label": "Official medical invoice / fapiao & itemized bill",
            "present": has_invoice,
            "status": "ATTACHED" if has_invoice else "MISSING",
            "note": "Confirmed billing evidence attached to this claim." if has_invoice else "Attach medical invoice or itemized bill.",
        },
        {
            "code": "CLINICAL_PROOF",
            "label": "Medical record or physician diagnosis summary",
            "present": has_record,
            "status": "ATTACHED" if has_record else "MISSING",
            "note": "Clinical record attached to support medical context." if has_record else "Attach medical record or doctor's note.",
        },
    ]

    contact = procedure.get("customer_support_contact") or "Insurer Claims Reconsideration / Customer Service Channel"
    dispute_ref = dispute_channels[0] if dispute_channels else None
    ref_display = extracted_ref or case.sandbox_ref or case.reference
    issue_bullets = "\n".join(f"- {item['title']}: {item['detail']}" for item in clarifiable_issues)
    checklist_bullets = "\n".join(
        f"- [{item['status']}] {item['label']}" for item in appeal_checklist
    )

    subject = f"Request for Claim Clarification & Reconsideration – {ref_display} ({case.reference})"
    body = (
        f"Dear Claims Review Team,\n\n"
        f"I am writing to request a written clarification and reconsideration regarding claim {ref_display} "
        f"(INSURRA case {case.reference}) under policy {case.coverage_label or case.coverage_ref or 'N/A'}.\n\n"
        f"Stated rejection reason on notice{f' ({extracted_date})' if extracted_date else ''}: {effective_reason}\n"
        f"Referenced clause/basis: {effective_clause}\n\n"
        f"Points submitted for factual clarification:\n{issue_bullets}\n\n"
        f"Supporting evidence checklist:\n{checklist_bullets}\n\n"
        f"Please confirm the specific policy wording applied to this assessment and advise whether "
        f"any additional clinical or billing documentation is required to complete the internal review.\n\n"
        f"Sincerely,\n{case.claimant_name or owner.display_name}"
    )

    existing_appeal_action = db.scalar(
        select(WfActionRow)
        .where(
            WfActionRow.claim_id == case.id,
            WfActionRow.action_type == "claim_dispute_appeal",
        )
        .order_by(WfActionRow.created_at.desc())
    )

    if record_audit:
        audit.record(
            db,
            owner,
            "CLAIM_REJECTION_REVIEWED",
            "CLAIMS",
            "Claim rejection reviewed for clarification",
            summary=(
                f"INSURRA matched the rejection reason on {case.reference} against policy context "
                "and identified factual points for clarification. No fault or outcome is guaranteed."
            ),
            actor_type="AI_PREPARED",
            tool="review_claim_rejection",
            claim_id=case.id,
            details={
                "claim_reference": case.reference,
                "clarifiable_count": len(clarifiable_issues),
                "insurer_at_fault_concluded": False,
                "acceptance_guaranteed": False,
            },
        )

    return {
        "claim_id": case.id,
        "claim_reference": case.reference,
        "has_rejection_letter": bool(rejection_rows),
        "rejection_evidence_id": latest_rej.id if latest_rej else None,
        "rejection_filename": latest_rej.filename if latest_rej else None,
        "stated_rejection_reason": effective_reason,
        "cited_clause": effective_clause,
        "rejection_date": extracted_date or None,
        "insurer_reference": extracted_ref or case.sandbox_ref,
        "review_posture": "CLARIFICATION_ONLY",
        "insurer_at_fault_concluded": False,
        "acceptance_guaranteed": False,
        "disclaimer": DISPUTE_DISCLAIMER,
        "matched_policy_clauses": matched_clauses,
        "clarifiable_issues": clarifiable_issues,
        "appeal_evidence_checklist": appeal_checklist,
        "regulatory_escalation_info": None
        if not dispute_ref
        else {
            "authority_name": dispute_ref.get("authority_name"),
            "channel_name": dispute_ref.get("channel_name"),
            "contact_phone": dispute_ref.get("contact_phone"),
            "online_portal": dispute_ref.get("online_portal"),
            "procedure_summary": dispute_ref.get("procedure_summary"),
            "published_deadlines": dispute_ref.get("published_deadlines"),
            "verification_status": dispute_ref.get("verification_status", "UNVERIFIED"),
        },
        "appeal_draft": {
            "subject": subject,
            "body": body,
            "recipient_note": contact,
        },
        "appeal_action_id": existing_appeal_action.id if existing_appeal_action else None,
        "appeal_action_status": existing_appeal_action.status if existing_appeal_action else None,
    }


# ----- views --------------------------------------------------------------------------------

STEP_ORDER = [
    ("case_created", "Case created"),
    ("documents_uploaded", "Documents uploaded"),
    ("information_verified", "Information verified"),
    ("draft_ready", "Claim draft ready"),
    ("pending_approval", "Pending your approval"),
    ("submitted", "Submitted to sandbox"),
    ("outcome", "Sandbox outcome"),
]


def build_steps(
    case: WfClaimCaseRow, tally: dict, rows: list, draft, events: list[WfClaimStatusEventRow]
) -> list[dict]:
    def at(*types):
        found = [e.created_at for e in events if e.event_type in types]
        return found[0] if found else None

    done = {
        "case_created": True,
        "documents_uploaded": bool(rows),
        "information_verified": tally["required_total"] > 0
        and tally["complete"] == tally["required_total"],
        "draft_ready": draft is not None and not draft.missing_required,
        "pending_approval": case.status == states.AWAITING_APPROVAL or bool(case.sandbox_ref),
        "submitted": bool(case.sandbox_ref),
        "outcome": case.status in (states.APPROVED_SANDBOX, states.REJECTED_SANDBOX),
    }
    times = {
        "case_created": at("CASE_CREATED"),
        "documents_uploaded": at("EVIDENCE_ADDED"),
        "draft_ready": at("DRAFT_GENERATED"),
        "submitted": at("SANDBOX_SUBMITTED"),
        "outcome": at("SANDBOX_STATUS_CHANGED"),
    }
    steps, current_set = [], False
    for key, label in STEP_ORDER:
        state = "done" if done[key] else ("pending" if current_set else "current")
        if state == "current":
            current_set = True
        steps.append(
            {
                "key": key,
                "label": label,
                "state": state,
                "at": times.get(key) if done[key] else None,
            }
        )
    return steps


def next_step(
    case: WfClaimCaseRow,
    evaluated: list[dict],
    checks: list[dict],
    draft,
    mode: str,
    has_action: bool,
) -> dict:
    status = case.status
    if status == states.AWAITING_APPROVAL:
        return {
            "key": "REVIEW_ACTION",
            "title": "Review the pending approval",
            "detail": "Open the action to approve, edit or reject the exact submission.",
            "cta": "Open Action Approval",
        }
    if status in (states.SUBMITTED, states.PROCESSING):
        return {
            "key": "CHECK_STATUS",
            "title": "Waiting for the sandbox",
            "detail": "INSURRA checks the sandbox for real status changes.",
            "cta": "Check status",
        }
    if status == states.ADDITIONAL_INFO:
        return {
            "key": "PROVIDE_INFO",
            "title": "Provide the requested information",
            "detail": "The sandbox asked for more documents. Add them, then resubmit.",
            "cta": "Add Missing Information",
        }
    if status in (states.APPROVED_SANDBOX, states.REJECTED_SANDBOX):
        return {
            "key": "DONE",
            "title": "Sandbox decision recorded",
            "detail": "This is a sandbox result, not a real insurer decision.",
            "cta": None,
        }
    if mode != "REIMBURSEMENT":
        return {
            "key": "PUBLIC_PATHWAY",
            "title": "Follow the public scheme pathway",
            "detail": "Public scheme services use the official referral process, not a private reimbursement claim.",
            "cta": None,
        }
    for item in evaluated:
        if item["mandatory"] and item["status"] == MISSING and item["kind"] != "FORM":
            return {
                "key": "ADD_ITEM",
                "title": f"Add: {item['label']}",
                "detail": item["reason"] or "",
                "cta": "Add Missing Information",
                "item_code": item["code"],
            }
    for item in evaluated:
        if (
            item["mandatory"]
            and item["status"] in (NEEDS_REVIEW, CONFLICT)
            and item["kind"] != "FORM"
        ):
            return {
                "key": "REVIEW_ITEM",
                "title": f"Review: {item['label']}",
                "detail": item["details"] or "",
                "cta": "Review Information",
                "item_code": item["code"],
            }
    if any(c["status"] == "FAIL" and not c["acknowledged"] for c in checks):
        return {
            "key": "RESOLVE_CONFLICT",
            "title": "Resolve a consistency conflict",
            "detail": "Correct the information or document your confirmation.",
            "cta": "Open Consistency Check",
        }
    if draft is None:
        return {
            "key": "CREATE_DRAFT",
            "title": "Create the claim draft",
            "detail": "INSURRA will populate the form from your confirmed evidence.",
            "cta": "Create Claim Draft",
        }
    if draft.missing_required:
        return {
            "key": "COMPLETE_DRAFT",
            "title": "Complete the empty draft fields",
            "detail": "Required fields stay empty until you provide them.",
            "cta": "Open Claim Draft",
        }
    if not case.review_confirmed:
        return {
            "key": "REVIEW_DRAFT",
            "title": "Review the claim draft",
            "detail": "Confirm the draft to enable sending it to approval.",
            "cta": "Open Claim Draft",
        }
    return {
        "key": "SEND_TO_APPROVAL",
        "title": "Send the draft to approval",
        "detail": "This creates a pending action. Nothing is submitted until you approve it.",
        "cta": "Send to Approval",
    }


def case_summary(case: WfClaimCaseRow) -> dict:
    return {
        "id": case.id,
        "reference": case.reference,
        "title": case.title,
        "claim_type": case.claim_type,
        "country_code": case.country_code,
        "coverage_label": case.coverage_label,
        "insured_person": case.insured_person,
        "service_date": case.service_date,
        "status": case.status,
        "status_label": states.LABELS.get(case.status, case.status),
        "sandbox_reference": case.sandbox_ref,
        "sandbox_status": case.sandbox_status,
        "is_synthetic": case.is_synthetic,
        "pathway_mode": pathway_mode(case.country_code, case.product_id),
        "updated_at": case.updated_at,
        "created_at": case.created_at,
    }


def case_detail(db: Session, owner: Owner, case: WfClaimCaseRow) -> dict:
    evaluation = recompute(db, owner, case)
    rows, checks, evaluated, draft = (
        evaluation["evidence"],
        evaluation["checks"],
        evaluation["items"],
        evaluation["draft"],
    )
    events = list(
        db.scalars(
            select(WfClaimStatusEventRow)
            .where(WfClaimStatusEventRow.claim_id == case.id)
            .order_by(WfClaimStatusEventRow.created_at, WfClaimStatusEventRow.id)
        )
    )
    tally = counts(evaluated)
    procedure = kbdata.procedure_for_product(case.country_code, case.product_id)
    product = kbdata.product(case.country_code, case.product_id)
    mode = pathway_mode(case.country_code, case.product_id)
    action = db.scalar(
        select(WfActionRow)
        .where(WfActionRow.claim_id == case.id)
        .order_by(WfActionRow.created_at.desc())
    )
    deadline_days = None
    if procedure:
        from app.workflow.checks import filing_deadline_days

        deadline_days = filing_deadline_days(procedure.get("filing_deadlines"))
    return {
        "case": {
            **case_summary(case),
            "claimant_name": case.claimant_name,
            "provider_name": case.provider_name,
            "amount": case.amount,
            "currency": case.currency,
            "policy_start": case.policy_start,
            "policy_end": case.policy_end,
            "coverage_ref": case.coverage_ref,
            "origin": case.origin,
            "review_confirmed": case.review_confirmed,
            "monitoring_enabled": case.monitoring_enabled,
            "monitoring_state": case.monitoring_state,
            "notify_on_change": case.notify_on_change,
            "last_checked_at": case.last_checked_at,
        },
        "readiness": {
            "state": case.status,
            "label": states.LABELS.get(case.status, case.status),
            **tally,
        },
        "checklist": evaluated,
        "consistency_checks": checks,
        "evidence": [
            {
                "id": r.id,
                "evidence_kind": r.evidence_kind,
                "filename": r.filename,
                "size_bytes": r.size_bytes,
                "sha256": r.sha256,
                "source_type": r.source_type,
                "status": r.status,
                "is_synthetic": r.is_synthetic,
                "created_at": r.created_at,
                "fields": [
                    {
                        "key": s.key,
                        "label": s.label,
                        "type": s.type,
                        "required": s.required,
                        "value": ((r.fields or {}).get(s.key) or {}).get("value"),
                        "extracted_value": ((r.fields or {}).get(s.key) or {}).get(
                            "extracted_value"
                        ),
                        "source_page": ((r.fields or {}).get(s.key) or {}).get("source_page"),
                        "confirmed": bool(((r.fields or {}).get(s.key) or {}).get("confirmed")),
                        "origin": ((r.fields or {}).get(s.key) or {}).get("origin"),
                    }
                    for s in ev.specs_for(r.evidence_kind)
                ],
            }
            for r in rows
        ],
        "draft": None
        if draft is None
        else {
            "version": draft.version,
            "status": draft.status,
            "missing_required": draft.missing_required or [],
            "form": draft.form,
            "fields": [{"key": k, **v} for k, v in draft.form.items()],
            "attachments": [
                {"evidence_id": r.id, "filename": r.filename, "evidence_kind": r.evidence_kind}
                for r in rows
            ],
            "updated_at": draft.updated_at,
        },
        "dispute_review": review_claim_rejection(db, owner, case, record_audit=False),
        "procedure": None
        if procedure is None
        else {
            "procedure_id": procedure.get("procedure_id"),
            "claims_administrator": procedure.get("claims_administrator"),
            "filing_deadlines": procedure.get("filing_deadlines"),
            "filing_deadline_days": deadline_days,
            "submission_channels": procedure.get("submission_channels", []),
            "customer_support_contact": procedure.get("customer_support_contact"),
            "published_processing_timeline": procedure.get("published_processing_timeline"),
            "official_portal_url": procedure.get("official_portal_url"),
            "source_url": procedure.get("source_url"),
            "verification_status": procedure.get("verification_status", "UNVERIFIED"),
        },
        "product": None
        if product is None
        else {
            "product_id": product.get("product_id"),
            "name": product.get("english_name") or product.get("original_product_name"),
            "category": product.get("product_category"),
            "territory": product.get("coverage_territory"),
            "source_url": product.get("product_url"),
        },
        "next_step": next_step(case, evaluated, checks, draft, mode, action is not None),
        "steps": build_steps(case, tally, rows, draft, events),
        "timeline": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "from_status": e.from_status,
                "to_status": e.to_status,
                "source": e.source,
                "note": e.note,
                "created_at": e.created_at,
            }
            for e in events
        ],
        "claim_type_options": claim_type_options(case.country_code, case.product_id),
        "procedure_status": "VERIFIED_PROCEDURE" if procedure else "NO_VERIFIED_PROCEDURE",
        "sandbox_environment_notice": "Sandbox results are test outcomes. No real claim is sent to an insurer.",
    }
