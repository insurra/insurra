"""Country-configured command center; no model-generated recommendations."""

from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select

from app.core.errors import AppError
from app.models import RecommendationStateRow
from app.schemas.common import RuleSource
from app.schemas.foundation import HomeSummary, Recommendation
from app.schemas.workspace import CoverageCard, EmergencyInfo, ServiceChoice, WorkspaceContext
from app.services.audit_logger import log_actor_event
from app.services.workspace import (
    FieldValue,
    coverages,
    grants,
    owner_filter,
    owner_values,
    profile,
)


def checked_official(country, item) -> bool:
    return bool(
        item.verification_status == "VERIFIED"
        and item.checked_at
        and item.source_url
        and urlparse(item.source_url).scheme == "https"
        and urlparse(item.source_url).hostname in country.manifest.official_source_hosts
    )


def emergency_info(country) -> EmergencyInfo:
    from app.services.safety_screen import get_verified_emergency_contacts

    resource = country.resources.emergency
    item = resource.data
    info = get_verified_emergency_contacts(country)
    if (
        checked_official(country, resource)
        and checked_official(country, item)
        and item.phone_number
    ):
        return EmergencyInfo(
            phone_number=item.phone_number,
            label=f"Emergency? Call {item.phone_number}",
            source_url=item.source_url,
            checked_at=item.checked_at,
            available=True,
            contacts=info.get("contacts", []),
        )
    return EmergencyInfo(contacts=info.get("contacts", []))


def local_day(p, country, now: datetime):
    warnings = []
    city_zone = country.manifest.city_timezones.get((p.city or "").casefold())
    allowed = set(country.manifest.city_timezones.values()) | {country.manifest.default_timezone}
    zone = p.timezone if p.timezone in allowed else city_zone or country.manifest.default_timezone
    if p.timezone and p.timezone != zone:
        warnings.append("Zona waktu profil berbeda dari konteks negara; periksa profil Anda.")
    try:
        today = now.astimezone(ZoneInfo(zone)).date()
    except ZoneInfoNotFoundError:
        zone, today = "UTC", now.astimezone(UTC).date()
        warnings.append("Zona waktu belum tersedia; tanggal memakai UTC.")
    return today, zone, warnings


def required_missing(c, p, country):
    task_codes = {t.task_code for t in country.resources.tasks.data if c.kind in t.policy_types}
    keys = [
        f.field_key
        for f in country.resources.required_fields.data
        if f.task_code in task_codes and f.applicable
    ]
    return any(
        not getattr(p, key, None)
        if key in {"arrival_date", "visa_expiry_date"}
        else c.fields.get(key, FieldValue()).status != "FOUND"
        for key in keys
    )


