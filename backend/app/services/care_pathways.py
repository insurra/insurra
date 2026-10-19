"""KB procedures and deterministic estimates; never medical triage or diagnosis."""

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from app.core.errors import AppError
from app.models import PathwayDecisionRow
from app.schemas.common import RuleSource
from app.schemas.foundation import (
    EmergencyRedirect,
    MoneyEstimate,
    PathwayComparison,
    PathwayOption,
)
from app.schemas.workspace import VerificationQuestion
from app.services.approval import payload_sha256
from app.services.audit_logger import log_actor_event
from app.services.benefits import amount, benefit_fields, financial_facts
from app.services.command_center import checked_official, local_day
from app.services.triage_adapter import triage_check
from app.services.workspace import FieldValue, coverages, owner_values, profile, require_grants

HOSPITAL_METADATA = {
    "CN_PKUIH": {
        "native_name": "北京大学国际医院",
        "distance_km": 1.2,
        "travel_time_min": 15,
        "language_support": "English available",
        "wait_time_estimate": "Approx. 30 min",
        "tier": "Class 3 (三级)",
        "image_url": "/assets/hospitals/pkuih.jpg",
        "provider_id": "cn-hosp-pkuih",
        "facility_address": "No. 1 Life Science Park Road, Zhongguancun Life Science Park, Changping District, Beijing",
        "facility_phone": "+86-10-69006999",
        "highlights": [
            "International department available",
            "Verify policy network before visit",
        ],
        "cautions": [],
    },
    "CN_UFH": {
        "native_name": "和睦家医疗",
        "distance_km": 3.5,
        "travel_time_min": 25,
        "language_support": "English available",
        "wait_time_estimate": "Approx. 20 min",
        "tier": "International Private",
        "image_url": "/assets/hospitals/ufh.jpg",
        "provider_id": "cn-hosp-bju",
        "facility_address": "No. 2 Jiangtai Road, Chaoyang District, Beijing",
        "facility_phone": "+86-10-59277000",
        "highlights": [
            "Bilingual clinical staff",
            "Check private-clinic coverage rules first",
        ],
        "cautions": [],
    },
    "CN_CHAOYANG": {
        "native_name": "北京朝阳医院",
        "distance_km": 6.8,
        "travel_time_min": 35,
        "language_support": "Chinese only",
        "wait_time_estimate": "Approx. 1 to 2 hours",
        "tier": "Class 3A (三甲)",
        "image_url": "/assets/hospitals/chaoyang.jpg",
        "provider_id": "cn-hosp-chaoyang",
        "facility_address": "No. 8 Workers' Stadium South Road, Chaoyang District, Beijing",
        "facility_phone": "+86-10-85231000",
        "highlights": [],
        "cautions": [
            "Upfront payment generally required",
            "Bring passport and request official medical fapiao",
        ],
    },
}


def generate_ai_guidance(country_code: str, complaint: str, service_type: str) -> str:
    text = (complaint or "").lower()
    if country_code == "CN":
        if any(w in text for w in ["gigi", "dental", "tooth", "teeth", "scaling"]):
            return (
                "For dental care in China, check whether outpatient dental treatment is included "
                "in your policy and confirm any deductible or clinic restrictions before booking."
            )
        if any(
            w in text
            for w in ["tenggorokan", "throat", "demam", "fever", "batuk", "cough", "flu", "pilek"]
        ):
            return (
                "For non-emergency respiratory or fever symptoms, review the outpatient hospital "
                "pathways below and verify network eligibility and required fapiao documentation."
            )
        if any(w in text for w in ["perut", "stomach", "mual", "vomit", "diare", "digestive"]):
            return (
                "For non-emergency digestive symptoms, compare the outpatient hospital options below "
                "and bring your passport and active insurance certificate."
            )
        if any(w in text for w in ["mental", "stres", "stress", "cemas", "anxiety", "konseling"]):
            return (
                "For mental health or counseling support, verify whether psychological services "
                "are covered under your outpatient benefits before scheduling."
            )
        if any(w in text for w in ["vaksin", "vaccin", "imunisasi"]):
            return (
                "For vaccination services, confirm vaccine availability at the clinic and check "
                "whether preventive immunizations are covered by your plan."
            )
        return (
            "Below are KB-curated care pathways for your jurisdiction. Costs, network status, "
            "and direct billing remain unverified unless confirmed in your policy documents."
        )
    return (
        "Care pathway options are matched against your jurisdiction and active coverage context. "
        "Review the required documents and verification steps before visiting a facility."
    )


