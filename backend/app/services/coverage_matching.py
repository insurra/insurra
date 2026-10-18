"""Shared coverage matching, including the original visa assessment service."""

from datetime import UTC, datetime

from app.repositories.session_data import insurance_row
from app.schemas.insurance import InsurancePolicy, UnifiedInsuranceRecord
from app.services.rules_engine import RulesEngine


def applies(config, p):
    return (
        (not config.occupation or p.occupation in config.occupation)
        and (not config.residence_context or p.residence_context in config.residence_context)
        and (config.has_dependents is None or bool(p.dependents) == config.has_dependents)
        and (
            config.requires_visa_context is None
            or bool(p.visa_expiry_date) == config.requires_visa_context
        )
    )


def match_needs(db, actor, kb, *, destination=None, context_profile=None, now=None):
    from app.schemas.assessment import CoverageNeed
    from app.schemas.common import RuleSource
    from app.services.audit_logger import log_actor_event
    from app.services.benefits import benefit_fields
    from app.services.command_center import checked_official, local_day
    from app.services.evidence import supports_exclusion, validated_quote
    from app.services.workspace import coverages, profile

    p = context_profile or profile(db, actor)
    country = kb.load(destination or p.country_code)
    today, _, _ = local_day(p, country, now or datetime.now(UTC))
    items = coverages(db, actor, kb)
    result = []
    visa = visa_assessment(db, actor, kb, p, items)
    for need in country.coverage_needs:
        if not applies(need.applicability, p):
            continue
        official = checked_official(country, need)
        candidates = [
            c
            for c in items
            if c.country_code == country.manifest.country_code
            and (
                c.kind in need.policy_types
                or any(k in need.benefit_categories for k in benefit_fields(c))
            )
        ]
        status = "NOT_OWNED"
        exclusion = None
        reason = (
            "Kategori ini tidak ditemukan di dokumen yang kamu unggah. "
            "Ini bukan bukti pengecualian."
        )
        owned = [c for c in candidates if c.active(today) and c.verified]
        if need.benefit_categories:
            owned = [
                c
                for c in owned
                if any(
                    category in need.benefit_categories
                    and fields.get("coverage_status") is not None
                    and fields["coverage_status"].status == "FOUND"
                    and fields["coverage_status"].value == "COVERED"
                    for category, fields in benefit_fields(c).items()
                )
            ]
        if owned:
            c = owned[0]
            status = "OWNED"
            reason = (
                f"Ditemukan: {c.provider or 'penyedia belum diisi'}, "
                f"berlaku {c.start or 'status aktif dikonfirmasi'} "
                f"s.d. {c.end or 'tanpa tanggal akhir'}."
            )
        elif candidates:
            status = "NEEDS_CHECK"
            reason = (
                "Data inti belum terverifikasi, belum aktif, sudah berakhir, "
                "atau manfaat belum dapat dipastikan."
            )
            for c in candidates:
                for category, fields in benefit_fields(c).items():
                    negative = fields.get("coverage_status")
                    quote = fields.get("exclusion_quote")
                    if (
                        category in need.benefit_categories
                        and negative
                        and quote
                        and negative.status == quote.status == "FOUND"
                        and negative.value == "NOT_COVERED"
                        and supports_exclusion(str(quote.value), need.benefit_categories)
                    ):
                        exclusion = validated_quote(
                            db, actor, c, quote.document_id, quote.page, str(quote.value)
                        )
                        if exclusion:
                            status = "NOT_OWNED"
                            reason = (
                                "Dikecualikan sesuai kutipan dokumen. "
                                "Konfirmasi penerapan kepada penyedia."
                            )
        elif any(
            not c.processing_complete
            or c.kind not in {v.code for v in country.resources.coverage_types.data}
            for c in items
            if c.country_code == country.manifest.country_code
        ):
            status = "NEEDS_CHECK"
            reason = (
                "Ada dokumen yang belum dapat diklasifikasikan; "
                "periksa sebelum menyimpulkan kepemilikan."
            )
        level = need.requirement_level
        if level == "REQUIRED" and not official:
            level = "RECOMMENDED"
            reason = "Kewajiban perlu konfirmasi sumber resmi. " + reason
        action_url = "/policies" if status == "OWNED" and actor.account_id else "/documents"
        if status == "NEEDS_CHECK":
            action_url = "/completeness" if actor.account_id else "/documents"
        gap = (
            visa
            if need.task_code == "visa_cover" and country.manifest.country_code == p.country_code
            else None
        )
        result.append(
            CoverageNeed(
                need_code=need.need_code,
                label=need.label,
                requirement_level=level,
                requirement_confirmed=official,
                ownership_status=status,
                explanation=need.explanation + " " + reason,
                source_reference=RuleSource(
                    country_code=country.manifest.country_code,
                    kb_version=country.manifest.version,
                    rule_id=need.need_code,
                    source_url=need.source_url,
                    checked_at=need.checked_at,
                    verification_status=need.verification_status,
                ),
                coverage_ids=[c.id for c in candidates],
                verification_steps=need.verification_steps,
                action_url=action_url,
                visa_assessment=gap,
                exclusion=exclusion,
            )
        )
    log_actor_event(db, actor, "COMPARE_COVERAGE_NEEDS", match_count=len(result))
    db.commit()
    return result


def visa_assessment(db, actor, kb, p, items):
    if actor.session_id:
        record = UnifiedInsuranceRecord.model_validate(insurance_row(db, actor.session_id).payload)
    else:
        policies = []
        for c in items:
            if c.country_code != p.country_code:
                continue
            valid = c.verified and c.start and c.end and c.start <= c.end
            policies.append(
                InsurancePolicy(
                    id=c.id,
                    provider_name=c.provider,
                    policy_type=c.kind,
                    coverage_start_date=c.start if valid else None,
                    coverage_end_date=c.end if valid else None,
                    coverage_items=[],
                    source_document_ids=c.document_ids,
                    verification_status="VERIFIED" if c.verified else "UNVERIFIED",
                )
            )
        record = UnifiedInsuranceRecord(
            id=p.id,
            profile_id=p.id,
            country_code=p.country_code,
            policies=policies,
            documents=[],
            updated_at=datetime.now(UTC),
        )
    return RulesEngine(kb).assess_visa_coverage(p, record)
