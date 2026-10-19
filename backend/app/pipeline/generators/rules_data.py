"""Curated Deterministic Rules Generator for China and Indonesia.
Encodes verified legal requirements, visa coverage duration rules, and document completeness prerequisites.
Never use em dashes in strings or docstrings.
"""

from datetime import date

from app.pipeline.schemas.models import DeterministicRule, PipelineVerificationStatus

DETERMINISTIC_RULES: list[DeterministicRule] = [
    DeterministicRule(
        rule_id="CN-RULE-STUDENT-VISA-INSURANCE",
        country_code="CN",
        jurisdiction="CN-National",
        authority="Ministry of Education & National Immigration Administration",
        rule_type="REGULATORY_VISA_MANDATE",
        applicable_personas=["INTERNATIONAL_STUDENT"],
        applicability_conditions={
            "residence_context": "INTERNATIONAL_STUDENT",
            "study_duration": "GREATER_THAN_180_DAYS",
            "visa_category": "X1_OR_X2",
        },
        required_evidence=["DOC_INS_CERTIFICATE", "DOC_PASSPORT", "DOC_STUDENT_VISA"],
        comparison_operator="GREATER_THAN_OR_EQUAL",
        threshold_or_condition="coverage_end_date >= visa_expiry_date",
        effective_from=date(2017, 7, 1),
        effective_to=None,
        exceptions=["Short-term cultural exchange under 30 days holding tourist L visa"],
        source_ids=["CN-SRC-MOE-ORDER42", "CN-SRC-SZU"],
        verification_status=PipelineVerificationStatus.VERIFIED,
    ),
    DeterministicRule(
        rule_id="CN-RULE-FOREIGN-EMPLOYEE-SOCIAL-INSURANCE",
        country_code="CN",
        jurisdiction="CN-National",
        authority="Ministry of Human Resources and Social Security (MoHRSS)",
        rule_type="STATUTORY_EMPLOYMENT_MANDATE",
        applicable_personas=["FOREIGN_EMPLOYEE", "DOMESTIC_EMPLOYEE"],
        applicability_conditions={
            "employment_status": "EMPLOYED",
            "contract_location": "MAINLAND_CHINA",
            "work_permit_held": "TRUE",
        },
        required_evidence=[
            "DOC_WORK_PERMIT",
            "DOC_EMPLOYMENT_CONTRACT",
            "DOC_SOCIAL_SECURITY_CARD",
        ],
        comparison_operator="EQUAL",
        threshold_or_condition="employer_social_security_registration == COMPLETED",
        effective_from=date(2011, 10, 15),
        effective_to=None,
        exceptions=[
            "Citizens of countries with bilateral social security exemption treaties (e.g. Germany, Korea, Japan) for specific pension contributions"
        ],
        source_ids=["CN-SRC-MOHRSS"],
        verification_status=PipelineVerificationStatus.VERIFIED,
    ),
    DeterministicRule(
        rule_id="ID-RULE-JKN-MANDATORY-PARTICIPATION",
        country_code="ID",
        jurisdiction="ID-National",
        authority="Badan Penyelenggara Jaminan Sosial Kesehatan (BPJS Kesehatan)",
        rule_type="STATUTORY_HEALTH_SECURITY_MANDATE",
        applicable_personas=["DOMESTIC_EMPLOYEE", "SELF_EMPLOYED", "FOREIGN_EMPLOYEE"],
        applicability_conditions={
            "residency_duration": "MINIMUM_6_MONTHS",
            "legal_status": "WNI_OR_KITAS_HOLDER",
        },
        required_evidence=["DOC_JKN_CARD", "DOC_KTP_OR_KITAS"],
        comparison_operator="EQUAL",
        threshold_or_condition="jkn_membership_status == AKTIF",
        effective_from=date(2014, 1, 1),
        effective_to=None,
        exceptions=["Foreign tourists residing less than 6 months on visit visa"],
        source_ids=["ID-SRC-BPJS-KES", "ID-SRC-BPK-JDIH"],
        verification_status=PipelineVerificationStatus.VERIFIED,
    ),
    DeterministicRule(
        rule_id="ID-RULE-JKN-TIERED-REFERRAL",
        country_code="ID",
        jurisdiction="ID-National",
        authority="Kementerian Kesehatan RI & BPJS Kesehatan",
        rule_type="CARE_PATHWAY_COMPLIANCE",
        applicable_personas=["ALL_JKN_PARTICIPANTS"],
        applicability_conditions={
            "encounter_type": "ELECTIVE_SPECIALIST_CONSULTATION",
            "emergency_flag": "FALSE",
        },
        required_evidence=["DOC_REFERRAL_LETTER"],
        comparison_operator="EQUAL",
        threshold_or_condition="referral_from_fktp == VALID_AND_ACTIVE",
        effective_from=date(2014, 1, 1),
        effective_to=None,
        exceptions=[
            "Direct hospital admissions through Emergency Department (IGD) meeting emergency criteria"
        ],
        source_ids=["ID-SRC-BPJS-KES", "ID-SRC-KEMKES"],
        verification_status=PipelineVerificationStatus.VERIFIED,
    ),
]
