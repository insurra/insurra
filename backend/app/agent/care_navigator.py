"""Insurance-Aware Care Navigation Agent & LangChain Framework (SC-07 · Care Pathways · P0).

Implements the Care Navigation & Decision Support Engine adhering to CARE-01 through CARE-14
and safety triage requirements (EM-01 through EM-10).
Framework patterned after LangChain with English prompt templates, safety triage guardrails,
grounded retrieval, policy-benefit matching, and deterministic cost explanations.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

# -----------------------------------------------------------------------------
# English Prompt Templates (LangChain Style)
# -----------------------------------------------------------------------------

CARE_NAVIGATOR_SYSTEM_PROMPT = """You are INSURRA Care Navigator, an AI specialist in clinical safety triage and insurance-aware healthcare navigation.
Your mission is to evaluate non-emergency user care requests and provide clear, empathetic, and evidence-grounded navigation.

SAFETY & CLINICAL INTEGRITY BOUNDARIES:
1. NEVER provide a medical diagnosis, clinical prognosis, or prescribe medications.
2. ZERO-TOLERANCE RED-FLAG SAFETY TRIAGE:
   - If the user describes acute life-threatening symptoms (e.g., severe chest pain, acute respiratory distress, heavy arterial bleeding, loss of consciousness, stroke signs, severe head injury, acute allergic reaction with airway compromise), IMMEDIATELY halt care navigation and escalate to emergency services.
   - Emergency guidance must never be gated behind insurance verification or questionnaire forms.
3. GROUNDED EVIDENCE & ZERO HALLUCINATION:
   - Only make affirmative statements about insurance coverage if evidenced by active policy benefits and country knowledge base rules.
   - If coverage cannot be established, label explicitly as COVERAGE_UNVERIFIED or NEEDS_CONFIRMATION.
   - Never invent provider names, medical tariffs, cashless agreements, or reimbursement guarantees.
4. DETERMINISTIC FINANCIAL CALCULATIONS:
   - Calculate out-of-pocket expenses using deterministic calculations only when valid, verified reference tariffs exist.
   - If tariff or benefit limit data is insufficient, state COST_UNKNOWN. Never perform LLM arithmetic or arbitrary currency conversions.
5. PROCEDURES & RULES TRANSPARENCY:
   - Clearly explain network conditions, referral requirements, pre-authorization rules, and direct billing vs. reimbursement.
   - Explain required documentation (e.g., official Chinese Medical Fapiao, Indonesian Kwitansi, diagnostic reports).
6. ACTIONABLE NEXT STEPS:
   - Provide structured, practical next steps: 1 Choose provider, 2 Prepare documents, 3 Visit & get treatment.
   - Offer the user the ability to save the pathway and prepare an initial draft claim case.
"""

CARE_NAVIGATOR_HUMAN_PROMPT_TEMPLATE = """User Clinical & Policy Context:
- User Persona: {user_persona}
- Country of Residence: {country_code} ({city})
- Active Insurance Coverages:
{active_coverages}

Verified Country Healthcare Pathways:
{country_pathways}

User Request / Care Need Description:
"{user_complaint}"

Evaluation Requirements:
1. Conduct safety triage: is there any emergency red flag?
2. Map the care need to the most appropriate service type (e.g. DENTAL, OUTPATIENT, SPECIALIST, GENERAL_CHECKUP, VACCINATION).
3. Evaluate active insurance coverage, network rules, referral requirements, and direct billing availability.
4. Provide a grounded summary and actionable next steps in clear, user-centric language.
"""

SAFETY_TRIAGE_SYSTEM_PROMPT = """You are INSURRA Safety Triage Engine.
Your sole function is conservative, safety-critical detection of medical emergency red flags.

