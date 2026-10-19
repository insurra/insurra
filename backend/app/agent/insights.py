"""Deterministic Protection Insights engine and persistence (B2.1, B4.3, B5.2).

Evaluates owned coverages, profile dates, extracted fields, workflow claims, and
pending actions to produce structured `ProtectionInsight` items with explicit
provenance and input fingerprints. Never uses an LLM to compute dates or gaps,
and never labels an `UNVERIFIED` rule as a mandatory legal breach.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.context import FactProvenance, get_user_context
from app.core.config import get_settings
from app.core.errors import AppError
from app.models import AccountFieldRow, ProtectionInsightRow
from app.schemas.common import Contract
from app.services.actor_scope import actor_for, owner_for, owner_values, owner_where
from app.services.events import dispatch
from app.services.intervals import uncovered_interval
from app.services.kb_loader import CountryKBLoader
from app.workflow.models import WfActionRow, WfClaimCaseRow
from app.workflow.owner import DEMO

InsightSeverity = Literal["HIGH", "NORMAL", "NEEDS_VERIFICATION"]
InsightStatus = Literal["OPEN", "RESOLVED", "SUPERSEDED", "USER_CORRECTED"]
InsightKind = Literal[
    "COVERAGE_CONTINUITY_INTERVAL",
    "POLICY_EXPIRY_SOON",
    "MISSING_EVIDENCE",
    "CLAIM_NEEDS_EVIDENCE",
    "ACTION_AWAITING_APPROVAL",
    "FIELD_NEEDS_CONFIRMATION",
]
NextActionKind = Literal[
    "OPEN_REVIEW",
    "PREPARE_ACTION",
    "OPEN_CLAIM",
    "OPEN_PATHWAYS",
    "OPEN_EMERGENCY",
]


class ComputedFact(Contract):
    key: str
    label: str
    value: str
    unit: str | None = None
    provenance: FactProvenance


class NextAction(Contract):
    kind: NextActionKind
    label: str
    deep_link: str
    action_type: str | None = None


class ProtectionInsight(Contract):
    id: UUID
    rule_id: str
    kind: InsightKind
    severity: InsightSeverity
    status: InsightStatus
    title: str
    explanation: str
    facts: list[ComputedFact] = Field(default_factory=list)
    coverage_id: UUID | None = None
    evidence_refs: list[dict[str, str | int | None]] = Field(default_factory=list)
    next_actions: list[NextAction] = Field(default_factory=list)
    kb_version: str = "1.5"
    created_at: datetime
    updated_at: datetime


class InsightList(Contract):
    items: list[ProtectionInsight] = Field(default_factory=list)
    kb_version: str = "1.5"
    generated_at: datetime
    synthetic: bool = False


class InsightDecisionRequest(Contract):
    decision: Literal["DISMISS", "CORRECT"]
    field_id: UUID | None = None


@dataclass(frozen=True)
class _CandidateInsight:
    rule_id: str
    kind: InsightKind
    severity: InsightSeverity
    coverage_id: UUID | None
    title: str
    explanation: str
    facts: list[dict]
    evidence_refs: list[dict]
    next_actions: list[dict]
    kb_version: str
    fingerprint: str


def _fingerprint(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val))
    except ValueError:
        return None


def _parse_uuid(val: str | None) -> UUID | None:
    if not val:
        return None
    try:
        return UUID(str(val))
    except ValueError:
        return None


def _compute_candidates(
    db: Session,
    actor_or_owner,
    kb_loader: CountryKBLoader,
    today: date,
) -> tuple[list[_CandidateInsight], str]:
    owner = owner_for(actor_or_owner)
    ctx = get_user_context(db, owner, kb_loader=kb_loader)
    kb_ver = ctx.kb_version or "1.5"
    candidates: list[_CandidateInsight] = []

    # 1. COVERAGE_CONTINUITY_INTERVAL
    req_start = _parse_date(ctx.study_start_date)
    end_candidates = [
        d
        for d in (_parse_date(ctx.study_end_date), _parse_date(ctx.permit_end_date))
        if d is not None
    ]
    req_end = max(end_candidates) if end_candidates else None

    if req_start and req_end and req_start <= req_end:
        rule_id = f"{(ctx.residence_country or 'kb').lower()}_coverage_continuity"
        rule_verified = False
        if ctx.kb_active and ctx.residence_country:
            try:
                ckb = kb_loader.load(ctx.residence_country.upper())
                for r in ckb.rules:
                    if r.kind in ("coverage_continuity", "visa_coverage"):
                        rule_id = r.rule_id
                        rule_verified = (
                            r.verification_status.value == "VERIFIED"
                            and getattr(r, "evidence_class", None) == "RETRIEVED_OFFICIAL"
                        )
                        break
            except Exception:  # noqa: BLE001
                pass

        intervals: list[tuple[date, date]] = []
        primary_cov_id: UUID | None = None
        evidence_refs: list[dict] = []
        for cov in ctx.coverages:
            if (
                ctx.residence_country
                and cov.country_code
                and cov.country_code != ctx.residence_country
            ):
                continue
            s = _parse_date(cov.start_date)
            e = _parse_date(cov.end_date)
            if s and e and s <= e:
                intervals.append((s, e))
                if primary_cov_id is None:
                    primary_cov_id = _parse_uuid(cov.id)
                for doc_id in cov.source_document_ids:
                    evidence_refs.append({"document_id": doc_id, "coverage_id": cov.id})

        uncovered_days, gap_ranges = uncovered_interval(req_start, req_end, intervals)
        if uncovered_days > 0:
            severity: InsightSeverity = "HIGH" if rule_verified else "NEEDS_VERIFICATION"
            gap_str = ", ".join(
                f"{g.start_date.isoformat()} to {g.end_date.isoformat()}" for g in gap_ranges
            )
            title = (
                f"Coverage continuity check: {uncovered_days} day(s) need verification"
                if severity == "NEEDS_VERIFICATION"
                else f"Coverage gap detected: {uncovered_days} uncovered day(s)"
            )
            explanation = (
                f"Recorded coverage ends before your planned study or stay end date ({req_end.isoformat()}), "
                f"leaving {uncovered_days} inclusive calendar day(s) ({gap_str}) without recorded coverage. "
                "Whether continuous coverage is mandatory depends on institutional or local requirements "
                "that are marked unverified in the knowledge base."
                if severity == "NEEDS_VERIFICATION"
                else f"Recorded coverage leaves {uncovered_days} inclusive calendar day(s) ({gap_str}) uncovered."
            )
            facts = [
                ComputedFact(
                    key="uncovered_days",
                    label="Uncovered calendar days",
                    value=str(uncovered_days),
                    unit="days",
                    provenance=FactProvenance(
                        origin="COMPUTED",
                        evidence_ref=evidence_refs[0] if evidence_refs else None,
                        verification_status="VERIFIED" if rule_verified else "UNVERIFIED",
                        jurisdiction=ctx.residence_country,
                    ),
                ).model_dump(mode="json"),
                ComputedFact(
                    key="unverified_interval",
                    label="Unverified date interval",
                    value=gap_str,
                    unit="date_range",
                    provenance=FactProvenance(
                        origin="COMPUTED",
                        evidence_ref={
                            "kb_country": ctx.residence_country,
                            "rule_id": rule_id,
                            "kb_version": kb_ver,
                        },
                        verification_status="VERIFIED" if rule_verified else "UNVERIFIED",
                        jurisdiction=ctx.residence_country,
                    ),
                ).model_dump(mode="json"),
            ]
            next_actions = [
                NextAction(
                    kind="PREPARE_ACTION",
                    label="Prepare renewal or continuity inquiry",
                    deep_link="/actions",
                    action_type="renewal_inquiry",
                ).model_dump(mode="json"),
                NextAction(
                    kind="OPEN_REVIEW",
                    label="Review coverage needs",
                    deep_link="/coverage-needs",
                ).model_dump(mode="json"),
            ]
            fp = _fingerprint(
                {
                    "kind": "COVERAGE_CONTINUITY_INTERVAL",
                    "rule_id": rule_id,
                    "coverage_id": str(primary_cov_id or ""),
                    "req_start": req_start.isoformat(),
                    "req_end": req_end.isoformat(),
                    "uncovered_days": uncovered_days,
                    "gaps": gap_str,
                    "severity": severity,
                }
            )
            candidates.append(
                _CandidateInsight(
                    rule_id=rule_id,
                    kind="COVERAGE_CONTINUITY_INTERVAL",
                    severity=severity,
                    coverage_id=primary_cov_id,
                    title=title,
                    explanation=explanation,
                    facts=facts,
                    evidence_refs=evidence_refs,
                    next_actions=next_actions,
                    kb_version=kb_ver,
                    fingerprint=fp,
                )
            )

    # 2. POLICY_EXPIRY_SOON & 3. MISSING_EVIDENCE
    for cov in ctx.coverages:
        cov_uuid = _parse_uuid(cov.id)
        end_dt = _parse_date(cov.end_date)
        label = cov.name or cov.provider or cov.kind
        if end_dt is not None:
            days_left = (end_dt - today).days
            if 0 <= days_left <= 30:
                exp_sev: InsightSeverity = "HIGH" if days_left <= 7 else "NORMAL"
                rule_id = "policy_expiry_soon"
                fp = _fingerprint(
                    {
                        "kind": "POLICY_EXPIRY_SOON",
                        "coverage_id": cov.id,
                        "end_date": end_dt.isoformat(),
                        "severity": exp_sev,
                    }
                )
                candidates.append(
                    _CandidateInsight(
                        rule_id=rule_id,
                        kind="POLICY_EXPIRY_SOON",
                        severity=exp_sev,
                        coverage_id=cov_uuid,
                        title=f"{label} ends on {end_dt.isoformat()} ({days_left} day(s) remaining)",
                        explanation=(
                            f"Recorded policy end date is {end_dt.isoformat()}. Renewal terms and "
                            "grace periods are not verified automatically. Prepare a renewal inquiry "
                            "if you need continuous coverage."
                        ),
                        facts=[
                            ComputedFact(
                                key="days_until_expiry",
                                label="Days until recorded end date",
                                value=str(days_left),
                                unit="days",
                                provenance=FactProvenance(
                                    origin="COMPUTED",
                                    evidence_ref={"coverage_id": cov.id},
                                    verification_status=cov.verification_status,
                                    jurisdiction=cov.country_code,
                                ),
                            ).model_dump(mode="json")
                        ],
                        evidence_refs=[{"coverage_id": cov.id, "end_date": end_dt.isoformat()}],
                        next_actions=[
                            NextAction(
                                kind="PREPARE_ACTION",
                                label="Prepare renewal inquiry",
                                deep_link="/actions",
                                action_type="renewal_inquiry",
                            ).model_dump(mode="json")
                        ],
                        kb_version=kb_ver,
                        fingerprint=fp,
                    )
                )

        if not cov.source_document_ids:
            rule_id = "missing_coverage_evidence"
            fp = _fingerprint(
                {
                    "kind": "MISSING_EVIDENCE",
                    "coverage_id": cov.id,
                }
            )
            candidates.append(
                _CandidateInsight(
                    rule_id=rule_id,
                    kind="MISSING_EVIDENCE",
                    severity="NORMAL",
                    coverage_id=cov_uuid,
                    title=f"Supporting document missing for {label}",
                    explanation=(
                        "This coverage record has no linked policy document. Upload a policy "
                        "certificate or schedule so dates and benefits can be verified."
                    ),
                    facts=[],
                    evidence_refs=[{"coverage_id": cov.id}],
                    next_actions=[
                        NextAction(
                            kind="OPEN_REVIEW",
                            label="Upload or link policy document",
                            deep_link="/documents",
                        ).model_dump(mode="json")
                    ],
                    kb_version=kb_ver,
                    fingerprint=fp,
                )
            )

    # 4. CLAIM_NEEDS_EVIDENCE
    claim_rows = db.scalars(
        select(WfClaimCaseRow).where(
            WfClaimCaseRow.owner_kind == owner.kind,
            WfClaimCaseRow.owner_id == owner.id,
            WfClaimCaseRow.status.in_(("NEEDS_EVIDENCE", "ADDITIONAL_INFO_REQUIRED")),
        )
    ).all()
    for claim in claim_rows:
        rule_id = f"claim_needs_evidence:{claim.id}"
        fp = _fingerprint(
            {
                "kind": "CLAIM_NEEDS_EVIDENCE",
                "claim_id": str(claim.id),
                "status": claim.status,
            }
        )
        candidates.append(
            _CandidateInsight(
                rule_id=rule_id[:80],
                kind="CLAIM_NEEDS_EVIDENCE",
                severity="HIGH",
                coverage_id=None,
                title=f"Claim {claim.reference} needs supporting evidence",
                explanation=(
                    f"Claim case {claim.reference} is currently in status {claim.status}. "
                    "Review the checklist and attach the requested documents before submission."
                ),
                facts=[],
                evidence_refs=[{"claim_id": str(claim.id), "reference": claim.reference}],
                next_actions=[
                    NextAction(
                        kind="OPEN_CLAIM",
                        label=f"Open claim {claim.reference}",
                        deep_link=f"/claims/{claim.id}",
                    ).model_dump(mode="json")
                ],
                kb_version=kb_ver,
                fingerprint=fp,
            )
        )

    # 5. ACTION_AWAITING_APPROVAL
    action_rows = db.scalars(
        select(WfActionRow).where(
            WfActionRow.owner_kind == owner.kind,
            WfActionRow.owner_id == owner.id,
            WfActionRow.status == "AWAITING_APPROVAL",
        )
    ).all()
    for act in action_rows:
        rule_id = f"action_awaiting_approval:{act.id}"
        fp = _fingerprint(
            {
                "kind": "ACTION_AWAITING_APPROVAL",
                "action_id": str(act.id),
                "payload_sha256": act.payload_sha256,
                "payload_version": act.payload_version,
            }
        )
        candidates.append(
            _CandidateInsight(
                rule_id=rule_id[:80],
                kind="ACTION_AWAITING_APPROVAL",
                severity="NORMAL",
                coverage_id=None,
                title=f"Action awaiting approval: {act.title}",
                explanation=(
                    "A prepared draft action requires your explicit review and approval "
                    "before it can be executed."
                ),
                facts=[],
                evidence_refs=[{"action_id": str(act.id), "action_type": act.action_type}],
                next_actions=[
                    NextAction(
                        kind="OPEN_REVIEW",
                        label="Review action in queue",
                        deep_link=f"/actions?action={act.id}",
                        action_type=act.action_type,
                    ).model_dump(mode="json")
                ],
                kb_version=kb_ver,
                fingerprint=fp,
            )
        )

    # 6. FIELD_NEEDS_CONFIRMATION (account extracted fields with low confidence)
    if owner.kind != DEMO:
        low_conf_fields = db.scalars(
            select(AccountFieldRow).where(
                AccountFieldRow.account_id == owner.id,
                AccountFieldRow.status == "FOUND",
                AccountFieldRow.confirmed_by_user.is_(False),
            )
        ).all()
        for f_row in low_conf_fields:
            if f_row.confidence is not None and f_row.confidence >= 0.8:
                continue
            rule_id = f"field_confirm:{f_row.field_key}"[:80]
            fp = _fingerprint(
                {
                    "kind": "FIELD_NEEDS_CONFIRMATION",
                    "field_id": str(f_row.id),
                    "field_key": f_row.field_key,
                    "value": str(f_row.value),
                }
            )
            candidates.append(
                _CandidateInsight(
                    rule_id=rule_id,
                    kind="FIELD_NEEDS_CONFIRMATION",
                    severity="NORMAL",
                    coverage_id=f_row.coverage_id,
                    title=f"Extracted field needs confirmation: {f_row.field_key.replace('_', ' ')}",
                    explanation=(
                        "An extracted policy field has low confidence or has not been confirmed. "
                        "Confirm or edit the value so coverage assessments use verified dates and limits."
                    ),
                    facts=[],
                    evidence_refs=[
                        {
                            "field_id": str(f_row.id),
                            "document_id": str(f_row.document_id) if f_row.document_id else None,
                            "page": f_row.source_page,
                        }
                    ],
                    next_actions=[
                        NextAction(
                            kind="OPEN_REVIEW",
                            label="Confirm extracted field",
                            deep_link="/completeness",
                        ).model_dump(mode="json")
                    ],
                    kb_version=kb_ver,
                    fingerprint=fp,
                )
            )

    return candidates, kb_ver


def _row_to_model(row: ProtectionInsightRow) -> ProtectionInsight:
    raw_facts = row.facts if isinstance(row.facts, list) else []
    raw_actions = row.next_actions if isinstance(row.next_actions, list) else []
    title = row.title or row.kind.replace("_", " ").title()
    explanation = row.explanation or ""
    cov_uuid = _parse_uuid(row.coverage_id)
    return ProtectionInsight(
        id=row.id,
        rule_id=row.rule_id,
        kind=row.kind,  # type: ignore[arg-type]
        severity=row.severity,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        title=title,
        explanation=explanation,
        facts=[ComputedFact.model_validate(item) for item in raw_facts],
        coverage_id=cov_uuid,
        evidence_refs=list(row.evidence_refs or []),
        next_actions=[NextAction.model_validate(act) for act in raw_actions],
        kb_version=row.kb_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def refresh_owner_insights(
    db: Session,
    actor_or_owner,
    *,
    kb_loader: CountryKBLoader | None = None,
    today: date | None = None,
) -> list[ProtectionInsight]:
    """Deterministically recompute and persist `ProtectionInsightRow` records for an owner."""
    owner = owner_for(actor_or_owner)
    actor = actor_for(owner)
    settings = get_settings()
    loader = kb_loader or CountryKBLoader(settings.kb_root, settings.active_kb_country_codes)
    now = datetime.now(UTC)
    today_val = today or now.date()

    candidates, _kb_ver = _compute_candidates(db, owner, loader, today_val)
    all_rows = list(
        db.scalars(
            select(ProtectionInsightRow)
            .where(owner_where(ProtectionInsightRow, actor))
            .order_by(ProtectionInsightRow.created_at.desc())
        )
    )

    by_exact: dict[tuple[str, str | None, str], ProtectionInsightRow] = {
        (r.rule_id, r.coverage_id, r.input_fingerprint): r for r in all_rows
    }
    open_rows = [r for r in all_rows if r.status == "OPEN"]
    active_keys: set[tuple[str, str | None, str]] = set()
    changed = False

    for cand in candidates:
        cov_str = str(cand.coverage_id) if cand.coverage_id else None
        key = (cand.rule_id, cov_str, cand.fingerprint)
        active_keys.add(key)

        # Supersede any OPEN rows for the same (rule_id, coverage_id) with an older fingerprint
        for open_r in open_rows:
            if (
                open_r.rule_id == cand.rule_id
                and open_r.coverage_id == cov_str
                and open_r.input_fingerprint != cand.fingerprint
                and open_r.status == "OPEN"
            ):
                open_r.status = "SUPERSEDED"
                open_r.resolved_at = now
                open_r.updated_at = now
                changed = True

        existing = by_exact.get(key)
        if existing is not None:
            # Respect user decisions (RESOLVED via dismiss or USER_CORRECTED) for the identical fingerprint
            if existing.status in ("RESOLVED", "USER_CORRECTED"):
                continue
            if existing.status == "SUPERSEDED":
                existing.status = "OPEN"
                existing.resolved_at = None
                existing.updated_at = now
                changed = True
            continue

        row = ProtectionInsightRow(
            **owner_values(actor),
            rule_id=cand.rule_id[:100],
            kind=cand.kind[:60],
            severity=cand.severity[:30],
            status="OPEN",
            coverage_id=cov_str,
            title=cand.title[:200],
            explanation=cand.explanation,
            facts=cand.facts,
            evidence_refs=cand.evidence_refs,
            next_actions=cand.next_actions,
            input_fingerprint=cand.fingerprint,
            kb_version=cand.kb_version[:20],
            created_at=now,
            updated_at=now,
            resolved_at=None,
        )
        db.add(row)
        by_exact[key] = row
        changed = True

    # Any previously OPEN row whose key is no longer active becomes RESOLVED
    for open_r in open_rows:
        key = (open_r.rule_id, open_r.coverage_id, open_r.input_fingerprint)
        if open_r.status == "OPEN" and key not in active_keys:
            open_r.status = "RESOLVED"
            open_r.resolved_at = now
            open_r.updated_at = now
            changed = True

    db.flush()

    if changed and candidates:
        batch_fp = _fingerprint({"keys": sorted(f"{k[0]}:{k[1]}:{k[2]}" for k in active_keys)})
        dispatch(
            db,
            owner,
            "coverage.assessment.completed",
            str(owner.id),
            {"status": "OK"},
            dedupe_key=f"coverage.assessment.completed:{batch_fp[:32]}",
            entity_type="insight",
        )

    return list_open_insights(db, owner)


def list_open_insights(db: Session, actor_or_owner) -> list[ProtectionInsight]:
    actor = actor_for(actor_or_owner)
    severity_rank = {"HIGH": 0, "NEEDS_VERIFICATION": 1, "NORMAL": 2}
    rows = list(
        db.scalars(
            select(ProtectionInsightRow).where(
                owner_where(ProtectionInsightRow, actor),
                ProtectionInsightRow.status == "OPEN",
            )
        )
    )
    rows.sort(
        key=lambda r: (
            severity_rank.get(r.severity, 9),
            -r.created_at.timestamp() if r.created_at else 0.0,
        )
    )
    return [_row_to_model(r) for r in rows]


def apply_insight_decision(
    db: Session,
    actor_or_owner,
    insight_id: UUID,
    decision: Literal["DISMISS", "CORRECT"],
    field_id: UUID | None = None,
) -> ProtectionInsight:
    owner = owner_for(actor_or_owner)
    actor = actor_for(owner)
    row = db.scalar(
        select(ProtectionInsightRow).where(
            ProtectionInsightRow.id == insight_id,
            owner_where(ProtectionInsightRow, actor),
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Protection insight not found.")

    now = datetime.now(UTC)
    if decision == "DISMISS":
        if row.severity == "HIGH":
            raise AppError(
                409,
                "INSIGHT_REQUIRES_RESOLUTION",
                "High-severity insights cannot be dismissed until the underlying issue is resolved or corrected.",
            )
        row.status = "RESOLVED"
        row.resolved_at = now
        row.updated_at = now
    else:
        row.status = "USER_CORRECTED"
        row.resolved_at = now
        row.updated_at = now
        if field_id is not None and owner.kind != DEMO:
            field_row = db.scalar(
                select(AccountFieldRow).where(
                    AccountFieldRow.id == field_id,
                    AccountFieldRow.account_id == owner.id,
                )
            )
            if field_row is None:
                raise AppError(404, "RESOURCE_NOT_FOUND", "Policy field not found.")
    db.flush()
    return _row_to_model(row)
