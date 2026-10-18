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
    resource = country.resources.emergency
    item = resource.data
    if (
        checked_official(country, resource)
        and checked_official(country, item)
        and item.phone_number
    ):
        return EmergencyInfo(
            phone_number=item.phone_number,
            label=f"Darurat? Hubungi {item.phone_number}",
            source_url=item.source_url,
            checked_at=item.checked_at,
            available=True,
        )
    return EmergencyInfo()


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
    return HomeSummary(
        active=sum(c.active for c in cards),
        expiring_30d=sum(c.expiring_30d for c in cards),
        needs_verification=sum(c.needs_verification for c in cards),
        recommendations=recommendations[:3],
        context=WorkspaceContext(
            first_name=p.display_name.split()[0],
            country_code=p.country_code,
            country_label=country.manifest.label,
            city=p.city,
            occupation_label={"STUDENT": "Pelajar", "EMPLOYEE": "Pekerja", "OTHER": "Lainnya"}[
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
