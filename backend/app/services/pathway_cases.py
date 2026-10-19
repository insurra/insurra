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
    row = ClaimCaseRow(
        **owner_values(actor),
        comparison_id=decision.id,
        idempotency_key=key,
        payload_sha256=payload_hash,
        coverage_id=coverage.id,
        country_code=p.country_code,
        path=config.pathway_code,
        status="DRAFT",
        complaint_summary="Kebutuhan layanan non-darurat; rincian keluhan disamarkan.",
        created_at=now,
    )
    db.add(row)
    log_actor_event(db, actor, "ACTION", subtype="claim_case_created")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = find_existing(db, actor, body, key, payload_hash)
        if existing:
            return existing.id
        raise AppError(
            409,
            "CASE_CREATION_CONFLICT",
            "Konfirmasi sedang diproses. Coba kembali dengan kunci yang sama.",
        ) from None
    return row.id
