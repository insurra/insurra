"""Idempotent seed data for Family Protection (SC-18) in demo sessions.

Seeds realistic household profiles and linked policies for Sinta Dewi and Raka Pratama.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.account_data import FamilyMemberRow, FamilyPolicyLinkRow


def seed_demo_family_for_session(
    db: Session,
    session_id: UUID,
    persona_id: str,
    persona_name: str = "Demo User",
) -> None:
    now = datetime.now(UTC)

    # Clean existing rows for this session if any
    existing_members = db.scalars(
        select(FamilyMemberRow).where(FamilyMemberRow.session_id == session_id)
    ).all()
    for m in existing_members:
        db.execute(delete(FamilyPolicyLinkRow).where(FamilyPolicyLinkRow.family_member_id == m.id))
        db.delete(m)
    db.flush()

    if persona_id == "sinta":
        # 1. Sinta Dewi (Primary)
        sinta = FamilyMemberRow(
            id=uuid4(),
            session_id=session_id,
            account_id=None,
            name="Sinta Dewi",
            relation="Primary",
            birth_date="1994-05-12",
            is_primary=True,
            gender="Female",
            occupation="Employee",
            notes="Primary employee at PT Teknologi Maju.",
            avatar_url="/avatars/sinta.png",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={"scope": ["HEALTH", "CLAIMS", "ELIGIBILITY"], "verified": True},
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(sinta)
        db.flush()

        # Sinta's 3 linked policies
        p_tm_sinta = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=sinta.id,
            policy_ref="pol-tm-group-001",
            policy_name="PT Teknologi Maju - Group Health Insurance",
            provider_name="PT Teknologi Maju",
            policy_type="EMPLOYER_GROUP",
            policy_number_masked="TM-GRP-2026-***",
            coverage_role="PRIMARY",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Comprehensive employer group health policy covering employee and dependents.",
            benefit_details={
                "inpatient": {"covered": True, "limit": "IDR 150,000,000"},
                "outpatient": {"covered": True, "limit": "IDR 25,000,000"},
                "dental": {"covered": True, "limit": "IDR 5,000,000"},
                "optical": {"covered": True, "has_limit": False, "limit": "IDR 3,000,000"},
                "maternity": {"covered": True, "limit": "IDR 30,000,000"},
                "emergency": {"covered": True, "limit": "Full emergency admission"},
            },
            created_at=now,
            updated_at=now,
        )
        p_bpjs_sinta = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=sinta.id,
            policy_ref="pol-bpjs-001",
            policy_name="BPJS Kesehatan JKN-KIS",
            provider_name="BPJS Kesehatan",
            policy_type="PUBLIC_HEALTH",
            policy_number_masked="000188923****",
            coverage_role="PRIMARY",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Universal statutory health coverage for primary care and hospital referrals.",
            benefit_details={
                "inpatient": {"covered": True},
                "outpatient": {"covered": True},
                "emergency": {"covered": True},
            },
            created_at=now,
            updated_at=now,
        )
        p_travel_sinta = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=sinta.id,
            policy_ref="pol-allianz-trv-001",
            policy_name="Allianz TravelPro & Personal Accident",
            provider_name="Allianz",
            policy_type="TRAVEL",
            policy_number_masked="ALZ-TRV-2026-***",
            coverage_role="PRIMARY",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Regional travel insurance with emergency accidental coverage.",
            benefit_details={"emergency": {"covered": True}},
            created_at=now,
            updated_at=now,
        )
        db.add_all([p_tm_sinta, p_bpjs_sinta, p_travel_sinta])

        # 2. Andi (Spouse)
        andi = FamilyMemberRow(
            id=uuid4(),
            session_id=session_id,
            account_id=None,
            name="Andi",
            relation="Spouse",
            birth_date="1992-08-20",
            is_primary=False,
            gender="Male",
            occupation="Employee",
            notes="Spouse of Sinta Dewi.",
            avatar_url="/avatars/andi.png",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={"scope": ["HEALTH", "CLAIMS"], "verified": True},
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(andi)
        db.flush()

        p_tm_andi = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=andi.id,
            policy_ref="pol-tm-group-001",
            policy_name="PT Teknologi Maju - Group Health Insurance",
            provider_name="PT Teknologi Maju",
            policy_type="EMPLOYER_GROUP",
            policy_number_masked="TM-GRP-2026-***",
            coverage_role="SPOUSE",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Dependent spouse coverage under employer group plan.",
            benefit_details={
                "inpatient": {"covered": True},
                "outpatient": {"covered": True},
                "dental": {"covered": True},
                "optical": {"covered": True, "has_limit": False},
                "emergency": {"covered": True},
            },
            created_at=now,
            updated_at=now,
        )
        p_bpjs_andi = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=andi.id,
            policy_ref="pol-bpjs-002",
            policy_name="BPJS Kesehatan JKN-KIS",
            provider_name="BPJS Kesehatan",
            policy_type="PUBLIC_HEALTH",
            policy_number_masked="000188924****",
            coverage_role="SPOUSE",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Statutory JKN coverage as family member.",
            benefit_details={
                "inpatient": {"covered": True},
                "outpatient": {"covered": True},
                "emergency": {"covered": True},
            },
            created_at=now,
            updated_at=now,
        )
        db.add_all([p_tm_andi, p_bpjs_andi])

        # 3. Alya (Child - 6 years old)
        alya = FamilyMemberRow(
            id=uuid4(),
            session_id=session_id,
            account_id=None,
            name="Alya",
            relation="Child",
            birth_date="2020-04-15",
            is_primary=False,
            gender="Female",
            occupation=None,
            notes="Daughter of Sinta Dewi, age 6.",
            avatar_url="/avatars/alya.png",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={
                "scope": ["HEALTH", "ELIGIBILITY"],
                "guardian_consent": True,
                "verified": True,
            },
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(alya)
        db.flush()

        p_tm_alya = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=alya.id,
            policy_ref="pol-tm-group-001",
            policy_name="PT Teknologi Maju - Group Health Insurance",
            provider_name="PT Teknologi Maju",
            policy_type="EMPLOYER_GROUP",
            policy_number_masked="TM-GRP-2026-***",
            coverage_role="CHILD",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Covers inpatient, outpatient, emergency, and optical (limited)",
            benefit_details={
                "inpatient": {"covered": True, "notes": "Private room tier"},
                "outpatient": {"covered": True, "notes": "Network clinics cashless"},
                "dental": {"covered": False, "notes": "Excluded from child dependent tier"},
                "optical": {
                    "covered": True,
                    "has_limit": True,
                    "notes": "Limited coverage (annual limit applies)",
                },
                "maternity": {"covered": False, "notes": "Not applicable"},
                "emergency": {"covered": True, "notes": "24/7 ER cashless"},
            },
            created_at=now,
            updated_at=now,
        )
        db.add(p_tm_alya)

        # 4. Bima (Child - 2 years old)
        bima = FamilyMemberRow(
            id=uuid4(),
            session_id=session_id,
            account_id=None,
            name="Bima",
            relation="Child",
            birth_date="2024-06-10",
            is_primary=False,
            gender="Male",
            occupation=None,
            notes="Son of Sinta Dewi, age 2.",
            avatar_url="/avatars/bima.png",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={
                "scope": ["HEALTH", "ELIGIBILITY"],
                "guardian_consent": True,
                "verified": True,
            },
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(bima)
        db.flush()

        p_tm_bima = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=bima.id,
            policy_ref="pol-tm-group-001",
            policy_name="PT Teknologi Maju - Group Health Insurance",
            provider_name="PT Teknologi Maju",
            policy_type="EMPLOYER_GROUP",
            policy_number_masked="TM-GRP-2026-***",
            coverage_role="CHILD",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Covers inpatient, outpatient, and emergency care for toddler.",
            benefit_details={
                "inpatient": {"covered": True},
                "outpatient": {"covered": True},
                "emergency": {"covered": True},
            },
            created_at=now,
            updated_at=now,
        )
        db.add(p_tm_bima)

    elif persona_id == "raka":
        # Raka (Student in Shenzhen, China - Primary personal protection)
        raka = FamilyMemberRow(
            id=uuid4(),
            session_id=session_id,
            account_id=None,
            name="Raka Pratama",
            relation="Primary",
            birth_date="2002-03-14",
            is_primary=True,
            gender="Male",
            occupation="Student in Shenzhen",
            notes="International postgraduate student at Shenzhen University.",
            avatar_url="/avatars/raka.png",
            authorization_status="AUTHORIZED",
            consent_confirmed=True,
            consent_details={"scope": ["HEALTH", "STUDY_ABROAD"], "verified": True},
            consent_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(raka)
        db.flush()

        p_pingan = FamilyPolicyLinkRow(
            id=uuid4(),
            family_member_id=raka.id,
            policy_ref="pol-pingan-001",
            policy_name="Ping An International Student Medical Insurance",
            provider_name="Ping An Health",
            policy_type="STUDENT",
            policy_number_masked="PA-STU-2026-***",
            coverage_role="PRIMARY",
            status="ACTIVE",
            verification_status="VERIFIED",
            coverage_summary="Mandatory comprehensive insurance for international students in China.",
            benefit_details={
                "inpatient": {"covered": True, "limit": "RMB 400,000"},
                "outpatient": {"covered": True, "limit": "RMB 20,000 with deductible"},
                "emergency": {"covered": True},
                "dental": {"covered": True},
                "optical": {"covered": True, "has_limit": False},
            },
            created_at=now,
            updated_at=now,
        )
        db.add(p_pingan)

    db.commit()