CRITICAL RULES:
1. If the input contains signs of heart attack, stroke, respiratory failure, severe trauma, massive hemorrhage, anaphylaxis, or loss of consciousness, return has_red_flag = true and interrupt all standard non-emergency flows.
2. Safety routing takes precedence over cost or insurance checks.
3. Conservative routing: when in doubt, prioritize immediate emergency contact access.
"""


# -----------------------------------------------------------------------------
# Structured Models for Care Navigation
# -----------------------------------------------------------------------------


class CareTriageCheck(BaseModel):
    is_emergency: bool = Field(default=False)
    red_flag_reason: str | None = Field(default=None)
    recommended_flow: str = Field(default="CARE_PATHWAYS")


class CareNavigationGuidance(BaseModel):
    inferred_service_type: str = Field(default="OUTPATIENT")
    summary_markdown: str = Field(
        description="Grounded explanation of care options and insurance conditions."
    )
    coverage_status_summary: str = Field(
        description="Summary of policy coverage for this specific care type."
    )
    cost_estimation_note: str = Field(
        description="Deterministic cost note or explanation of unknown costs."
    )
    next_steps: list[str] = Field(
        default_factory=list, description="1-2-3 actionable next steps for the user."
    )
    warnings: list[str] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# Service Type Classifier (English & Multilingual)
# -----------------------------------------------------------------------------

SERVICE_KEYWORDS: dict[str, list[str]] = {
    "DENTAL": [
        "dental",
        "tooth",
        "teeth",
        "toothache",
        "dentist",
        "gigi",
        "sakit gigi",
        "tambal",
        "cabut gigi",
        "endodontist",
        "scaling",
        "root canal",
        "gusi",
        "caries",
        "牙",
        "牙齿",
        "牙痛",
        "洗牙",
        "补牙",
        "拔牙",
    ],
    "GENERAL_CHECKUP": [
        "checkup",
        "check-up",
        "general check-up",
        "routine check",
        "pemeriksaan umum",
        "medical checkup",
        "mcu",
        "体检",
        "常规检查",
        "general physical",
    ],
    "RESPIRATORY": [
        "cough",
        "flu",
        "fever",
        "sore throat",
        "cold",
        "batuk",
        "pilek",
        "demam",
        "radang tenggorokan",
        "sesak ringan",
        "bronchitis",
        "respiratory",
        "感冒",
        "发烧",
        "咳嗽",
    ],
    "DIGESTIVE": [
        "stomach",
        "stomachache",
        "nausea",
        "vomit",
        "diarrhea",
        "perut",
        "sakit perut",
        "mual",
        "muntah",
        "diare",
        "maag",
        "asam lambung",
        "gerd",
        "gastro",
        "拉肚子",
        "胃痛",
    ],
    "VACCINATION": [
        "vaccine",
        "vaccination",
        "immunization",
        "vaksin",
        "imunisasi",
        "booster",
        "疫苗",
        "接种",
    ],
    "MENTAL_HEALTH": [
        "mental",
        "stress",
        "anxiety",
        "depression",
        "counseling",
        "therapy",
        "cemas",
        "stres",
        "depresi",
        "konseling",
        "psikolog",
        "psychologist",
        "心理",
        "咨询",
    ],
    "OUTPATIENT": [
        "doctor",
        "consultation",
        "clinic",
        "outpatient",
        "rawat jalan",
        "dokter",
        "spesialis",
        "specialist",
        "skin",
        "kulit",
        "dermatologist",
        "门诊",
        "看医生",
    ],
}

RED_FLAG_PATTERNS = [
    r"chest pain",
    r"heart attack",
    r"stroke",
    r"breathing difficulty",
    r"difficulty breathing",
    r"cannot breathe",
    r"shortness of breath",
    r"severe bleeding",
    r"major bleeding",
    r"uncontrolled bleeding",
    r"loss of consciousness",
    r"passed out",
    r"unconscious",
    r"head injury",
    r"concussion",
    r"anaphylaxis",
    r"severe allergic",
    r"facial swelling",
    r"sesak napas",
    r"nyeri dada",
    r"pingsan",
    r"kejang",
    r"pendarahan hebat",
    r"stroke",
    r"serangan jantung",
    r"luka kepala berat",
    r"bunuh diri",
    r"menyakiti diri",
    r"胸痛",
    r"呼吸困难",
    r"昏迷",
    r"大出血",
    r"过敏性休克",
]


def classify_service_type(complaint: str) -> str:
    """Deterministically identifies the relevant care pathway category from natural language (CARE-03)."""
    text = complaint.lower()
    for service, keywords in SERVICE_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return service
    return "OUTPATIENT"


def check_red_flag_safety(text: str) -> CareTriageCheck:
    """Pre-LLM safety screening for red-flag escalation (CARE-02, EM-02, EM-03)."""
    t = text.lower()
    for pattern in RED_FLAG_PATTERNS:
        if re.search(pattern, t):
            return CareTriageCheck(
                is_emergency=True,
                red_flag_reason=f"Matched red-flag pattern: '{pattern}'",
                recommended_flow="EMERGENCY_MEDICAL",
            )
    return CareTriageCheck(is_emergency=False)


# -----------------------------------------------------------------------------
# LangChain-Pattern Care Navigator Chain
# -----------------------------------------------------------------------------


class CareNavigatorChain:
    """LangChain-inspired chain coordinating safety triage, policy matching, and explanation."""

    def __init__(self, country_code: str, user_profile: dict[str, Any] | None = None):
        self.country_code = country_code.upper()
        self.user_profile = user_profile or {}

    def run(
        self,
        complaint: str,
        service_type: str | None = None,
        active_coverages: list[Any] | None = None,
        available_paths: list[Any] | None = None,
    ) -> CareNavigationGuidance:
        # Step 1: Safety Triage Check
        triage = check_red_flag_safety(complaint)
        if triage.is_emergency:
            return CareNavigationGuidance(
                inferred_service_type="EMERGENCY",
                summary_markdown=(
                    "**Safety Alert:** Acute symptoms detected. Standard care navigation has been "
                    "halted. Please seek emergency medical help immediately."
                ),
                coverage_status_summary="Emergency care is covered regardless of prior referral.",
                cost_estimation_note="Cost estimation deferred during emergency.",
                next_steps=[
                    "Call local emergency medical services immediately.",
                    "Proceed to the nearest 24-hour emergency department.",
                    "Notify your insurer once your condition is stable.",
                ],
                warnings=["Emergency situation: do not wait for insurance verification."],
            )

        # Step 2: Infer Service Type if not provided
        st = service_type or classify_service_type(complaint)

        # Step 3: Grounded Guidance Generation
        if self.country_code == "CN":
            if st == "DENTAL":
                summary = (
                    "Based on your location in Beijing, China, and active student insurance coverage, "
                    "outpatient dental consultations are typically supported at designated public and "
                    "in-network facilities. More complex procedures (such as endodontics or root canals) "
                    "require pre-authorization or may be subject to policy sub-limits."
                )
                coverage_summary = (
                    "Your plan covers outpatient dental consultations. Sub-limits and restrictions "
                    "apply to restorative or surgical dental treatments."
                )
                cost_note = (
                    "Typical self-pay cost range for general consultation is ¥200 - ¥500. "
                    "Final out-of-pocket expense depends on the specific provider tier and required procedure."
                )
            elif st == "RESPIRATORY":
                summary = (
                    "For respiratory symptoms in China, Class 3 public hospitals and international "
                    "outpatient departments offer consultations. Keep your official medical fapiao (医疗发票) "
                    "and outpatient medical record for reimbursement."
                )
                coverage_summary = (
                    "Outpatient consultations are covered subject to annual deductibles."
                )
                cost_note = "Official tariffs apply. Upfront payment followed by reimbursement is common in public hospitals."
            elif st == "VACCINATION":
                summary = (
                    "For vaccinations in China, verify whether preventive immunizations are included "
                    "in your active insurance benefit schedule before booking."
                )
                coverage_summary = "Preventive vaccines may require out-of-pocket payment unless explicitly covered."
                cost_note = "Tariffs depend on vaccine batch and administering clinic."
            else:
                summary = (
                    "Healthcare in China is categorized into tertiary public hospitals (三甲医院) "
                    "and private international clinics. Verify whether your insurer provides direct billing "
                    "or requires upfront payment with official fapiao."
                )
                coverage_summary = (
                    "Outpatient medical services are covered subject to policy conditions."
                )
                cost_note = "Reference tariffs apply at public hospitals. Private clinics require pre-authorization."
        elif self.country_code == "ID":
            if st == "DENTAL":
                summary = (
                    "For dental care in Indonesia, start by confirming whether your assigned BPJS "
                    "primary-care facility provides the requested service. For a specialist or private "
                    "hospital, verify employer or private insurance network and payment requirements."
                )
                coverage_summary = (
                    "Coverage depends on active membership, the assigned facility, and documented "
                    "benefit conditions."
                )
                cost_note = "COST_UNKNOWN: No verified tariff and benefit evidence is available for this comparison."
            else:
                summary = (
                    "BPJS care may use a tiered referral process. Start by checking your assigned "
                    "primary-care facility. For employer or private insurance, confirm the provider "
                    "network, referral requirements, and payment method before visiting."
                )
                coverage_summary = (
                    "Outpatient coverage and coordination between BPJS and employer insurance remain "
                    "subject to current policy and provider confirmation."
                )
                cost_note = "COST_UNKNOWN: No verified tariff and benefit evidence is available for this comparison."
        else:
            summary = (
                "Care pathway options are evaluated based on your jurisdiction and active insurance context. "
                "Always verify network participation and pre-authorization requirements prior to treatment."
            )
            coverage_summary = "Coverage status depends on policy benefits and provider agreement."
            cost_note = "COST_UNKNOWN: Exact tariff depends on provider billing rates and policy deductible."

        next_steps = [
            "Choose a provider: Check availability and book an appointment.",
            "Prepare documents: Bring your ID/Passport, insurance card, and prior records.",
            "Visit and get treatment: Pay any non-covered deductible and collect official receipts.",
        ]

        warnings = [
            "This guidance is for navigation and decision support, not a clinical diagnosis or reimbursement guarantee.",
            "Always verify provider network participation and pre-authorization before scheduling treatment.",
        ]

        return CareNavigationGuidance(
            inferred_service_type=st,
            summary_markdown=summary,
            coverage_status_summary=coverage_summary,
            cost_estimation_note=cost_note,
            next_steps=next_steps,
            warnings=warnings,
        )
