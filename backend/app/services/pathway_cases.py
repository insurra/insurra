"""Create an owned DRAFT once. Checklist, submission and execution remain separate."""

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.models import ClaimCaseRow, PathwayDecisionRow
from app.services.approval import payload_sha256
from app.services.audit_logger import log_actor_event
from app.services.care_pathways import context_fingerprint
from app.services.command_center import local_day
from app.services.workspace import (
    coverages,
    owned_coverage,
    owner_filter,
    owner_values,
    profile,
    require_grants,
)


def find_existing(db, actor, body, key, fingerprint):
    rows = db.scalars(
        select(ClaimCaseRow).where(
            owner_filter(ClaimCaseRow, actor),
            or_(
                ClaimCaseRow.idempotency_key == key,
                ClaimCaseRow.comparison_id == body.comparison_id,
            ),
        )
    ).all()
    if any(row.payload_sha256 != fingerprint for row in rows):
        raise AppError(
            409, "IDEMPOTENCY_CONFLICT", "Konfirmasi ini sudah dipakai untuk pilihan berbeda."
        )
    return rows[0] if rows else None


def create_case(db, actor, kb, body, key, now=None):
    require_grants(db, actor)
    items = coverages(db, actor, kb)
    coverage = owned_coverage(items, body.coverage_id)
    # Ownership precedes proof/key errors; foreign and missing policy IDs both return 404.
    if not key or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,128}", key):
        raise AppError(
            422, "IDEMPOTENCY_KEY_REQUIRED", "Konfirmasi memerlukan Idempotency-Key yang valid."
        )
    if not body.comparison_id:
        raise AppError(409, "COMPARISON_REQUIRED", "Bandingkan jalur sebelum membuat kasus.")
    p = profile(db, actor)
    country = kb.load(p.country_code)
    payload_hash = payload_sha256({**body.model_dump(mode="json"), "country_code": p.country_code})
    existing = find_existing(db, actor, body, key, payload_hash)
    if existing:
        return existing.id
    decision = db.scalar(
        select(PathwayDecisionRow).where(
            PathwayDecisionRow.id == body.comparison_id,
            owner_filter(PathwayDecisionRow, actor),
        )
    )
    if decision is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Perbandingan tidak ditemukan.")
    now = now or datetime.now(UTC)
    created = (
        decision.created_at.replace(tzinfo=UTC)
        if decision.created_at.tzinfo is None
        else decision.created_at
    )
    if decision.country_code != p.country_code or not created <= now <= created + timedelta(
        minutes=15
    ):
        raise AppError(
            409,
            "COMPARISON_EXPIRED",
            "Konteks berubah atau perbandingan kedaluwarsa. Bandingkan ulang.",
        )
    config = next((c for c in country.pathways.pathways if c.pathway_code == body.path), None)
    option = next((c for c in decision.options if c["path"] == body.path), None)
    if (config and config.emergency) or (option and option.get("emergency")):
        raise AppError(409, "EMERGENCY_PATH", "Jalur darurat tidak membuat kasus di sini.")
    if not config or not option or option.get("coverage_id") != str(coverage.id):
        raise AppError(
            409, "INVALID_PATHWAY_CHOICE", "Pilih jalur dan perlindungan dari perbandingan aktif."
        )
    if option.get("fingerprint") != context_fingerprint(p, country, items):
        raise AppError(
            409, "CONTEXT_CHANGED", "Data atau KB berubah. Bandingkan ulang sebelum mengonfirmasi."
        )
    today, _, _ = local_day(p, country, now)
    if (
        coverage.country_code != p.country_code
        or coverage.kind not in config.policy_types
        or not coverage.active(today)
        or coverage.needs_check()
    ):
        raise AppError(
            409, "COVERAGE_NEEDS_CHECK", "Perlindungan perlu diperiksa sebelum membuat kasus."
        )
    from uuid import uuid4

    from sqlalchemy.exc import OperationalError

    case_id = uuid4()
    row = ClaimCaseRow(
        id=case_id,
        **owner_values(actor),
        comparison_id=decision.id,
        idempotency_key=key,
        payload_sha256=payload_hash,
        coverage_id=coverage.id,
        country_code=p.country_code,
        path=config.pathway_code,
        status="DRAFT",
        complaint_summary="Non-emergency care pathway selected; symptom details redacted.",
        created_at=now,
    )
    db.add(row)
    _bridge_workflow_claim(db, actor, p, coverage, config, row, key, now)
    log_actor_event(db, actor, "ACTION", subtype="claim_case_created")
    try:
        db.commit()
    except (IntegrityError, OperationalError):
        db.rollback()
        existing = find_existing(db, actor, body, key, payload_hash)
        if existing:
            return existing.id
        raise AppError(
            409,
            "CASE_CREATION_CONFLICT",
            "Confirmation is already being processed. Retry with the same Idempotency-Key.",
        ) from None
    return row.id


def _bridge_workflow_claim(
    db, actor, p, coverage, config, row: ClaimCaseRow, key: str, now: datetime
) -> None:
    from app.services.actor_scope import owner_for
    from app.workflow import kbdata, states
    from app.workflow.models import WfClaimCaseRow, WfClaimItemRow, WfClaimStatusEventRow

    owner = owner_for(actor)
    product = None
    procedure = None
    if p.country_code in kbdata.ACTIVE_COUNTRIES:
        product = kbdata.match_product(
            p.country_code, coverage.provider, coverage.provider, coverage.kind
        )
        if product:
            procedure = kbdata.procedure_for_product(p.country_code, product["product_id"])
    reference = f"CLM-{now.year}-{str(row.id)[:8].upper()}"
    wf_case = WfClaimCaseRow(
        id=row.id,
        owner_kind=owner.kind,
        owner_id=owner.id,
        reference=reference,
        title=f"{config.label} ({config.pathway_code})"[:200],
        claim_type="Medical reimbursement",
        country_code=p.country_code,
        coverage_ref=str(coverage.id),
        coverage_label=f"{coverage.kind} · {coverage.provider or 'Policy'}"[:200],
        insured_person="Self",
        claimant_name=(getattr(p, "full_name", None) or "User")[:200],
        product_id=product["product_id"] if product else None,
        procedure_id=procedure["procedure_id"] if procedure else None,
        policy_start=str(coverage.start) if coverage.start else None,
        policy_end=str(coverage.end) if coverage.end else None,
        status=states.DRAFT,
        origin="PATHWAY",
        origin_ref=str(row.id),
        idempotency_key=key,
        is_synthetic=bool(actor.session_id),
        conflict_notes={"acknowledged": {}, "origins": {}},
        created_at=now,
        updated_at=now,
    )
    db.add(wf_case)
    for pos, (code, label, reason) in enumerate(
        (
            (
                "POLICY",
                "Policy information",
                "Identifies the insured person and the policy period used by the claim checks.",
            ),
            (
                "SERVICE_DATE",
                "Service or visit date",
                "The date of service is needed to compare against the policy period and filing deadline.",
            ),
            (
                "PROVIDER_AMOUNT",
                "Provider and claim amount",
                "The claim form needs the provider, amount and currency taken from your documents.",
            ),
        ),
        start=1,
    ):
        db.add(
            WfClaimItemRow(
                claim_id=row.id,
                code=code,
                label=label,
                kind="INFO",
                reason=reason,
                position=pos,
            )
        )
    db.add(
        WfClaimStatusEventRow(
            claim_id=row.id,
            event_type="CASE_CREATED",
            to_status=states.DRAFT,
            source="USER",
            created_at=now,
        )
    )
