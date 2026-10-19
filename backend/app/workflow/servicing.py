"""Policy servicing agent (SC-10 PBI US-10-06).

Prepares administrative requests (certificate replacement, info correction, renewal inquiry,
benefit clarification, employer/university inquiry) based on existing policy context and verified
insurer procedures. All external actions produce manual handoff drafts requiring explicit user approval.
"""

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.workflow import actions, audit, kbdata
from app.workflow.models import WfActionRow
from app.workflow.owner import Owner, owner_policy

SERVICING_REQUEST_TYPES = {
    "CERTIFICATE_REPLACEMENT": {
        "title": "Request Replacement Insurance Certificate",
        "description": "Prepare a formal request to obtain an updated or replacement insurance policy certificate.",
        "required_fields": ["policy_reference", "member_name", "reason"],
    },
    "INFORMATION_CORRECTION": {
        "title": "Prepare Correction of Policyholder Information",
        "description": "Prepare an endorsement request to update policyholder personal information, contact info, or passport details.",
        "required_fields": ["policy_reference", "member_name", "field_to_correct", "new_value"],
    },
    "RENEWAL_INQUIRY": {
        "title": "Inquire About Policy Renewal & Grace Period",
        "description": "Ask the insurer regarding renewal eligibility, premiums, required documents, and grace period deadlines.",
        "required_fields": ["policy_reference", "member_name"],
    },
    "BENEFIT_CLARIFICATION": {
        "title": "Request Policy Benefit Clarification",
        "description": "Clarify specific coverage terms, network hospital eligibility, or pre-authorization requirements.",
        "required_fields": ["policy_reference", "benefit_query"],
    },
    "UNIVERSITY_INQUIRY": {
        "title": "Prepare University Insurance Inquiry",
        "description": "Prepare an official inquiry to the international student office regarding university compliance and insurance registration.",
        "required_fields": ["student_name", "student_id", "institution_name", "query_details"],
    },
    "EMPLOYER_INQUIRY": {
        "title": "Prepare Employer Insurance Inquiry",
        "description": "Ask the HR or benefits department regarding group health enrollment, dependent coverage, or claims coordination.",
        "required_fields": ["employee_name", "employer_name", "query_details"],
    },
}


def get_available_servicing_types() -> list[dict]:
    return [
        {
            "type_code": code,
            "title": meta["title"],
            "description": meta["description"],
            "required_fields": meta["required_fields"],
        }
        for code, meta in SERVICING_REQUEST_TYPES.items()
    ]


def prepare_servicing_draft(
    db: Session,
    owner: Owner,
    request_type: str,
    policy_ref: str | None,
    form_data: dict[str, str],
) -> WfActionRow:
    if request_type not in SERVICING_REQUEST_TYPES:
        raise AppError(
            422, "INVALID_SERVICING_TYPE", f"Request type '{request_type}' is not supported."
        )

    meta = SERVICING_REQUEST_TYPES[request_type]
    missing = [f for f in meta["required_fields"] if not (form_data.get(f) or "").strip()]
    if missing:
        raise AppError(
            422,
            "MISSING_SERVICING_FIELDS",
            f"The following required fields are missing: {', '.join(missing)}.",
            {"missing_fields": missing},
        )

    policy = owner_policy(db, owner, policy_ref) if policy_ref else None
    country_code = (policy.country_code if policy else owner.country_code) or "CN"
    insurer_name = (
        (policy.provider if policy else None)
        or form_data.get("insurer_name")
        or "Insurance Provider"
    )

    # Retrieve official claims/servicing procedure if available
    procedure = kbdata.procedure_for_product(country_code, None)
    customer_service = (
        procedure.get("customer_support_contact") if procedure else None
    ) or "Official Customer Service Channel"

    # Construct clean, professional message body
    lines = [
        f"Subject: {meta['title']} - {form_data.get('policy_reference') or form_data.get('member_name') or 'Policyholder'}",
        "",
        f"Dear {insurer_name} Customer Support / Administration Team,",
        "",
        f"I am writing to submit a request regarding: {meta['title']}.",
        "",
        "--- REQUEST DETAILS ---",
    ]

    for field_key, field_val in form_data.items():
        clean_key = field_key.replace("_", " ").title()
        lines.append(f"{clean_key}: {field_val}")

    if policy:
        lines.append(f"Recorded Policy Type: {policy.kind}")
        if policy.number_masked:
            lines.append(f"Policy Number (Masked): {policy.number_masked}")
        if policy.start and policy.end:
            lines.append(f"Coverage Term: {policy.start} to {policy.end}")

    lines.extend(
        [
            "",
            "Please provide confirmation of receipt and advise on the processing timeline and any further steps.",
            "",
            "Sincerely,",
            form_data.get("member_name")
            or form_data.get("student_name")
            or form_data.get("employee_name")
            or owner.display_name,
        ]
    )

    body_text = "\n".join(lines)
    payload = {
        "request_type": request_type,
        "title": meta["title"],
        "policy_reference": policy_ref or form_data.get("policy_reference"),
        "insurer_name": insurer_name,
        "customer_service_contact": customer_service,
        "form_data": form_data,
        "subject": f"{meta['title']} - {policy.name if policy else 'Policy Request'}",
        "body": body_text,
        "notice": "Draft prepared by INSURRA. Since INSURRA does not directly modify insurer records, please send this through your insurer's official channel.",
    }

    action = actions.prepare_action(
        db,
        owner,
        "policy_servicing_request",
        title=meta["title"],
        purpose=f"Prepared servicing request: {meta['title']} for {insurer_name}.",
        payload=payload,
        dedupe_base=f"servicing:{request_type}:{policy_ref or 'general'}",
    )

    audit.record(
        db,
        owner,
        "SERVICING_REQUEST_PREPARED",
        "ACTIONS",
        f"Policy servicing draft prepared: {meta['title']}",
        summary=f"Prepared {meta['title']} draft for {insurer_name}. Ready for review.",
        actor_type="AI_PREPARED",
        tool="prepare_servicing_draft",
        action_id=action.id,
        details={
            "action_type": "policy_servicing_request",
            "action_reference": action.reference,
            "destination": action.destination,
        },
    )

    return action
