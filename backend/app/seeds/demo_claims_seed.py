"""Seed realistic demo claim cases, actions, evidence, and audit logs from KB.

Injected for demo sessions so that judges / demo users immediately experience the rich,
production-grade interface showcased in the design references. Authenticated account mode
remains completely separate with isolated, private user data.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.approval import payload_sha256
from app.workflow import states
from app.workflow.models import (
    WfActionRow,
    WfAuditLogRow,
    WfClaimCaseRow,
    WfClaimDraftRow,
    WfClaimEvidenceRow,
    WfClaimItemRow,
    WfClaimStatusEventRow,
)


def seed_demo_claims_for_session(
    db: Session, session_id: UUID, country_code: str = "CN", persona_name: str = "Raka"
) -> None:
    now = datetime.now(UTC)

    # Check if demo claims already seeded for this session
    existing = db.query(WfClaimCaseRow).filter_by(owner_kind="DEMO", owner_id=session_id).first()
    if existing is not None:
        return

    # =========================================================================
    # Case 1 (Primary Hero Case): CLM-2026-001 - GP Consultation / Outpatient Care
    # Corresponds directly to design mockups (Screenshots 2 & 3)
    # =========================================================================
    case1_id = uuid4()
    case1 = WfClaimCaseRow(
        id=case1_id,
        owner_kind="DEMO",
        owner_id=session_id,
        reference="CLM-2026-001",
        title="GP Consultation",
        claim_type="Outpatient Visit",
        country_code=country_code,
        coverage_ref="cov-hero-001",
        coverage_label="Ping An Comprehensive Student Medical (来华留学生综合医疗保险)"
        if country_code == "CN"
        else "HealthPlus Outpatient Care",
        insured_person="Self",
        claimant_name=persona_name,
        product_id="cn-prod-lxbx-student"
        if country_code == "CN"
        else "id-prod-allianz-smarthealth",
        procedure_id="cn-claim-proc-lxbx"
        if country_code == "CN"
        else "id-claim-proc-allianz-reimbursement",
        service_date="2026-10-12",
        provider_name="Shenzhen University General Hospital (深圳大学总医院)"
        if country_code == "CN"
        else "HealthPlus Clinic",
        amount="450.00" if country_code == "CN" else "115.00",
        currency="CNY" if country_code == "CN" else "SGD",
        policy_start="2026-09-01",
        policy_end="2027-08-31",
        status=states.READY_FOR_APPROVAL,
        origin="CLAIMS_CENTER",
        is_synthetic=True,
        review_confirmed=True,
        conflict_notes={
            "origins": {
                "service_date": {"origin": "EVIDENCE", "label": "Medical Receipt.pdf", "page": 1},
                "provider_name": {"origin": "EVIDENCE", "label": "Medical Receipt.pdf", "page": 1},
                "amount": {"origin": "EVIDENCE", "label": "Medical Receipt.pdf", "page": 1},
                "currency": {"origin": "EVIDENCE", "label": "Medical Receipt.pdf", "page": 1},
            }
        },
        monitoring_enabled=True,
        monitoring_state="NOT_STARTED",
        created_at=now - timedelta(days=7, hours=2),
        updated_at=now - timedelta(hours=1),
    )
    db.add(case1)
    db.flush()

    # Checklist items for Case 1
    items_c1 = [
        (
            "POLICY",
            "Policy Information",
            "INFO",
            "Verified active student comprehensive insurance.",
            True,
        ),
        ("SERVICE_DATE", "Visit Date", "INFO", "Confirmed from medical invoice date.", True),
        (
            "cn-ev-fapiao",
            "Medical Receipt / Fapiao",
            "DOCUMENT",
            "Official medical electronic invoice stamped by hospital.",
            True,
        ),
        (
            "cn-ev-medical-record",
            "Treatment Details & Medical Record",
            "DOCUMENT",
            "Outpatient doctor consultation and diagnosis notes.",
            True,
        ),
    ]
    for idx, (code, label, kind, reason, mandatory) in enumerate(items_c1, start=1):
        db.add(
            WfClaimItemRow(
                claim_id=case1.id,
                code=code,
                label=label,
                kind=kind,
                reason=reason,
                mandatory=mandatory,
                position=idx,
            )
        )

    # Evidence files for Case 1
    ev1 = WfClaimEvidenceRow(
        id=uuid4(),
        claim_id=case1.id,
        evidence_kind="FAPIAO",
        filename="Medical Receipt.pdf",
        mime_type="application/pdf",
        size_bytes=1258291,  # 1.2 MB
        sha256="4d71bc29f8a3d548325a07c126e7925e01934c568910b8cf891045a190283bca",
        source_type="DOCUMENT_UPLOAD",
        status="CONFIRMED",
        is_synthetic=True,
        fields={
            "invoice_number": {
                "value": "FP-SZ-2024-918230",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "billing_date": {
                "value": "2026-10-12",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "payer_name": {
                "value": persona_name,
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "hospital_name": {
                "value": "Shenzhen University General Hospital"
                if country_code == "CN"
                else "HealthPlus Clinic",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "total_amount": {
                "value": "450.00" if country_code == "CN" else "115.00",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "currency": {
                "value": "CNY" if country_code == "CN" else "SGD",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "diagnosed_condition": {
                "value": "Acute Gastroenteritis (急性肠胃炎)",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
        },
        created_at=now - timedelta(days=7, hours=1),
    )
    ev2 = WfClaimEvidenceRow(
        id=uuid4(),
        claim_id=case1.id,
        evidence_kind="MEDICAL_RECORD",
        filename="Consultation Invoice.pdf",
        mime_type="application/pdf",
        size_bytes=838860,  # 0.8 MB
        sha256="e109a25b871c89f0452309eac7840134bc98319f0412356788bcad0134567890",
        source_type="DOCUMENT_UPLOAD",
        status="CONFIRMED",
        is_synthetic=True,
        fields={
            "visit_date": {
                "value": "2026-10-12",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "patient_name": {
                "value": persona_name,
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "hospital_name": {
                "value": "Shenzhen University General Hospital"
                if country_code == "CN"
                else "HealthPlus Clinic",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
            "diagnosed_condition": {
                "value": "Acute Gastroenteritis with mild dehydration",
                "confirmed": True,
                "source_page": 1,
                "origin": "EXTRACTED",
            },
        },
        created_at=now - timedelta(days=7),
    )
    db.add_all([ev1, ev2])

    # Claim Draft for Case 1
    draft_form = {
        "policy_reference": {
            "value": "HP-0021",
            "section": "Member Information",
            "label": "Policy reference",
            "required": True,
            "source": {"type": "POLICY", "label": "From policy data"},
        },
        "insurer": {
            "value": "HealthPlus / Ping An",
            "section": "Member Information",
            "label": "Insurer",
            "required": True,
            "source": {"type": "POLICY", "label": "From policy data"},
        },
        "member_name": {
            "value": persona_name,
            "section": "Member Information",
            "label": "Member name",
            "required": True,
            "source": {"type": "EVIDENCE", "label": "From Medical Receipt.pdf (p.1)"},
        },
        "relationship": {
            "value": "Self",
            "section": "Member Information",
            "label": "Relationship",
            "required": False,
            "source": {"type": "CASE", "label": "From profile context"},
        },
        "visit_date": {
            "value": "2026-10-12",
            "section": "Visit Details",
            "label": "Date of visit",
            "required": True,
            "source": {"type": "EVIDENCE", "label": "From Medical Receipt.pdf (p.1)"},
        },
        "provider_name": {
            "value": "HealthPlus Clinic / Shenzhen University Hospital",
            "section": "Visit Details",
            "label": "Provider name",
            "required": True,
            "source": {"type": "EVIDENCE", "label": "From Medical Receipt.pdf (p.1)"},
        },
        "claim_type": {
            "value": "General Practitioner / Outpatient",
            "section": "Visit Details",
            "label": "Claim type",
            "required": True,
            "source": {"type": "CASE", "label": "From claim definition"},
        },
        "total_claim_amount": {
            "value": "450.00" if country_code == "CN" else "115.00",
            "section": "Claim Details",
            "label": "Total claim amount",
            "required": True,
            "source": {"type": "EVIDENCE", "label": "From Medical Receipt.pdf (p.1)"},
        },
        "currency": {
            "value": "CNY" if country_code == "CN" else "SGD",
            "section": "Claim Details",
            "label": "Currency",
            "required": True,
            "source": {"type": "EVIDENCE", "label": "From Medical Receipt.pdf (p.1)"},
        },
        "diagnosis": {
            "value": "Acute Gastroenteritis (急性肠胃炎)",
            "section": "Claim Details",
            "label": "Diagnosis / Treatment",
            "required": False,
            "source": {"type": "EVIDENCE", "label": "From Consultation Invoice.pdf (p.1)"},
        },
    }
    db.add(
        WfClaimDraftRow(
            claim_id=case1.id,
            version=1,
            form=draft_form,
            missing_required=[],
            status="DRAFT",
            created_at=now - timedelta(days=6),
            updated_at=now - timedelta(days=6),
        )
    )

    # Timeline events for Case 1
    events1 = [
        (
            "CASE_CREATED",
            None,
            states.DRAFT,
            "USER",
            "GP Consultation claim case was created.",
            now - timedelta(days=7, hours=2),
        ),
        (
            "EVIDENCE_ADDED",
            states.DRAFT,
            states.DRAFT,
            "USER",
            "Medical Receipt.pdf (1.2 MB) and Consultation Invoice.pdf uploaded.",
            now - timedelta(days=7, hours=1),
        ),
        (
            "INFORMATION_VERIFIED",
            states.DRAFT,
            states.NEEDS_REVIEW,
            "SYSTEM",
            "Verified policy coverage and member information.",
            now - timedelta(days=7),
        ),
        (
            "DRAFT_GENERATED",
            states.NEEDS_REVIEW,
            states.READY_FOR_APPROVAL,
            "AGENT",
            "Claim draft prepared using extracted evidence values.",
            now - timedelta(days=6),
        ),
    ]
    for ev_type, from_st, to_st, src, note, ts in events1:
        db.add(
            WfClaimStatusEventRow(
                claim_id=case1.id,
                event_type=ev_type,
                from_status=from_st,
                to_status=to_st,
                source=src,
                note=note,
                created_at=ts,
            )
        )

    # =========================================================================
    # Cases 2, 3, 4, 5: Matching Claims Center Overview table (Screenshot 1)
    # =========================================================================
    other_cases = [
        (
            "CLM-2024-1042",
            "Medical Expenses",
            "Global Travel",
            states.MISSING_EVIDENCE,
            "Needs Documents",
            "2 days ago",
            now - timedelta(days=2),
        ),
        (
            "CLM-2024-1031",
            "Trip Cancellation",
            "Global Travel",
            states.NEEDS_REVIEW,
            "Ready for Review",
            "5 days ago",
            now - timedelta(days=5),
        ),
        (
            "CLM-2024-0998",
            "Emergency Care",
            "Student Protect",
            states.SUBMITTED,
            "Submitted",
            "1 week ago",
            now - timedelta(days=7),
        ),
        (
            "CLM-2024-0781",
            "Baggage Loss",
            "Global Travel",
            states.DRAFT,
            "Draft",
            "2 weeks ago",
            now - timedelta(days=14),
        ),
        (
            "CLM-2024-0664",
            "Outpatient Care",
            "Expat Care",
            states.SUBMITTED,
            "Submitted",
            "3 weeks ago",
            now - timedelta(days=21),
        ),
    ]
    for ref, title, cov, st, _st_lbl, _, created_ts in other_cases:
        db.add(
            WfClaimCaseRow(
                owner_kind="DEMO",
                owner_id=session_id,
                reference=ref,
                title=title,
                claim_type=title,
                country_code=country_code,
                coverage_ref="cov-general",
                coverage_label=cov,
                insured_person="Self",
                claimant_name=persona_name,
                product_id="cn-prod-pingan-travel" if "Travel" in cov else "cn-prod-lxbx-student",
                service_date=(created_ts - timedelta(days=3)).strftime("%Y-%m-%d"),
                provider_name="Shenzhen Hospital"
                if country_code == "CN"
                else "General Medical Provider",
                amount="650.00" if country_code == "CN" else "180.00",
                currency="CNY" if country_code == "CN" else "IDR",
                status=st,
                origin="CLAIMS_CENTER",
                is_synthetic=True,
                sandbox_ref=f"SBX-2024-{ref[-4:]}" if st == states.SUBMITTED else None,
                sandbox_status="PROCESSING" if st == states.SUBMITTED else None,
                monitoring_enabled=True,
                monitoring_state="ACTIVE" if st == states.SUBMITTED else "NOT_STARTED",
                created_at=created_ts,
                updated_at=created_ts + timedelta(hours=3),
            )
        )

    # =========================================================================
    # Action Queue Items: Matching Action Approval Screen (Screenshot 4)
    # =========================================================================

    # Action 1: Pending Hero Action (Submit claim to insurer sandbox)
    act1_payload = {
        "claim_reference": "CLM-2026-001",
        "claim_type": "Outpatient Visit",
        "country_code": country_code,
        "product_id": "cn-prod-lxbx-student"
        if country_code == "CN"
        else "id-prod-allianz-smarthealth",
        "claimant": persona_name,
        "policy": {
            "reference": "HP-0021",
            "insurer": "HealthPlus / Ping An",
            "start": "2026-09-01",
            "end": "2027-08-31",
            "label": "HealthPlus Comprehensive Plan",
        },
        "service": {
            "date": "2026-10-12",
            "provider": "HealthPlus Clinic / Shenzhen University Hospital",
        },
        "amount": {
            "value": "450.00" if country_code == "CN" else "115.00",
            "currency": "CNY" if country_code == "CN" else "SGD",
        },
        "diagnosis": "Acute Gastroenteritis (急性肠胃炎)",
        "attachments": [
            {
                "evidence_id": str(ev1.id),
                "evidence_kind": "FAPIAO",
                "filename": "Medical Receipt.pdf",
                "sha256": ev1.sha256,
            },
            {
                "evidence_id": str(ev2.id),
                "evidence_kind": "MEDICAL_RECORD",
                "filename": "Consultation Invoice.pdf",
                "sha256": ev2.sha256,
            },
        ],
    }
    act1_sha = payload_sha256(act1_payload)
    act1 = WfActionRow(
        id=uuid4(),
        owner_kind="DEMO",
        owner_id=session_id,
        reference="ACT-2026-015",
        claim_id=case1.id,
        action_type="sandbox_claim_submit",
        title="Submit claim to insurer (sandbox)",
        purpose="Send the prepared claim form and attached documents to the insurer's sandbox environment for review.",
        destination="insurer_sandbox",
        environment="SANDBOX",
        payload=act1_payload,
        payload_sha256=act1_sha,
        payload_version=1,
        status="AWAITING_APPROVAL",
        required_permissions=["process_documents"],
        expires_at=now + timedelta(hours=23),
        ai_prepared=True,
        created_at=now - timedelta(hours=1),
        updated_at=now - timedelta(hours=1),
    )
    db.add(act1)

    # Action 2: Send follow-up message to insurer (Draft)
    db.add(
        WfActionRow(
            id=uuid4(),
            owner_kind="DEMO",
            owner_id=session_id,
            reference="ACT-2026-014",
            claim_id=case1.id,
            action_type="claim_follow_up_message",
            title="Send follow-up message to insurer",
            purpose="Send a follow-up message regarding document requirements.",
            destination="manual_handoff",
            environment="MANUAL_HANDOFF",
            payload={
                "subject": "Follow-up on CLM-2026-001 documentation",
                "body": "Inquiry regarding electronic invoice verification.",
            },
            payload_sha256=payload_sha256({"test": "2"}),
            payload_version=1,
            status="DRAFT",
            required_permissions=["process_documents"],
            ai_prepared=True,
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=2),
        )
    )

    # Action 3: Set reminder (Draft)
    db.add(
        WfActionRow(
            id=uuid4(),
            owner_kind="DEMO",
            owner_id=session_id,
            reference="ACT-2026-012",
            claim_id=case1.id,
            action_type="internal_reminder",
            title="Set reminder",
            purpose="Remind you to upload the missing medical report if needed.",
            destination="insurra_internal",
            environment="INTERNAL",
            payload={
                "title": "Upload medical report",
                "due_date": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
            },
            payload_sha256=payload_sha256({"test": "3"}),
            payload_version=1,
            status="DRAFT",
            required_permissions=[],
            ai_prepared=True,
            created_at=now - timedelta(days=4),
            updated_at=now - timedelta(days=4),
        )
    )

    # Action 4: Prepare claim draft (Completed)
    db.add(
        WfActionRow(
            id=uuid4(),
            owner_kind="DEMO",
            owner_id=session_id,
            reference="ACT-2026-009",
            claim_id=case1.id,
            action_type="claim_form_preparation",
            title="Prepare claim draft",
            purpose="Created a draft claim form based on your documents.",
            destination="insurra_internal",
            environment="INTERNAL",
            payload={"claim_reference": "CLM-2026-001"},
            payload_sha256=payload_sha256({"test": "4"}),
            payload_version=1,
            status="COMPLETED",
            required_permissions=[],
            ai_prepared=True,
            created_at=now - timedelta(days=7),
            updated_at=now - timedelta(days=6),
        )
    )

    # Action 5: Draft email to provider (Completed)
    db.add(
        WfActionRow(
            id=uuid4(),
            owner_kind="DEMO",
            owner_id=session_id,
            reference="ACT-2026-006",
            action_type="insurance_inquiry_draft",
            title="Draft email to provider",
            purpose="Prepared an email to request a detailed invoice from the hospital.",
            destination="manual_handoff",
            environment="MANUAL_HANDOFF",
            payload={
                "subject": "Request for Itemized Invoice",
                "body": "Please provide itemized hospital breakdown.",
            },
            payload_sha256=payload_sha256({"test": "5"}),
            payload_version=1,
            status="COMPLETED",
            required_permissions=[],
            ai_prepared=True,
            created_at=now - timedelta(days=10),
            updated_at=now - timedelta(days=10),
        )
    )

    # Action 6: Search coverage information (Rejected / Cancelled)
    db.add(
        WfActionRow(
            id=uuid4(),
            owner_kind="DEMO",
            owner_id=session_id,
            reference="ACT-2026-002",
            action_type="policy_servicing_request",
            title="Search coverage information",
            purpose="This action was cancelled by you.",
            destination="manual_handoff",
            environment="MANUAL_HANDOFF",
            payload={"cancelled": True},
            payload_sha256=payload_sha256({"test": "6"}),
            payload_version=1,
            status="REJECTED",
            required_permissions=[],
            ai_prepared=True,
            created_at=now - timedelta(days=11),
            updated_at=now - timedelta(days=11),
        )
    )

    # =========================================================================
    # Audit Logs: Matching Activity & Audit Screen (Screenshot 5)
    # =========================================================================
    audit_events = [
        (
            "ACTION_SUBMITTED_SANDBOX",
            "ACTIONS",
            "Action submitted to sandbox",
            "Submitted claim form to insurer's sandbox environment.",
            "SANDBOX",
            "execute_sandbox_claim",
            "EXECUTED",
            now - timedelta(hours=1),
            "CLM-2026-001",
        ),
        (
            "CLAIM_DRAFT_APPROVED",
            "ACTIONS",
            "Claim draft approved",
            "You approved the prepared claim form.",
            "USER",
            "request_action_approval",
            "APPROVED",
            now - timedelta(hours=2, minutes=11),
            "CLM-2026-001",
        ),
        (
            "DOCUMENT_UPLOADED",
            "DOCUMENTS",
            "Document uploaded",
            "Medical Receipt.pdf (1.2 MB) processed.",
            "USER",
            "get_authorized_document_fields",
            "SUCCESS",
            now - timedelta(hours=3, minutes=29),
            "CLM-2026-001",
        ),
        (
            "CLAIM_CASE_CREATED",
            "CLAIMS",
            "Claim case created",
            "GP Consultation claim case was created.",
            "USER",
            "create_claim_case",
            "COMPLETED",
            now - timedelta(hours=7, minutes=17),
            "CLM-2026-001",
        ),
        (
            "AI_GUIDANCE_PROVIDED",
            "CLAIMS",
            "AI provided guidance",
            "Provided document checklist for outpatient claim.",
            "AI_PREPARED",
            "get_applicable_claim_procedure",
            "INFO",
            now - timedelta(days=1, hours=5),
            "CLM-2026-001",
        ),
        (
            "INFORMATION_VERIFIED",
            "COVERAGE",
            "Information verified",
            "Verified policy coverage and member information.",
            "SYSTEM",
            "validate_claim_evidence",
            "COMPLETED",
            now - timedelta(days=1, hours=10),
            "CLM-2026-001",
        ),
        (
            "MISSING_INFO_DETECTED",
            "CLAIMS",
            "Missing information detected",
            "Treatment details not found in uploaded documents.",
            "SYSTEM",
            "calculate_claim_readiness",
            "WARNING",
            now - timedelta(days=1, hours=12),
            "CLM-2026-001",
        ),
        (
            "DRAFT_EMAIL_PREPARED",
            "ACTIONS",
            "Draft email prepared",
            "Prepared an email to request detailed invoice from provider.",
            "AI_PREPARED",
            "prepare_action",
            "COMPLETED",
            now - timedelta(days=2, hours=7),
            "CLM-2024-1042",
        ),
        (
            "ACTION_BLOCKED",
            "SECURITY",
            "Action blocked",
            "Attempted to submit claim without required documents.",
            "BACKEND_EXECUTED",
            "verify_action_approval",
            "BLOCKED",
            now - timedelta(days=2, hours=9),
            "CLM-2024-1042",
        ),
    ]

    for ev_type, cat, title, summary, actor, tool, res_st, ts, clm_ref in audit_events:
        db.add(
            WfAuditLogRow(
                owner_kind="DEMO",
                owner_id=session_id,
                event_type=ev_type,
                category=cat,
                title=title,
                summary=summary,
                actor_type=actor,
                tool=tool,
                result_status=res_st,
                claim_id=case1.id if clm_ref == "CLM-2026-001" else None,
                evidence_refs=["Medical Receipt.pdf", "Consultation Invoice.pdf"]
                if "Document" in title or "submitted" in title
                else [],
                details={
                    "claim_reference": clm_ref,
                    "environment": "SANDBOX" if "sandbox" in title.lower() else "INTERNAL",
                    "status": res_st,
                },
                created_at=ts,
            )
        )

    db.commit()
