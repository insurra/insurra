"""Payload regressions from PRD fields; route presence alone cannot prove conformance."""

import copy
from datetime import date

import pytest

from app.main import app
from app.schemas.common import VerificationStatus


# These field lists are independently transcribed from the API CSV, including nested objects.
@pytest.mark.parametrize(
    "name,fields",
    [
        ("PurposeConsentUpdate", "purpose granted"),
        ("PurposeConsent", "purpose granted"),
        (
            "ProfileUpdate",
            "employment_status dependents city owned_coverage priorities budget_range",
        ),
        ("ProfileResponse", "profile suggested_docs"),
        ("DocumentUploadAccepted", "document_id status"),
        ("DocumentDetail", "status kind injection_flag fields"),
        ("FieldReviewRequest", "value confirm"),
        (
            "ReviewedField",
            "field_key value previous_value source_page confidence confirmed_by_user",
        ),
        ("CompletenessReport", "ready_pct items"),
        ("CompletenessCheckItem", "field_key status suggested_doc"),
        ("DeleteConfirmation", "confirm"),
        ("DeletionResult", "deleted"),
        ("HomeSummary", "active expiring_30d needs_verification recommendations"),
        ("AskRequest", "question"),
        ("AskAnswer", "answer_points"),
        ("AnswerPoint", "text label citations"),
        ("AnswerCitation", "doc page quote"),
        ("EmergencyRedirect", "redirect"),
        ("PathwayComparisonRequest", "complaint service_type city"),
        ("PathwayComparison", "paths"),
        ("PathwayOption", "name steps requirements est_out_of_pocket docs uncertainties sources"),
        ("ClaimCaseCreate", "path coverage_id"),
        ("ClaimCaseCreated", "claim_case_id"),
        ("TriageRequest", "text"),
        ("TriageResult", "red_flag matched"),
        ("ClaimCaseDetail", "case checklist"),
        ("CaseChecklistItem", "item_key required rule_source status"),
        ("EvidenceMatchResult", "matched_items"),
        ("ClaimDraftAction", "action_id status"),
        ("ActionDecisionRequest", "edited_payload reason"),
        ("ActionDecisionResult", "status"),
    ],
)
def test_prd_payload_fields(name, fields):
    properties = app.openapi()["components"]["schemas"][name]["properties"]
    assert set(fields.split()) <= properties.keys()


def test_nested_shapes_optionality_literals_and_limits():
    schemas = app.openapi()["components"]["schemas"]

    def item_ref(name, field, target):
        assert schemas[name]["properties"][field]["items"] == {
            "$ref": f"#/components/schemas/{target}"
        }

    for name, field, target in [
        ("ProfileResponse", "suggested_docs", "SuggestedDocument"),
        ("DocumentDetail", "fields", "ReviewedField"),
        ("CompletenessReport", "items", "CompletenessCheckItem"),
        ("AskAnswer", "answer_points", "AnswerPoint"),
        ("AnswerPoint", "citations", "AnswerCitation"),
        ("PathwayComparison", "paths", "PathwayOption"),
        ("ClaimCasePage", "items", "ClaimCaseDetail"),
        ("ClaimCaseDetail", "checklist", "CaseChecklistItem"),
        ("EvidenceMatchResult", "matched_items", "CaseChecklistItem"),
    ]:
        item_ref(name, field, target)
    assert schemas["ProfileResponse"]["required"] == ["profile", "suggested_docs"]
    assert not schemas["ProfileUpdate"].get("required")
    for field in ("display_name", "country_code", "occupation", "residence_context"):
        prop = schemas["ProfileUpdate"]["properties"][field]
        assert "anyOf" not in prop and prop.get("type") != "null" and "default" not in prop
    assert schemas["FieldReviewRequest"]["required"] == ["confirm"]
    assert schemas["FieldReviewRequest"]["properties"]["confirm"]["const"] is True
    assert schemas["DeleteConfirmation"]["properties"]["confirm"]["const"] == "HAPUS"
    assert schemas["DeletionResult"]["properties"]["deleted"]["const"] is True
    assert schemas["ClaimDraftAction"]["properties"]["status"]["const"] == "pending"
    assert schemas["EmergencyRedirect"]["properties"]["redirect"]["const"] == "emergency"
    assert set(schemas["ActionDecisionResult"]["properties"]) == {"status"}
    for name, field, maximum in [
        ("AskAnswer", "answer_points", 5),
        ("HomeSummary", "recommendations", 3),
        ("ProfileResponse", "suggested_docs", 6),
    ]:
        assert schemas[name]["properties"][field]["maxItems"] == maximum
    for name, field, maximum in [
        ("AskRequest", "question", 500),
        ("PathwayComparisonRequest", "complaint", 300),
    ]:
        assert schemas[name]["properties"][field]["maxLength"] == maximum
    assert schemas["AskStreamEvent"]["discriminator"]["propertyName"] == "event"


