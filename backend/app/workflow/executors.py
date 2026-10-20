"""Server-built action payload builders and deterministic manual-handoff/internal executors.

Every action payload is constructed on the server from owned coverages, claims, and allow-listed
text fields. No executor ever sends data to a real external insurer.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.workflow import claims, kbdata, servicing
from app.workflow.models import WfActionRow, WfClaimCaseRow
from app.workflow.owner import Owner, owner_policies, owner_policy

ALLOWED_DRAFT_KEYS = {
    "subject",
    "body",
    "title",
    "detail",
    "due_date",
    "request_type",
    "reason",
    "field_to_correct",
    "new_value",
    "benefit_query",
    "query_details",
    "policy_reference",
    "member_name",
    "student_name",
    "student_id",
    "institution_name",
    "employee_name",
    "employer_name",
    "insurer_name",
    "rejection_reason",
    "cited_clause",
    "clarification_points",
}


def sanitize_draft_inputs(draft_inputs: dict[str, Any] | None) -> dict[str, str]:
    clean: dict[str, str] = {}
    for key, val in (draft_inputs or {}).items():
        if key in ALLOWED_DRAFT_KEYS and isinstance(val, str | int | float):
            clean[key] = str(val).strip()[:4000]
    return clean


def _resolve_owned_coverage(db: Session, owner: Owner, entity_id: str | None):
    policies = owner_policies(db, owner)
    if not entity_id:
        return policies[0] if policies else None
    matched = owner_policy(db, owner, entity_id)
    if matched is None:
        raise AppError(404, "NOT_FOUND", "Target coverage not found.")
    return matched


def _resolve_owned_claim(db: Session, owner: Owner, entity_id: str | None) -> WfClaimCaseRow:
    if not entity_id:
        raise AppError(422, "CLAIM_ID_REQUIRED", "A claim ID is required for this action.")
    try:
        claim_uuid = UUID(str(entity_id))
    except ValueError as exc:
        raise AppError(404, "NOT_FOUND", "Claim case not found.") from exc
    return claims.get_case(db, owner, claim_uuid)


def build_action_payload(
    db: Session,
    owner: Owner,
    action_type: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    draft_inputs: dict[str, Any] | None = None,
    title_override: str | None = None,
    purpose_override: str | None = None,
) -> tuple[str, str, dict[str, Any], WfClaimCaseRow | None]:
    inputs = sanitize_draft_inputs(draft_inputs)
    norm_entity = (entity_type or "").strip().lower()

    if action_type == "sandbox_claim_submit":
        from app.workflow import actions as wf_actions

        case = _resolve_owned_claim(db, owner, entity_id)
        payload = wf_actions.build_submission_payload(db, owner, case)
        return (
            title_override or f"Submit claim {case.reference} to insurer (sandbox)",
            purpose_override
            or "Send the prepared claim form and attached documents to the insurer sandbox.",
            payload,
            case,
        )

    if action_type == "claim_follow_up_message":
        case = _resolve_owned_claim(db, owner, entity_id) if entity_id else None
        procedure = (
            kbdata.procedure_for_product(case.country_code, case.product_id) if case else None
        ) or {}
        contact = procedure.get("customer_support_contact")
        ref_label = (case.sandbox_ref or case.reference) if case else "Pending Claim"
        subject = inputs.get("subject") or f"Follow-up on claim {ref_label}"
        body = inputs.get("body") or (
            f"Hello,\n\nI am writing to follow up on claim {ref_label}.\n"
            "Please advise on the current review status and whether any additional documents "
            "are required.\n\nThank you."
        )
        payload = {
            "subject": subject,
            "body": body,
            "recipient_note": contact
            or "No verified contact found. Use the insurer's official channel.",
            "claim_reference": case.reference if case else None,
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or f"Claim follow-up draft ({ref_label})",
            purpose_override or "Prepare a follow-up message for manual handoff.",
            payload,
            case,
        )

    if action_type == "claim_dispute_appeal":
        case = _resolve_owned_claim(db, owner, entity_id)
        review = claims.review_claim_rejection(
            db,
            owner,
            case,
            rejection_reason=inputs.get("rejection_reason"),
            cited_clause=inputs.get("cited_clause"),
        )
        draft_data = review["appeal_draft"]
        subject = inputs.get("subject") or draft_data["subject"]
        body = inputs.get("body") or draft_data["body"]
        payload = {
            "subject": subject,
            "body": body,
            "recipient_note": draft_data["recipient_note"],
            "claim_reference": case.reference,
            "sandbox_reference": case.sandbox_ref,
            "stated_rejection_reason": review["stated_rejection_reason"],
            "cited_clause": review["cited_clause"],
            "clarifiable_issues": [i["title"] for i in review["clarifiable_issues"]],
            "evidence_checklist": [
                e["label"] for e in review["appeal_evidence_checklist"]
            ],
            "review_posture": "CLARIFICATION_ONLY",
            "insurer_at_fault_concluded": False,
            "acceptance_guaranteed": False,
            "disclaimer": review["disclaimer"],
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or f"Claim clarification & appeal draft ({case.reference})",
            purpose_override
            or "Prepare a factual claim clarification and appeal draft for user review and approval.",
            payload,
            case,
        )

    if action_type == "renewal_inquiry":
        cov = _resolve_owned_coverage(db, owner, entity_id)
        provider = (cov.provider if cov else None) or inputs.get("insurer_name") or "Insurer"
        pol_ref = (cov.number_masked if cov else None) or inputs.get("policy_reference") or "N/A"
        end_date = (cov.end if cov else None) or "unknown"
        subject = inputs.get("subject") or f"Policy renewal inquiry ({provider})"
        body = inputs.get("body") or (
            f"Dear {provider} Support,\n\n"
            f"I would like to inquire about renewing or extending policy {pol_ref} "
            f"(recorded end date: {end_date}).\n"
            "Please share the official renewal window, required documents, and instructions.\n\n"
            f"Sincerely,\n{owner.display_name}"
        )
        payload = {
            "subject": subject,
            "body": body,
            "provider": provider,
            "policy_reference": pol_ref,
            "policy_end_date": end_date,
            "coverage_id": cov.ref if cov else None,
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or f"Renewal inquiry for {provider}",
            purpose_override
            or "Prepare a renewal and continuity inquiry draft for manual handoff.",
            payload,
            None,
        )

    if action_type in ("policy_clarification_inquiry", "insurance_inquiry_draft"):
        cov = _resolve_owned_coverage(db, owner, entity_id) if norm_entity != "claim" else None
        case = _resolve_owned_claim(db, owner, entity_id) if norm_entity == "claim" else None
        provider = (
            (cov.provider if cov else None) or inputs.get("insurer_name") or "Insurance Provider"
        )
        pol_ref = (cov.number_masked if cov else None) or inputs.get("policy_reference") or "N/A"
        query_topic = (
            inputs.get("benefit_query")
            or inputs.get("query_details")
            or (
                "outpatient direct-billing eligibility, reimbursement requirements, and benefit limits"
            )
        )
        subject = inputs.get("subject") or f"Policy benefit clarification ({provider})"
        body = inputs.get("body") or (
            f"Dear {provider} Customer Support,\n\n"
            f"I am requesting written clarification for policy {pol_ref} regarding: {query_topic}.\n"
            "Please confirm the applicable policy clause, required documents, and submission process.\n\n"
            f"Sincerely,\n{owner.display_name}"
        )
        payload = {
            "subject": subject,
            "body": body,
            "provider": provider,
            "policy_reference": pol_ref,
            "coverage_id": cov.ref if cov else None,
            "claim_reference": case.reference if case else None,
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or f"Policy clarification inquiry ({provider})",
            purpose_override or "Prepare a policy benefit clarification draft for manual handoff.",
            payload,
            case,
        )

    if action_type == "employer_benefit_inquiry":
        cov = _resolve_owned_coverage(db, owner, entity_id)
        employer = (
            inputs.get("employer_name") or (cov.provider if cov else None) or "HR / Benefits Team"
        )
        pol_ref = (cov.number_masked if cov else None) or inputs.get("policy_reference") or "N/A"
        query_topic = inputs.get("query_details") or (
            "coordination of benefits between statutory social insurance and employer group coverage"
        )
        subject = inputs.get("subject") or f"Employer benefit coordination inquiry ({employer})"
        body = inputs.get("body") or (
            f"Dear {employer},\n\n"
            f"I would like to confirm the coordination rules for my coverage ({pol_ref}) "
            f"regarding: {query_topic}.\n"
            "Specifically, please confirm which coverage acts as primary payer and which documents "
            "are required for secondary reimbursement.\n\n"
            f"Sincerely,\n{owner.display_name}"
        )
        payload = {
            "subject": subject,
            "body": body,
            "employer_or_provider": employer,
            "policy_reference": pol_ref,
            "coverage_id": cov.ref if cov else None,
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or f"Employer benefit inquiry ({employer})",
            purpose_override
            or "Prepare an employer benefits and coordination inquiry draft for manual handoff.",
            payload,
            None,
        )

    if action_type == "policy_servicing_request":
        cov = _resolve_owned_coverage(db, owner, entity_id)
        req_type = (inputs.get("request_type") or "INFORMATION_CORRECTION").upper()
        if req_type not in servicing.SERVICING_REQUEST_TYPES:
            req_type = "INFORMATION_CORRECTION"
        meta = servicing.SERVICING_REQUEST_TYPES[req_type]
        provider = (cov.provider if cov else None) or inputs.get("insurer_name") or "Insurer"
        pol_ref = (cov.number_masked if cov else None) or inputs.get("policy_reference") or "N/A"
        subject = inputs.get("subject") or f"{meta['title']} ({pol_ref})"
        details_text = (
            inputs.get("reason")
            or inputs.get("new_value")
            or inputs.get("query_details")
            or "Please update the policyholder record as requested."
        )
        body = inputs.get("body") or (
            f"Dear {provider} Administration Team,\n\n"
            f"I am submitting a servicing request ({meta['title']}) for policy {pol_ref}.\n"
            f"Request details: {details_text}\n\n"
            "Please confirm the required endorsement form and processing timeline.\n\n"
            f"Sincerely,\n{owner.display_name}"
        )
        payload = {
            "request_type": req_type,
            "subject": subject,
            "body": body,
            "provider": provider,
            "policy_reference": pol_ref,
            "coverage_id": cov.ref if cov else None,
            "handoff_note": "Draft prepared. Not sent.",
        }
        return (
            title_override or meta["title"],
            purpose_override or f"Prepare servicing draft ({meta['title']}) for manual handoff.",
            payload,
            None,
        )

    if action_type in ("internal_reminder", "calendar_reminder_file"):
        cov = (
            _resolve_owned_coverage(db, owner, entity_id)
            if entity_id and norm_entity != "claim"
            else None
        )
        case = _resolve_owned_claim(db, owner, entity_id) if norm_entity == "claim" else None
        default_due = (datetime.now(UTC).date() + timedelta(days=7)).isoformat()
        if cov and cov.end:
            try:
                end_dt = date.fromisoformat(cov.end[:10])
                cand = end_dt - timedelta(days=30)
                if cand >= datetime.now(UTC).date():
                    default_due = cand.isoformat()
            except ValueError:
                pass
        due_date = inputs.get("due_date") or default_due
        rem_title = (
            inputs.get("title")
            or title_override
            or (f"Review coverage for {cov.provider or cov.name}" if cov else "Insurance reminder")
        )
        rem_detail = (
            inputs.get("detail")
            or inputs.get("body")
            or (
                f"Check renewal and coverage continuity before {cov.end}."
                if cov and cov.end
                else "Review your insurance documents and upcoming dates."
            )
        )
        payload = {
            "title": rem_title[:200],
            "detail": rem_detail[:500],
            "due_date": due_date[:10],
            "coverage_id": cov.ref if cov else None,
            "claim_reference": case.reference if case else None,
        }
        if action_type == "calendar_reminder_file":
            payload["handoff_note"] = "Calendar file generated. Draft prepared. Not sent."
        return (
            title_override or rem_title[:200],
            purpose_override
            or (
                "Generate a downloadable calendar reminder file (.ics)."
                if action_type == "calendar_reminder_file"
                else "Schedule an internal reminder inside INSURRA."
            ),
            payload,
            case,
        )

    raise AppError(422, "UNSUPPORTED_ACTION_TYPE", "This action type is not supported.")


def build_ics_text(action: WfActionRow) -> str:
    payload = action.payload or {}
    raw_due = str(payload.get("due_date") or "")[:10]
    try:
        parsed = date.fromisoformat(raw_due)
    except ValueError:
        parsed = datetime.now(UTC).date() + timedelta(days=7)
    start_ymd = parsed.strftime("%Y%m%d")
    end_ymd = (parsed + timedelta(days=1)).strftime("%Y%m%d")
    summary = str(payload.get("title") or action.title).replace("\n", " ")[:160]
    desc = str(payload.get("detail") or action.purpose).replace("\n", "\\n")[:400]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//INSURRA//Insurance Companion//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:insurra-action-{action.id}@insurra.local",
        f"DTSTAMP:{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART;VALUE=DATE:{start_ymd}",
        f"DTEND;VALUE=DATE:{end_ymd}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{desc}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
    return "\r\n".join(lines)


def execute_manual_handoff(action: WfActionRow) -> tuple[str, str, dict[str, Any]]:
    payload = action.payload or {}
    if action.action_type == "calendar_reminder_file":
        ics_text = build_ics_text(action)
        return (
            "NOT_SENT",
            "Calendar file generated. Draft prepared. Not sent.",
            {
                "handoff_kind": "CALENDAR_ICS",
                "ics_content": ics_text,
                "notice": "Calendar file generated. Draft prepared. Not sent.",
            },
        )

    subject = str(payload.get("subject") or action.title)
    body = str(payload.get("body") or payload.get("detail") or "")
    mailto_url = f"mailto:?subject={quote(subject)}&body={quote(body)}"
    copy_text = f"Subject: {subject}\n\n{body}"
    return (
        "NOT_SENT",
        "Draft prepared. Not sent. Copy the draft or open it in your own email app.",
        {
            "handoff_kind": "MANUAL_EMAIL_DRAFT",
            "mailto_url": mailto_url,
            "copy_text": copy_text,
            "notice": "Draft prepared. Not sent.",
        },
    )
