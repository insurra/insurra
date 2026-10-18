"""Shared coverage matching, including the original visa assessment service."""

from datetime import UTC, datetime

from app.repositories.session_data import insurance_row
from app.schemas.insurance import InsurancePolicy, UnifiedInsuranceRecord
from app.services.rules_engine import RulesEngine


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