@pytest.mark.parametrize(
    "value,confidence,confirmed,evidence,valid",
    [
        (None, 0.9, True, True, False),
        ("synthetic", 0.79, False, True, False),
        ("synthetic", None, False, True, False),
        ("synthetic", 0.8, False, False, False),
        ("synthetic", 0.8, False, True, True),
        ("synthetic", 0.1, True, False, True),
    ],
)
def test_reviewed_field_found_needs_value_and_evidence_or_confirmation(
    value, confidence, confirmed, evidence, valid
):
    from datetime import UTC, datetime
    from uuid import uuid4

    from pydantic import ValidationError

    from app.schemas.foundation import FieldReviewRequest, ReviewedField

    document_id = uuid4()
    payload = {
        "id": uuid4(),
        "document_id": document_id,
        "field_key": "synthetic",
        "value": value,
        "confidence": confidence,
        "confirmed_by_user": confirmed,
        "status": "FOUND",
        "updated_at": datetime.now(UTC),
        "source_evidence": {
            "document_id": document_id,
            "page_number": 1,
            "original_text": "Synthetic",
        }
        if evidence
        else None,
    }
    if valid:
        assert ReviewedField.model_validate(payload).status == "FOUND"
    else:
        with pytest.raises(ValidationError):
            ReviewedField.model_validate(payload)
    assert FieldReviewRequest(confirm=True).model_fields_set == {"confirm"}
    assert FieldReviewRequest(confirm=True, value=None).model_fields_set == {"confirm", "value"}


def test_profile_prd_update_wrapper_and_legacy_get(client, demo):
    _, headers = demo()
    before = client.get("/api/v1/profile", headers=headers).json()
    body = {
        "employment_status": "synthetic",
        "dependents": ["synthetic"],
        "city": "Synthetic",
        "owned_coverage": ["synthetic"],
        "priorities": ["synthetic"],
        "budget_range": "unknown",
    }
    result = client.put("/api/v1/profile", headers=headers, json=body)
    assert result.status_code == 200, result.text
    updated = result.json()
    assert set(updated) == {"profile", "suggested_docs"}
    assert updated["suggested_docs"] == []  # AU's KB remains intentionally unverified.
    assert all(updated["profile"][key] == value for key, value in body.items())
    for key in (
        "id",
        "display_name",
        "country_code",
        "arrival_date",
        "visa_expiry_date",
        "occupation",
    ):
        assert updated["profile"][key] == before[key]
    assert client.get("/api/v1/profile", headers=headers).json() == updated["profile"]
    # Original full update bodies still work, without resetting metadata on later partial updates.
    legacy = {k: v for k, v in before.items() if k not in {"id", "created_at", "updated_at"}}
    legacy["timezone"] = "Asia/Jakarta"
    assert client.put("/api/v1/profile", headers=headers, json=legacy).status_code == 200
    partial = client.put("/api/v1/profile", headers=headers, json={"city": None}).json()["profile"]
    assert partial["city"] is None and partial["timezone"] == "Asia/Jakarta"


@pytest.mark.parametrize(
    "field", ["display_name", "country_code", "occupation", "residence_context"]
)
def test_profile_rejects_cleared_core_fields_without_persistence(client, demo, field):
    _, headers = demo()
    before = client.get("/api/v1/profile", headers=headers).json()
    response = client.put("/api/v1/profile", headers=headers, json={field: None})
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert client.get("/api/v1/profile", headers=headers).json() == before


def test_profile_merged_date_validation_is_safe_and_atomic(client, demo):
    _, headers = demo()
    before = client.get("/api/v1/profile", headers=headers).json()
    response = client.put(
        "/api/v1/profile", headers=headers, json={"visa_expiry_date": "1900-01-01"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert "1900-01-01" not in response.text
    assert client.get("/api/v1/profile", headers=headers).json() == before


def test_profile_suggestions_only_project_checked_country_kb(client, app, demo, monkeypatch):
    _, headers = demo()
    loader = app.state.kb_loader
    original = loader.load
    country = copy.deepcopy(original("CN"))
    # Synthetic in-memory fixture; repository KB facts remain empty and unverified.
    from app.schemas.kb import SuggestedDocument

    country.resources.suggested_docs.data = [
        SuggestedDocument(
            document_type="synthetic", label="Synthetic", requirement_level="RECOMMENDED"
        )
    ]
    monkeypatch.setattr(loader, "load", lambda code: country if code == "CN" else original(code))
    assert client.put("/api/v1/profile", headers=headers, json={}).json()["suggested_docs"] == []
    country.resources.suggested_docs.verification_status = VerificationStatus.VERIFIED
    country.resources.suggested_docs.source_url = "https://synthetic.example.test/source"
    country.resources.suggested_docs.checked_at = date(2026, 1, 1)
    assert client.put("/api/v1/profile", headers=headers, json={}).json()["suggested_docs"] == [
        country.resources.suggested_docs.data[0].model_dump(mode="json")
    ]