def summary(db, actor, kb, now=None) -> HomeSummary:
    now = now or datetime.now(UTC)
    p = profile(db, actor)
    country = kb.load(p.country_code)
    today, timezone, warnings = local_day(p, country, now)
    items = coverages(db, actor, kb)
    consent = grants(db, actor)
    cards = [
        CoverageCard(
            id=c.id,
            provider=c.provider,
            kind=c.kind,
            country_code=c.country_code,
            country_label=kb.load(c.country_code).manifest.label,
            start_date=c.start,
            end_date=c.end,
            active=c.active(today),
            expiring_30d=bool(c.active(today) and c.end and 0 <= (c.end - today).days <= 30),
            needs_verification=c.needs_check() or required_missing(c, p, kb.load(c.country_code)),
        )
        for c in items
    ]
    states = {
        (s.rule_id, s.subject): s
        for s in db.scalars(
            select(RecommendationStateRow).where(owner_filter(RecommendationStateRow, actor))
        )
    }
    recommendations = []
    for rule in sorted(
        country.resources.recommendation_rules.data, key=lambda r: (r.priority, r.rule_id)
    ):
        if rule.applicability.occupation and p.occupation not in rule.applicability.occupation:
            continue
        if (
            rule.applicability.residence_context
            and p.residence_context not in rule.applicability.residence_context
        ):
            continue
        if rule.regulatory and not checked_official(country, rule):
            warnings.append("Ada aturan yang belum memiliki sumber resmi terverifikasi.")
            continue
        trigger = rule.conditions.get("trigger")
        types = rule.conditions.get("policy_types", [])
        matching = [
            c for c in items if c.country_code == p.country_code and (not types or c.kind in types)
        ]
        subjects = []
        if trigger == "missing_coverage" and not matching:
            subjects = [("context", None, None)]
        elif trigger == "visa_gap":
            from app.services.coverage_matching import visa_assessment

            gap = visa_assessment(db, actor, kb, p, items)
            if gap.gap_days:
                subjects = [(str(c.id), c, gap.gap_days) for c in matching[:1]]
        else:
            for c in matching:
                card = next(v for v in cards if v.id == c.id)
                enabled = {
                    "missing_field": card.needs_verification,
                    "expiring": card.expiring_30d,
                    "membership_unknown": c.end is None and not c.open_ended_confirmed,
                    "injection": c.injection_flag,
                    "failed": c.processing_failed,
                }.get(trigger, False)
                if enabled:
                    subjects.append((str(c.id), c, None))
        for subject, c, gap_days in subjects:
            state = states.get((rule.rule_id, subject))
            if (
                state
                and state.dismissed_until
                and state.dismissed_until.replace(tzinfo=UTC) > now
                and not rule.visa_related
            ):
                continue
            replacements = {
                "gap_days": gap_days,
                "kind": c.kind if c else "",
                "coverage_id": str(c.id) if c else "",
            }
            try:
                title = rule.text_template.format_map(replacements)
                explanation = rule.explanation_template.format_map(replacements)
                url = rule.action_url.format_map(replacements)
            except (KeyError, ValueError):
                warnings.append("Template rekomendasi belum valid.")
                continue
            if not url.startswith(
                ("/documents", "/completeness?", "/settings/privacy", "/actions")
            ) or url.startswith("//"):
                continue
            recommendations.append(
                Recommendation(
                    rule_id=rule.rule_id,
                    title=title,
                    explanation=explanation,
                    priority=rule.priority,
                    subject=subject,
                    action_url=url,
                    dismissible=not rule.visa_related,
                    visa_related=rule.visa_related,
                    handled=bool(state and state.handled_at),
                    source=RuleSource(
                        country_code=p.country_code,
                        kb_version=country.manifest.version,
                        rule_id=rule.rule_id,
                        source_url=rule.source_url,
                        checked_at=rule.checked_at,
                        verification_status=rule.verification_status,
                    ),
                )
            )
    if not country.resources.recommendation_rules.data:
        warnings.append(
            "Aturan langkah berikutnya belum tersedia; ringkasan kosong bukan jaminan lengkap."
        )
    elapsed = (today - p.arrival_date).days if p.arrival_date else None
    red_flags = country.resources.red_flags

    from sqlalchemy import func

    from app.agent.insights import refresh_owner_insights
    from app.schemas.workspace import HomeActivityItem, HomeAttention
    from app.services.actor_scope import owner_for
    from app.workflow.models import WfActionRow, WfAuditLogRow, WfClaimCaseRow

    owner = owner_for(actor)
    try:
        from app.agent.protection_review import get_authorized_protection_assessment

        assessment = get_authorized_protection_assessment(db, owner)
        for f in assessment.findings:
            if f.coverage_status == "UNKNOWN" and "VERIFY_BENEFIT_SCHEDULE" in f.next_actions:
                rec_id = f"{p.country_code}_VERIFY_{f.need_type}"
                if not any(r.rule_id == rec_id for r in recommendations):
                    recommendations.append(
                        Recommendation(
                            rule_id=rec_id,
                            title=f"Verifikasi Ketentuan Manfaat: {f.need_type.replace('_', ' ').title()}",
                            explanation=f.reason
                            or "Ketentuan manfaat belum diverifikasi. Tinjau dokumen polis.",
                            priority=2,
                            subject="assessment_finding",
                            action_url="/documents",
                            dismissible=True,
                            action_type="VERIFY_BENEFIT_SCHEDULE",
                        )
                    )
    except Exception:  # noqa: BLE001
        pass
    try:
        open_insights = refresh_owner_insights(db, owner, kb_loader=kb, today=today)
    except Exception:  # noqa: BLE001
        open_insights = []

    open_claims = int(
        db.scalar(
            select(func.count())
            .select_from(WfClaimCaseRow)
            .where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.status.notin_(("APPROVED_IN_SANDBOX", "REJECTED_IN_SANDBOX")),
            )
        )
        or 0
    )
    claims_needing_evidence = int(
        db.scalar(
            select(func.count())
            .select_from(WfClaimCaseRow)
            .where(
                WfClaimCaseRow.owner_kind == owner.kind,
                WfClaimCaseRow.owner_id == owner.id,
                WfClaimCaseRow.status.in_(("NEEDS_EVIDENCE", "ADDITIONAL_INFO_REQUIRED")),
            )
        )
        or 0
    )
    pending_approvals = int(
        db.scalar(
            select(func.count())
            .select_from(WfActionRow)
            .where(
                WfActionRow.owner_kind == owner.kind,
                WfActionRow.owner_id == owner.id,
                WfActionRow.status.in_(("AWAITING_APPROVAL", "APPROVED")),
            )
        )
        or 0
    )
    expiring_count = sum(c.expiring_30d for c in cards)
    audit_rows = list(
        db.scalars(
            select(WfAuditLogRow)
            .where(
                WfAuditLogRow.owner_kind == owner.kind,
                WfAuditLogRow.owner_id == owner.id,
            )
            .order_by(WfAuditLogRow.created_at.desc(), WfAuditLogRow.id.desc())
            .limit(5)
        )
    )
    recent_activity = [
        HomeActivityItem(
            id=str(a.id),
            event_type=a.event_type,
            category=a.category,
            title=a.title,
            summary=a.summary,
            created_at=a.created_at,
            synthetic=bool(actor.session_id),
        )
        for a in audit_rows
    ]

    from app.services.action_prioritization import prioritize_home_actions
    from app.services.anti_lapse_agent import run_anti_lapse_agent

    anti_lapse_agent_status = run_anti_lapse_agent(
        db=db,
        owner=owner,
        actor=actor,
        profile_data=p,
        today=today,
    )

    prioritized_actions, assessment_summary, protection_areas, prioritized_activity = (
        prioritize_home_actions(
            db=db,
            actor=actor,
            owner=owner,
            profile_data=p,
            cards=cards,
            today=today,
            now=now,
            kb=kb,
            anti_lapse_agent=anti_lapse_agent_status,
        )
    )

    return HomeSummary(
        active=sum(c.active for c in cards),
        expiring_30d=expiring_count,
        needs_verification=sum(c.needs_verification for c in cards),
        recommendations=recommendations[:3],
        insights=open_insights[:3],
        attention=HomeAttention(
            open_claims=open_claims,
            claims_needing_evidence=claims_needing_evidence,
            pending_approvals=pending_approvals,
            expiring_policies=expiring_count,
        ),
        recent_activity=(prioritized_activity or recent_activity)[:3],
        context=WorkspaceContext(
            first_name=p.display_name.split()[0],
            country_code=p.country_code,
            country_label=country.manifest.label,
            city=p.city,
            occupation_label={"STUDENT": "Student", "EMPLOYEE": "Employee", "OTHER": "Other"}[
                p.occupation
            ],
            today=today,
            timezone=timezone,
            days_since_arrival=elapsed if elapsed is not None and elapsed >= 0 else None,
            arrival_date=p.arrival_date if p.residence_context == "ABROAD" else None,
            visa_expiry_date=p.visa_expiry_date if p.residence_context == "ABROAD" else None,
            synthetic=bool(actor.session_id),
            process_documents=consent.get("process_documents", False),
            external_ai=consent.get("external_ai", False),
            retention=consent.get("retention", False),
        ),
        coverages=cards,
        emergency=emergency_info(country),
        warnings=list(dict.fromkeys(warnings)),
        question_examples=country.resources.example_questions.data[:4],
        triage_available=bool(red_flags.data and checked_official(country, red_flags)),
        service_types=[
            ServiceChoice(code=s.code, label=s.label) for s in country.pathways.service_types
        ],
        pathway_help=country.pathways.help_text,
        prioritized_actions=prioritized_actions,
        assessment_summary=assessment_summary,
        protection_areas=protection_areas,
        anti_lapse_agent=anti_lapse_agent_status,
    )


