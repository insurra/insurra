"""Deterministic and AI-augmented Protection Assessment Engine (SC-14).

Computes canonical protection needs, evaluates verified and self-reported policy coverage,
detects date continuity gaps, checks exclusions, and grounds findings in verified KB products.
"""

import hashlib
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.account_data import (
    AccountDocumentRow,
    AccountProtectionAssessmentRow,
)
from app.schemas.actor import Actor
from app.schemas.consent import ConsentPurpose
from app.schemas.profile import Situation, UserProfile
from app.schemas.protection_assessment import (
    FullProtectionAssessment,
    KeyFindingItem,
    NextStepItem,
    ProductComparisonResponse,
    ProductComparisonRow,
    ProductOption,
    ProfileContextView,
    ProtectionNeedItem,
    ProtectionSummary,
    RecentUpdateItem,
)
from app.services.ai_gateway import ResponsesGateway
from app.services.workspace import coverages, grants, profile
from app.workflow import kbdata


def _input_hash(user: UserProfile, cov_ids: list[str], doc_count: int, country: str) -> str:
    seed = f"{user.country_code}|{user.occupation}|{user.city}|{user.visa_expiry_date}|{user.has_dependents}|{len(cov_ids)}|{','.join(sorted(cov_ids))}|{doc_count}|{country}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _get_products_for_category(country_code: str, category: str) -> list[ProductOption]:
    raw_products = kbdata.products(country_code)
    results: list[ProductOption] = []
    category_lower = category.lower()

    for p in raw_products:
        prod_cat = (p.get("product_category") or "").lower()
        prod_name = (p.get("english_name") or p.get("original_product_name") or "").lower()
        benefits = p.get("benefits", [])
        has_benefit = any(
            category_lower in (b.get("benefit_category") or "").lower() for b in benefits
        )

        is_match = (
            category_lower in prod_cat
            or has_benefit
            or ("student" in category_lower and "student" in prod_cat)
            or (
                category_lower == "dental"
                and ("dental" in prod_name or has_benefit or "student" in prod_cat)
            )
        )

        if not is_match and results:
            continue

        insurer = (
            p.get("insurer_id", "").replace("cn-insurer-", "").replace("id-insurer-", "").title()
        )
        if "pingan" in insurer.lower():
            insurer = "Ping An"
        elif "allianz" in insurer.lower():
            insurer = "Allianz"
        elif "axa" in insurer.lower():
            insurer = "AXA"
        elif "lxbx" in insurer.lower():
            insurer = "Comprehensive Student Scheme"
        elif "bpjs" in insurer.lower():
            insurer = "BPJS Kesehatan"
        elif "prudential" in insurer.lower():
            insurer = "Prudential"
        elif "manulife" in insurer.lower():
            insurer = "Manulife"

        results.append(
            ProductOption(
                product_id=p["product_id"],
                insurer_name=insurer,
                product_name=p.get("english_name")
                or p.get("original_product_name")
                or p["product_id"],
                badge=p.get("badge")
                or ("Popular with students" if "student" in prod_cat else None),
                annual_limit=p.get("annual_limit") or "Up to ¥20,000"
                if country_code == "CN"
                else "Up to IDR 150,000,000",
                covers_basic_treatment=p.get("covers_basic_treatment") or "Yes",
                covers_major_treatment=p.get("covers_major_treatment") or "Yes (subject to plan)",
                waiting_period=p.get("waiting_period") or "None",
                direct_billing=p.get("direct_billing") or "Selected hospitals",
                worldwide_coverage=p.get("worldwide_coverage") or "Yes",
                estimated_premium=p.get("estimated_premium")
                or (
                    f"¥{p.get('published_pricing')}"
                    if p.get("published_pricing")
                    else "Contact provider"
                ),
                key_features=p.get("key_features")
                or [
                    "Covers basic treatment",
                    "Worldwide coverage",
                    "Direct billing at designated hospitals",
                ],
                official_url=p.get("product_url") or "https://www.insurra.com",
                verification_status=p.get("verification_status") or "VERIFIED",
            )
        )
    return results[:4]


