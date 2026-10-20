import json
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.config import ROOT, Settings
from app.core.errors import AppError
from app.schemas.action import ProposedAction
from app.schemas.document import ExtractedField, SourceEvidence
from app.schemas.insurance import CoverageItem, InsurancePolicy, UnifiedInsuranceRecord
from app.schemas.profile import UserProfile
from app.services.kb_loader import CountryKBLoader
from app.services.policy_guard import PolicyGuard
from app.services.rules_engine import RulesEngine


@pytest.fixture
def inputs():
    return (
        UserProfile.model_validate_json((ROOT / "fixtures/raka/profile.json").read_text()),
        UnifiedInsuranceRecord.model_validate_json(
            (ROOT / "fixtures/raka/insurance_record.json").read_text()
        ),
    )


@pytest.mark.parametrize("country", ["AU", "CN", "ID"])
def test_kb_parses_all_resources(country):
    kb = CountryKBLoader(ROOT / "kb").load(country)
    assert kb.manifest.country_code == country
    assert kb.coverage_needs and kb.pathways.pathways and kb.glossary
    assert kb.manifest.checked_at is None


@pytest.mark.parametrize("code", ["../AU", "au", "ZZ", "AU/../ID"])
def test_kb_path_validation(code):
    with pytest.raises(AppError) as exc:
        CountryKBLoader(ROOT / "kb").load(code)
    assert exc.value.code == "UNSUPPORTED_COUNTRY"


@pytest.mark.parametrize(
    "field", ["coverage_end_date", "coverage_start_date", "visa_expiry_date", "arrival_date"]
)
def test_missing_dates(inputs, field):
    profile, record = inputs
    if field.startswith("coverage"):
        setattr(record.policies[0], field, None)
    elif field == "visa_expiry_date":
        # Study and permit end dates mirror the end date, so all of them are removed.
        profile.visa_expiry_date = profile.permit_end_date = profile.study_end_date = None
    else:
        profile.arrival_date = profile.study_start_date = None
    result = RulesEngine(CountryKBLoader(ROOT / "kb")).assess_visa_coverage(profile, record)
    assert result.assessment_status == "UNABLE_TO_DETERMINE" and result.gap_days is None


def test_invalid_ranges_and_money(inputs):
    _, record = inputs
    policy = record.policies[0].model_dump(mode="json")
    with pytest.raises(ValidationError):
        InsurancePolicy.model_validate({**policy, "coverage_end_date": "2020-01-01"})
    with pytest.raises(ValidationError):
        CoverageItem(
            coverage_code="X", benefit_name="X", coverage_status="UNKNOWN", limit_amount=0.1
        )
    assert (
        CoverageItem(
            coverage_code="X", benefit_name="X", coverage_status="UNKNOWN", limit_amount="100.50"
        ).limit_amount
        == "100.50"
    )


@pytest.mark.parametrize(
    "end,expected", [("2027-06-30", 0), ("2028-01-01", 0), ("2026-09-01", 302)]
)
def test_no_negative_and_inclusive_gap(inputs, end, expected):
    p, r = inputs
    r.policies[0].coverage_end_date = date.fromisoformat(end)
    result = RulesEngine(CountryKBLoader(ROOT / "kb")).assess_visa_coverage(p, r)
    assert result.gap_days == expected and result.gap_days >= 0


def test_overlapping_and_disjoint_policies(inputs):
    p, r = inputs
    r.policies[0].coverage_end_date = date(2027, 4, 15)
    extra = r.policies[0].model_copy(deep=True)
    extra.id = uuid4()
    extra.coverage_start_date = date(2027, 4, 10)
    extra.coverage_end_date = date(2027, 6, 30)
    r.policies.append(extra)
    engine = RulesEngine(CountryKBLoader(ROOT / "kb"))
    assert engine.assess_visa_coverage(p, r).gap_days == 0
    extra.coverage_start_date = date(2027, 5, 1)
    assert engine.assess_visa_coverage(p, r).gap_days == 15


@pytest.mark.parametrize(
    "evidence_class,status",
    [("MANUALLY_CURATED", "NEEDS_VERIFICATION"), (None, "DATE_DIFFERENCE_DETECTED")],
)
def test_new_country_requires_only_configuration(tmp_path, inputs, evidence_class, status):
    import shutil

    shutil.copytree(ROOT / "kb/CN", tmp_path / "XY")
    manifest_path = tmp_path / "XY/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["country_code"] = "XY"
    manifest_path.write_text(json.dumps(manifest))
    rules_path = tmp_path / "XY/rules.json"
    rules = json.loads(rules_path.read_text())
    rules["data"][0]["evidence_class"] = evidence_class
    rules_path.write_text(json.dumps(rules))
    p, r = inputs
    p.country_code = r.country_code = "XY"
    result = RulesEngine(CountryKBLoader(tmp_path)).assess_visa_coverage(p, r)
    assert result.gap_days == 76
    assert result.assessment_status == status
    assert result.requirement_status == "NEEDS_VERIFICATION"
    assert result.rule_source.verification_status == "UNVERIFIED"
    assert result.rule_source.source_url is None


def test_extraction_confidence_is_conservative():
    field = ExtractedField(field_name="provider", value="Synthetic", confidence=0.7, status="FOUND")
    assert field.status == "UNVERIFIED"
    assert (
        ExtractedField(field_name="benefit", value=None, confidence=None, status="MISSING").status
        == "MISSING"
    )


def test_guard_evidence_approval_and_redaction():
    guard = PolicyGuard()
    a, b = uuid4(), uuid4()
    with pytest.raises(AppError, match="Data bukan"):
        guard.validate_session_access(a, b)
    evidence = SourceEvidence(document_id=a, original_text="SYNTHETIC")
    with pytest.raises(AppError):
        guard.validate_evidence_reference(evidence, {b}, "SYNTHETIC")
    with pytest.raises(AppError):
        guard.validate_evidence_reference(evidence, {a})
    guard.validate_evidence_reference(evidence, {a}, "SYNTHETIC placeholder")
    action = ProposedAction(
        id=a,
        action_type="DRAFT",
        status="PENDING",
        preview="Synthetic",
        created_at=datetime.now(UTC),
    )
    with pytest.raises(AppError):
        guard.validate_action_approval(action)
    action.status = "APPROVED"
    with pytest.raises(AppError):
        guard.validate_action_approval(action)
    action.approved_at = datetime.now(UTC)
    guard.validate_action_approval(action)
    assert guard.redact_audit_metadata(
        {
            "session_token": "secret",
            "original_text": "private",
            "processing_consent": False,
            "feature": {"secret": "nested"},
        }
    ) == {"processing_consent": False}


def test_wildcard_cors_rejected():
    with pytest.raises(ValidationError):
        Settings(frontend_origin="*")