def save_recommendation(db, actor, kb, body):
    current = summary(db, actor, kb)
    rec = next(
        (
            r
            for r in current.recommendations
            if r.rule_id == body.rule_id and r.subject == body.subject
        ),
        None,
    )
    if rec is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Rekomendasi tidak ditemukan.")
    if (body.decision == "dismiss" and not rec.dismissible) or (
        body.decision == "handled" and not body.confirmed
    ):
        raise AppError(
            422,
            "CONFIRMATION_REQUIRED",
            "Peringatan visa tidak dapat diabaikan; konfirmasi bila sudah diurus.",
        )
    row = db.scalar(
        select(RecommendationStateRow).where(
            owner_filter(RecommendationStateRow, actor),
            RecommendationStateRow.rule_id == body.rule_id,
            RecommendationStateRow.subject == body.subject,
        )
    )
    if row is None:
        row = RecommendationStateRow(
            **owner_values(actor), rule_id=body.rule_id, subject=body.subject
        )
        db.add(row)
    if body.decision == "dismiss":
        row.dismissed_until = datetime.now(UTC) + timedelta(days=7)
    else:
        row.handled_at = datetime.now(UTC)
    log_actor_event(db, actor, "ACTION_RECOMMENDATION", rule_id=body.rule_id)
    db.commit()