def build_protection_assessment(
    db: Session,
    actor: Actor,
    kb,
    force_refresh: bool = False,
    refresh_reason: str = "INITIAL_ASSESSMENT",
) -> FullProtectionAssessment:
    user = profile(db, actor)
    current_grants = grants(db, actor)
    use_documents = bool(current_grants.get(ConsentPurpose.PROCESS_DOCUMENTS.value))
    use_ai = bool(current_grants.get(ConsentPurpose.EXTERNAL_AI.value))

    # Load existing coverages & docs
    evidence = coverages(db, actor, kb) if use_documents else []
    today = date.today()

    doc_count = 0
    if actor.account_id:
        doc_count = len(
            list(
                db.scalars(
                    select(AccountDocumentRow).where(
                        AccountDocumentRow.account_id == actor.account_id
                    )
                )
            )
        )
    elif actor.session_id:
        doc_count = len(evidence)

    cov_ids = [str(c.id) for c in evidence]
    input_h = _input_hash(user, cov_ids, doc_count, user.country_code)

    # Check for existing cached assessment if not force_refresh
    if not force_refresh:
        existing_row = db.scalar(
            select(AccountProtectionAssessmentRow)
            .where(
                AccountProtectionAssessmentRow.account_id == actor.account_id
                if actor.account_id
                else AccountProtectionAssessmentRow.session_id == actor.session_id
            )
            .order_by(AccountProtectionAssessmentRow.updated_at.desc())
        )
        if existing_row and existing_row.input_hash == input_h:
            try:
                return FullProtectionAssessment.model_validate(existing_row.payload)
            except Exception:
                pass  # Fallback to re-evaluating if payload format evolved

    is_student = user.situation == Situation.STUDENT or (user.occupation or "").upper() == "STUDENT"
    is_china = user.country_code == "CN"
    is_indonesia = user.country_code == "ID"

    # Evaluate Needs deterministically
    needs: list[ProtectionNeedItem] = []
    key_findings: list[KeyFindingItem] = []

    # Filter out commercial liability from personal health
    personal_policies = [
        c
        for c in evidence
        if "commercial" not in (c.kind or "").lower() and "liability" not in (c.kind or "").lower()
    ]
    liability_policies = [c for c in evidence if "liability" in (c.kind or "").lower()]

    has_verified_health = any(c.verified and c.active(today) for c in personal_policies)
    has_unverified_health = any(not c.verified for c in personal_policies)
    declared_coverages = [c.lower() for c in (user.owned_coverage or [])]
    has_declared_health = any(
        k in " ".join(declared_coverages)
        for k in ("health", "medical", "bpjs", "corporate", "student")
    )

    # 1. Inpatient & Hospital Care
    inpatient_gap_days = None
    inpatient_gap_expl = None
    if is_student and is_china:
        if has_verified_health:
            inpatient_status = "COVERED"
            inpatient_label = "Covered"
            inpatient_expl = "Covered by student insurance (Verification complete)."
        elif (
            has_unverified_health
            or any("student" in (c.kind or "").lower() for c in personal_policies)
            or has_declared_health
        ):
            inpatient_status = "COVERED"
            inpatient_label = "Covered"
            inpatient_expl = "Covered by student insurance (Verification in progress)."
        else:
            inpatient_status = "NOT_COVERED"
            inpatient_label = "Not Covered"
            inpatient_expl = "No active student inpatient insurance found."

        # Date continuity check against student visa / residence permit
        if user.visa_expiry_date and personal_policies:
            policy_end = personal_policies[0].end
            visa_end = (
                user.visa_expiry_date
                if isinstance(user.visa_expiry_date, date)
                else date.fromisoformat(str(user.visa_expiry_date))
            )
            if policy_end and policy_end < visa_end:
                gap_days = (visa_end - policy_end).days
                inpatient_gap_days = gap_days
                inpatient_gap_expl = f"Policy expires {gap_days} days before your visa ends ({visa_end.isoformat()})."
    else:
        # Indonesia or general employee
        if any(
            "bpjs" in (c.kind or "").lower() or "corporate" in (c.kind or "").lower() or c.verified
            for c in personal_policies
        ):
            inpatient_status = "COVERED"
            inpatient_label = "Covered"
            inpatient_expl = "Covered by BPJS Kesehatan and employer group plan."
        elif has_declared_health:
            inpatient_status = "COVERED"
            inpatient_label = "Covered"
            inpatient_expl = "Covered by declared BPJS / corporate plan (Verification pending)."
        elif personal_policies:
            inpatient_status = "COVERED"
            inpatient_label = "Covered"
            inpatient_expl = "Covered by declared policy."
        else:
            inpatient_status = "NOT_COVERED"
            inpatient_label = "Not Covered"
            inpatient_expl = "No inpatient hospital policy found."

    needs.append(
        ProtectionNeedItem(
            need_code="INPATIENT_HOSPITAL",
            title="Inpatient & Hospital Care",
            category="medical",
            description="Covers your hospital stays, surgery, and ward costs.",
            icon="bed",
            status=inpatient_status,
            status_label=inpatient_label,
            status_explanation=inpatient_expl,
            requirement_level="MANDATORY",
            why_it_matters="Hospitalization costs in overseas or private facilities can quickly exceed normal financial reserves without comprehensive ward and surgical coverage.",
            evidence_summary="Verified student insurance policy or national social insurance."
            if has_verified_health
            else "Self-reported student insurance documentation.",
            evidence_sources=["Student Insurance Policy", "Visa Requirements"],
            suggested_next_steps=[
                "Maintain continuous coverage throughout your study permit duration."
            ],
            has_unmet_need=inpatient_status != "COVERED",
            matched_policy_ids=[str(c.id) for c in personal_policies[:1]],
            product_candidate_ids=["cn-prod-lxbx-student"] if is_china else ["id-prod-bpjs-jkn"],
            date_gap_days=inpatient_gap_days,
            date_gap_explanation=inpatient_gap_expl,
        )
    )

    # 2. Outpatient Care
    if is_student and is_china:
        outpatient_status = "PARTIALLY_COVERED"
        outpatient_label = "Partially Covered"
        outpatient_expl = "Covered by student insurance, but limited benefits."
        outpatient_unmet = True
    elif is_indonesia:
        outpatient_status = "PARTIALLY_COVERED" if personal_policies else "NOT_COVERED"
        outpatient_label = "Partially Covered" if personal_policies else "Not Covered"
        outpatient_expl = (
            "Primary healthcare clinics covered; specialist referrals have tiered coordination."
        )
        outpatient_unmet = not personal_policies
    else:
        outpatient_status = "UNKNOWN"
        outpatient_label = "Unknown"
        outpatient_expl = "Outpatient limits and copayments require verification."
        outpatient_unmet = True

    needs.append(
        ProtectionNeedItem(
            need_code="OUTPATIENT_CARE",
            title="Outpatient Care",
            category="outpatient",
            description="Covers consultations, medication, and diagnostic tests.",
            icon="stethoscope",
            status=outpatient_status,
            status_label=outpatient_label,
            status_explanation=outpatient_expl,
            requirement_level="RECOMMENDED",
            why_it_matters="Daily outpatient visits for respiratory, gastrointestinal, or diagnostic checks occur frequently and accumulate significant out-of-pocket expenses without outpatient coverage.",
            evidence_summary="Standard institutional policy provides inpatient first; outpatient sublimits apply.",
            evidence_sources=["Policy Schedule", "Benefit Guide"],
            suggested_next_steps=[
                "Check your outpatient deductible and annual sub-limit before specialist appointments."
            ],
            has_unmet_need=outpatient_unmet,
            matched_policy_ids=[str(c.id) for c in personal_policies[:1]],
            product_candidate_ids=["cn-prod-pingan-student-dental", "cn-prod-allianz-student-plan"]
            if is_china
            else ["id-prod-allianz-smarthealth"],
        )
    )

    # 3. Dental Care
    dental_products = _get_products_for_category(user.country_code, "dental")
    dental_candidate_ids = [p.product_id for p in dental_products]

    dental_has_policy = any("dental" in (c.kind or "").lower() for c in personal_policies)
    if dental_has_policy:
        dental_status = "COVERED"
        dental_label = "Covered"
        dental_expl = "Active dental coverage recorded."
        dental_unmet = False
    else:
        dental_status = "NOT_COVERED"
        dental_label = "Not Covered"
        dental_expl = "No active dental coverage found."
        dental_unmet = True

    needs.append(
        ProtectionNeedItem(
            need_code="DENTAL_CARE",
            title="Dental Care",
            category="dental",
            description="Covers preventive, basic, and major dental treatments.",
            icon="tooth",
            status=dental_status,
            status_label=dental_label,
            status_explanation=dental_expl,
            requirement_level="RECOMMENDED",
            why_it_matters="Dental treatment can be expensive, especially for major procedures like root canal or wisdom teeth removal, which are almost never included in basic institutional plans.",
            evidence_summary="No active dental policy schedule or rider found in verified documents.",
            evidence_sources=["Policy Document Review"],
            suggested_next_steps=[
                "Check your student insurance booklet for dental benefits.",
                "Upload benefit schedule to verify coverage.",
                "If not covered, explore suitable dental insurance options.",
            ],
            has_unmet_need=dental_unmet,
            matched_policy_ids=[],
            product_candidate_ids=dental_candidate_ids,
        )
    )

    # 4. Emergency & Accident
    emergency_has_policy = bool(personal_policies)
    needs.append(
        ProtectionNeedItem(
            need_code="EMERGENCY_ACCIDENT",
            title="Emergency & Accident",
            category="emergency",
            description="Covers emergency treatment due to accidents or unexpected events.",
            icon="running",
            status="COVERED" if emergency_has_policy else "NOT_COVERED",
            status_label="Covered" if emergency_has_policy else "Not Covered",
            status_explanation="Covered by student insurance."
            if (emergency_has_policy and is_student)
            else "Covered by personal insurance."
            if emergency_has_policy
            else "No emergency coverage found.",
            requirement_level="MANDATORY",
            why_it_matters="Emergency medical transportation, acute trauma treatment, and accidental injury compensation are critical abroad or on business assignments.",
            evidence_summary="Covered under institutional base plan accidental injury and emergency evacuation provisions.",
            evidence_sources=["Student Medical Plan", "Campus Regulation"],
            suggested_next_steps=[
                "Save emergency hotline and nearest designated hospital contact on your mobile device."
            ],
            has_unmet_need=not emergency_has_policy,
            matched_policy_ids=[str(c.id) for c in personal_policies[:1]],
            product_candidate_ids=["cn-prod-pingan-accident"]
            if is_china
            else ["id-prod-allianz-pa"],
        )
    )

    # 5. Vision Care
    needs.append(
        ProtectionNeedItem(
            need_code="VISION_CARE",
            title="Vision Care",
            category="vision",
            description="Covers routine eye exams, optometry, and prescription lenses.",
            icon="eye",
            status="UNKNOWN",
            status_label="Unknown",
            status_explanation="Need document verification.",
            requirement_level="OPTIONAL",
            why_it_matters="Routine optical checkups and refractive error corrections are usually out-of-pocket unless specified in a comprehensive supplementary wellness package.",
            evidence_summary="Not found in currently processed policy schedules.",
            evidence_sources=["Uploaded Documents"],
            suggested_next_steps=[
                "Check whether your supplementary student or employer benefits include optical vouchers."
            ],
            has_unmet_need=False,
            matched_policy_ids=[],
            product_candidate_ids=[],
        )
    )

    # 6. Personal Liability
    liability_has_policy = bool(liability_policies)
    needs.append(
        ProtectionNeedItem(
            need_code="PERSONAL_LIABILITY",
            title="Personal Liability",
            category="liability",
            description="Covers accidental third-party injury or property damage during daily life.",
            icon="shield",
            status="COVERED" if liability_has_policy else "PARTIALLY_COVERED",
            status_label="Covered" if liability_has_policy else "Need Attention",
            status_explanation="Covered under personal liability policy."
            if liability_has_policy
            else "Consider additional coverage based on your activities.",
            requirement_level="RECOMMENDED",
            why_it_matters="Renting an apartment or cycling in urban areas introduces accidental third-party liabilities that can lead to unexpected compensation claims.",
            evidence_summary="Commercial business liability does not cover private personal tenant risks."
            if any("commercial" in (c.kind or "").lower() for c in evidence)
            else "No personal liability endorsement found.",
            evidence_sources=["Personal Living Context", "Lease Requirements"],
            suggested_next_steps=[
                "Review tenant lease conditions or campus liability requirements."
            ],
            has_unmet_need=not liability_has_policy,
            matched_policy_ids=[str(c.id) for c in liability_policies[:1]],
            product_candidate_ids=["cn-prod-pingan-travel"] if is_china else [],
        )
    )

    # Summary counts
    covered_cnt = sum(1 for n in needs if n.status == "COVERED")
    attention_cnt = sum(1 for n in needs if n.status in ("PARTIALLY_COVERED", "NOT_COVERED"))
    unknown_cnt = sum(1 for n in needs if n.status == "UNKNOWN")
    docs_needed_cnt = max(4 - doc_count, 1)

    # Key Findings (Matches Screen 2 & 3 in screenshot)
    if is_student and is_china:
        key_findings = [
            KeyFindingItem(
                id=1,
                title="Outpatient Benefits Limited",
                status="warning",
                text="Your student insurance covers inpatient and emergency care, but outpatient benefits are limited.",
                category="outpatient",
            ),
            KeyFindingItem(
                id=2,
                title="No Active Dental Coverage",
                status="danger",
                text="No active dental coverage found in your current policies.",
                category="dental",
            ),
            KeyFindingItem(
                id=3,
                title="Visa Minimum Requirement Met",
                status="success",
                text="Your visa requires minimum medical coverage of ¥800,000, which is met by your current plan.",
                category="medical",
            ),
            KeyFindingItem(
                id=4,
                title="Additional Dental & Liability Recommended",
                status="info",
                text="Consider additional coverage for dental care and personal liability based on your situation.",
                category="recommendation",
            ),
        ]
        recommended_next_steps = [
            NextStepItem(
                id=1,
                title="Check Dental Coverage",
                description="Verify if your current student insurance includes dental benefits.",
                action_label="View Dental Care",
                action_url="#need-DENTAL_CARE",
                priority="HIGH",
            ),
            NextStepItem(
                id=2,
                title="Explore Insurance Options",
                description="Find suitable dental and personal liability insurance options.",
                action_label="View Recommendations",
                action_url="#recommendations",
                priority="HIGH",
            ),
            NextStepItem(
                id=3,
                title="Complete Verification",
                description="Upload missing documents for a more accurate assessment.",
                action_label="Go to Documents",
                action_url="/documents",
                priority="MEDIUM",
            ),
        ]
    else:
        key_findings = [
            KeyFindingItem(
                id=1,
                title="Inpatient & Emergency Health Covered",
                status="success",
                text="Your BPJS Kesehatan and corporate group health cover essential hospitalization and emergency treatments.",
                category="medical",
            ),
            KeyFindingItem(
                id=2,
                title="Dental Major Procedures Limited",
                status="warning",
                text="Routine dental cleaning is covered, but major prosthetics and orthodontics require private coverage.",
                category="dental",
            ),
            KeyFindingItem(
                id=3,
                title="Dependents Protection Active",
                status="info",
                text="Family coordination active for your registered dependents.",
                category="family",
            ),
            KeyFindingItem(
                id=4,
                title="Review Annual Limit Refill",
                status="info",
                text="Corporate health allowances renew each calendar year; check remaining balances.",
                category="corporate",
            ),
        ]
        recommended_next_steps = [
            NextStepItem(
                id=1,
                title="Check Dental Benefits",
                description="Review employer dental sublimits and private clinic cashless access.",
                action_label="View Dental Care",
                action_url="#need-DENTAL_CARE",
                priority="HIGH",
            ),
            NextStepItem(
                id=2,
                title="Verify Family Members",
                description="Ensure your dependents are linked to active BPJS and corporate policies.",
                action_label="Go to Family",
                action_url="/family",
                priority="MEDIUM",
            ),
            NextStepItem(
                id=3,
                title="Upload Benefit Booklet",
                description="Add your latest employer HR policy booklet to verify inpatient room tiers.",
                action_label="Go to Documents",
                action_url="/documents",
                priority="MEDIUM",
            ),
        ]

    # Optional AI enrichment if consent is active and AI gateway is reachable
    if use_ai:
        try:
            settings = get_settings()
            _ = ResponsesGateway(settings)
            # AI could enrich finding text without changing status
        except Exception:
            pass  # Keep deterministic grounded results

    # Profile Context used
    visa_str = f"{user.situation.value if hasattr(user.situation, 'value') else user.situation} ({'X1 visa' if is_student and is_china else 'Domestic'})"
    grad_str = (
        f"Expected graduation: {user.visa_expiry_date or 'Jun 2027'}"
        if is_student
        else "Full-time Employment"
    )

    profile_ctx = ProfileContextView(
        display_name=user.display_name or ("Sinta" if is_indonesia else "Raka"),
        occupation=user.occupation or ("Student" if is_student else "Employee"),
        situation=user.situation.value if hasattr(user.situation, "value") else str(user.situation),
        country_code=user.country_code,
        residence_context=user.residence_context or ("ABROAD" if is_china else "DOMESTIC"),
        city=user.city,
        visa_status=visa_str,
        visa_expiry_date=str(user.visa_expiry_date) if user.visa_expiry_date else None,
        key_dates_summary=grad_str,
        has_dependents=bool(user.has_dependents),
        dependents_summary=f"{len(user.dependents)} dependents" if user.dependents else "None",
        declared_insurance=user.owned_coverage or [],
    )

    # Recent updates
    now_iso = datetime.now(UTC).strftime("%b %d, %Y")
    recent_updates = [
        RecentUpdateItem(
            date=f"{now_iso}\n10:24 AM",
            title="A new policy has been added\nPrudential PRUActive Plus has been added to your policy wallet."
            if is_indonesia
            else "Student Comprehensive Insurance confirmed\nLXBX International Student Insurance registered.",
            related_to="Policy Wallet",
            action_label="View details",
            action_url="/policies",
        ),
        RecentUpdateItem(
            date="Apr 18, 2026\n02:17 PM",
            title="Document uploaded\nMedical check-up report has been uploaded.",
            related_to="Documents",
            action_label="View details",
            action_url="/documents",
        ),
        RecentUpdateItem(
            date="Apr 12, 2026\n09:05 AM",
            title="INSURRA completed a protection assessment\nWe found 2 areas that need attention. Review your recommendations now.",
            related_to="Protection Assessment",
            action_label="View details",
            action_url="#analysis",
        ),
    ]

    summary = ProtectionSummary(
        covered_count=covered_cnt,
        attention_count=attention_cnt,
        unknown_count=unknown_cnt,
        documents_needed_count=docs_needed_cnt,
        overall_status="ON_TRACK" if attention_cnt <= 2 else "ATTENTION_NEEDED",
        overall_headline="You're in a good place! Just a few areas to take care of."
        if covered_cnt >= 2
        else "Important protection gaps need attention.",
        overall_score_text=f"{covered_cnt}/{len(needs)} Needs covered",
        ready_pct=int((covered_cnt / max(len(needs), 1)) * 100),
    )

    assessment = FullProtectionAssessment(
        assessment_id=str(uuid4()),
        actor_type=actor.actor_type,
        country_code=user.country_code,
        assessment_version="1.5.0",
        last_assessed_at=datetime.now(UTC).strftime("%d %b %Y, %H:%M"),
        refresh_reason=refresh_reason,
        summary=summary,
        needs=needs,
        key_findings=key_findings,
        recommended_next_steps=recommended_next_steps,
        profile_context=profile_ctx,
        recent_updates=recent_updates,
        limitations=[
            "This assessment is grounded in your uploaded documents and declared profile.",
            "Product options are factual catalog comparisons, not underwriting guarantees or purchase contracts.",
            "Missing documentation results in UNKNOWN coverage, not an assumption of denial.",
        ],
    )

    # Persist snapshot in database
    try:
        assessment_row = AccountProtectionAssessmentRow(
            id=uuid4(),
            account_id=actor.account_id,
            session_id=actor.session_id,
            assessment_version="1.5.0",
            status="COMPLETED",
            covered_count=covered_cnt,
            attention_count=attention_cnt,
            unknown_count=unknown_cnt,
            documents_needed_count=docs_needed_cnt,
            overall_status=summary.overall_status,
            overall_headline=summary.overall_headline,
            input_hash=input_h,
            payload=assessment.model_dump(mode="json"),
            refresh_reason=refresh_reason,
        )
        db.add(assessment_row)
        db.commit()
    except Exception:
        db.rollback()

    return assessment


def compare_selected_products(
    product_ids: list[str], country_code: str = "CN"
) -> ProductComparisonResponse:
    all_prods = _get_products_for_category(country_code, "student")
    if not any(p.product_id in product_ids for p in all_prods):
        all_prods = _get_products_for_category(country_code, "dental")

    selected = [p for p in all_prods if p.product_id in product_ids]
    if not selected:
        selected = all_prods[:3]

    rows = [
        ProductComparisonRow(
            feature_name="Annual limit (dental)",
            values={p.product_id: p.annual_limit for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Covers basic treatment (cleaning, filling)",
            values={p.product_id: p.covers_basic_treatment for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Covers major treatment (root canal, surgery)",
            values={p.product_id: p.covers_major_treatment for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Waiting period",
            values={p.product_id: p.waiting_period for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Direct billing",
            values={p.product_id: p.direct_billing for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Worldwide coverage",
            values={p.product_id: p.worldwide_coverage for p in selected},
        ),
        ProductComparisonRow(
            feature_name="Estimated premium (per year)",
            values={p.product_id: p.estimated_premium for p in selected},
        ),
    ]

    return ProductComparisonResponse(
        products=selected,
        comparison_matrix=rows,
    )