def context_fingerprint(p, country, items):
    """Bind a choice to current profile, policy evidence and KB, without retaining symptoms."""
    return payload_sha256(
        {
            "profile": p.model_dump(mode="json"),
            "kb": country.model_dump(mode="json"),
            "coverages": [
                {
                    "id": str(c.id),
                    "country": c.country_code,
                    "kind": c.kind,
                    "start": str(c.start),
                    "end": str(c.end),
                    "verified": c.verified,
                    "injection": c.injection_flag,
                    "failed": c.processing_failed,
                    "fields": {
                        k: [f.value, f.status, f.confirmed, str(f.document_id), f.page]
                        for k, f in c.fields.items()
                    },
                }
                for c in items
            ],
        }
    )


def source(country, config):
    return RuleSource(
        country_code=country.manifest.country_code,
        kb_version=country.manifest.version,
        rule_id=config.pathway_code,
        source_url=config.source_url,
        checked_at=config.checked_at,
        verification_status=config.verification_status,
    )


def known(field, values=None):
    return (
        field.status == "FOUND"
        and field.value is not None
        and (values is None or str(field.value).casefold() in {v.casefold() for v in values})
    )


def unresolved(country, config, coverage):
    output = []
    for code in config.verification_codes:
        entry = next((e for e in country.resources.verification_steps.data if e.code == code), None)
        if not entry or not entry.field_key:
            output.append(
                VerificationQuestion(
                    code=code, label="Panduan verifikasi belum tersedia dalam KB.", steps=[]
                )
            )
            continue
        key = entry.field_key.format(category=config.benefit_category)
        field = coverage.fields.get(key, FieldValue()) if coverage else FieldValue()
        if not known(field, entry.known_values or None):
            output.append(
                VerificationQuestion(
                    code=code, label=entry.label, steps=entry.steps, impact=entry.impact
                )
            )
    return output


def estimate(country, config, coverage, today, actor, uncertainties):
    """Only a fully evidenced, same-currency reference tariff can produce money."""
    tariff = config.tariff
    if (
        not tariff
        or not coverage
        or uncertainties
        or not checked_official(country, tariff)
        or tariff.checked_at > today
        or (tariff.synthetic and not actor.session_id)
    ):
        return None
    fields = benefit_fields(coverage).get(config.benefit_category, {})
    fact = next(
        (f for f in financial_facts(coverage, today) if f.category == config.benefit_category), None
    )
    if (
        not fact
        or fact.label != "FROM_DOCUMENT"
        or fact.remaining is None
        or fact.currency != tariff.currency
        or not all(
            known(fields.get(k, FieldValue()))
            for k in ("excess", "coverage_rate", "claim_mode", "network_only", "requires_referral")
        )
        or not known(fields.get("coverage_status", FieldValue()), ["COVERED"])
    ):
        return None
    network_only = fields["network_only"].value
    referral_required = fields["requires_referral"].value
    if (
        type(network_only) is not bool
        or type(referral_required) is not bool
        or (
            network_only
            and not known(
                coverage.fields.get("provider_network_status", FieldValue()), ["in_network"]
            )
        )
        or (
            referral_required
            and not known(coverage.fields.get("referral_status", FieldValue()), ["available"])
        )
    ):
        return None
    excess = amount(fields["excess"])
    rate = amount(fields["coverage_rate"])
    if excess is None or rate is None or rate > 1:
        return None
    low, high = Decimal(tariff.minimum), Decimal(tariff.maximum)
    if high < low:
        return None

    def personal(price):
        paid = min(max(price - excess, Decimal(0)) * rate, Decimal(fact.remaining))
        return format(max(price - paid, Decimal(0)).quantize(Decimal("0.01"), ROUND_HALF_UP), "f")

    return MoneyEstimate(
        minimum=personal(low),
        maximum=personal(high),
        currency=tariff.currency,
        synthetic=tariff.synthetic,
        source_reference=RuleSource(
            country_code=country.manifest.country_code,
            kb_version=country.manifest.version,
            rule_id=config.pathway_code + ":tariff",
            source_url=tariff.source_url,
            checked_at=tariff.checked_at,
            verification_status=tariff.verification_status,
        ),
    )


def compare(db, actor, kb, body, now=None):
    require_grants(db, actor)
    p = profile(db, actor)
    country = kb.load(p.country_code)
    safety = triage_check(country, body.complaint)
    if safety.red_flag:
        hit = safety.matched[0]
        log_actor_event(
            db,
            actor,
            "GUARDRAIL",
            subtype="red_flag",
            red_flag_id=hit.id,
            kb_version=hit.kb_version,
        )
        db.commit()
        return EmergencyRedirect(redirect="emergency")
    if body.service_type not in {s.code for s in country.pathways.service_types}:
        raise AppError(422, "SERVICE_NOT_AVAILABLE", "Pilih jenis layanan dari basis pengetahuan.")
    configs = [c for c in country.pathways.pathways if body.service_type in c.service_types][:5]
    if len(configs) < 2 or any(len(c.steps) < 3 for c in configs if not c.emergency):
        raise AppError(503, "PATHWAYS_UNAVAILABLE", "Panduan jalur negara ini belum lengkap.")
    now = now or datetime.now(UTC)
    today, _, _ = local_day(p, country, now)
    items = coverages(db, actor, kb)
    paths, questions = [], {}
    for config in configs:
        coverage = next(
            (
                c
                for c in items
                if c.country_code == p.country_code
                and c.kind in config.policy_types
                and c.active(today)
                and not c.needs_check()
            ),
            None,
        )
        unknown = unresolved(country, config, coverage)
        for entry in unknown:
            questions.setdefault(entry.code, entry)
        cost = (
            None if config.emergency else estimate(country, config, coverage, today, actor, unknown)
        )
        if not cost and not config.emergency:
            entry = next(
                (e for e in country.resources.verification_steps.data if e.code == "cost"), None
            )
            questions.setdefault(
                "cost",
                VerificationQuestion(
                    code="cost",
                    label=entry.label if entry else "Out-of-pocket cost is not yet verified.",
                    steps=entry.steps if entry else [],
                    impact=entry.impact if entry else None,
                ),
            )
        fields = benefit_fields(coverage).get(config.benefit_category, {}) if coverage else {}
        mode = fields.get("claim_mode", FieldValue())
        net = (
            coverage.fields.get("provider_network_status", FieldValue())
            if coverage
            else FieldValue()
        )
        meta = HOSPITAL_METADATA.get(config.pathway_code, {})
        paths.append(
            PathwayOption(
                pathway_code=config.pathway_code,
                name=config.label,
                description=config.description,
                coverage_id=coverage.id if coverage and not config.emergency else None,
                coverage_label=f"{coverage.kind} · {coverage.provider or 'provider not specified'}"
                if coverage
                else None,
                coverage_status="MATCHED" if coverage else "NEEDS_CHECK",
                steps=config.steps,
                requirements=config.requirements,
                est_out_of_pocket=cost,
                docs=config.required_documents,
                uncertainties=[q.label for q in unknown]
                + config.uncertainties
                + (
                    [
                        "Matching active coverage has not yet been confirmed; "
                        "this is not a benefit denial."
                    ]
                    if not coverage
                    else []
                ),
                sources=[source(country, config)],
                emergency=config.emergency,
                direct_billing=(mode.value == "DIRECT_BILLING")
                if known(mode, ["DIRECT_BILLING", "REIMBURSEMENT"])
                else None,
                native_name=meta.get("native_name"),
                distance_km=meta.get("distance_km"),
                travel_time_min=meta.get("travel_time_min"),
                language_support=meta.get("language_support"),
                wait_time_estimate=meta.get("wait_time_estimate"),
                tier=meta.get("tier"),
                image_url=meta.get("image_url"),
                in_network=(str(net.value).casefold() == "in_network")
                if known(net, ["in_network", "out_of_network"])
                else None,
                provider_id=meta.get("provider_id"),
                facility_address=meta.get("facility_address"),
                facility_phone=meta.get("facility_phone"),
                highlights=meta.get("highlights", []),
                cautions=meta.get("cautions", []),
            )
        )
    for rule in country.pathways.priority_rules:
        eligible = [c for c in paths if c.est_out_of_pocket and not c.emergency]
        if (
            set(rule.codes).intersection(p.priorities)
            and len(eligible) == len([c for c in paths if not c.emergency])
            and len({c.est_out_of_pocket.currency for c in eligible}) == 1
        ):
            chosen = min(
                eligible,
                key=lambda c: (
                    Decimal(c.est_out_of_pocket.maximum),
                    Decimal(c.est_out_of_pocket.minimum),
                    c.pathway_code,
                ),
            )
            chosen.best_for_priority = True
            chosen.priority_reason = rule.explanation
            break
    fingerprint = context_fingerprint(p, country, items)
    decision = PathwayDecisionRow(
        **owner_values(actor),
        country_code=p.country_code,
        options=[
            {
                "path": c.pathway_code,
                "coverage_id": str(c.coverage_id) if c.coverage_id else None,
                "emergency": c.emergency,
                "fingerprint": fingerprint,
            }
            for c in paths
        ],
        created_at=now,
    )
    db.add(decision)
    log_actor_event(db, actor, "COMPARE", subtype="pathways", match_count=len(paths))
    db.commit()
    ai_guide = generate_ai_guidance(p.country_code, body.complaint, body.service_type)
    return PathwayComparison(
        paths=paths,
        comparison_id=decision.id,
        context_country_code=p.country_code,
        uncertainties=list(questions.values())[:5],
        warnings=[
            "Procedure comparison only, not a medical diagnosis or payment guarantee.",
            "Verify provider network status and policy terms before treatment.",
        ],
        ai_guidance=ai_guide,
        inferred_need=body.service_type,
    )
