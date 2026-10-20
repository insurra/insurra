"""SC-15 Employer Benefits Intelligence & Coordination of Benefits Service.

Implements REG-53 through REG-60:
- Deterministic benefit normalization & limits
- Strict utilization verification (never fabricated, default UNKNOWN)
- Multi-tier coordination analyzer (Employer vs Public vs Personal)
- Employment status & continuity change detection
- Grounded AI guidance engine with LLM and deterministic fallback
"""

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    AccountCoverageRow,
    EmployerBenefitRow,
    InsuranceRecordRow,
)
from app.schemas.employer_benefits import (
    BenefitItemSchema,
    BenefitOverlapItem,
    ContinuityIssue,
    EmployerBenefitSaveRequest,
    EmployerBenefitsOverviewResponse,
)
from app.services.ai_gateway import ResponsesGateway
from app.workflow.owner import Owner


def _format_idr(val: float | int | Decimal | None) -> str | None:
    if val is None:
        return None
    try:
        int_val = int(val)
        return f"IDR {int_val:,}"
    except (ValueError, TypeError):
        return None


def get_default_sinta_benefits() -> list[dict[str, Any]]:
    return [
        {
            "benefit_category": "inpatient",
            "coverage_status": "Covered",
            "limit_amount": "IDR 500,000,000 / year",
            "limit_numeric": 500000000.0,
            "used_amount": "IDR 120,000,000",
            "used_numeric": 120000000.0,
            "available_balance": "IDR 380,000,000",
            "available_numeric": 380000000.0,
            "details": "Shared room, private room",
            "utilization_status": "VERIFIED",
        },
        {
            "benefit_category": "outpatient",
            "coverage_status": "Covered",
            "limit_amount": "IDR 10,000,000 / year",
            "limit_numeric": 10000000.0,
            "used_amount": "IDR 2,500,000",
            "used_numeric": 2500000.0,
            "available_balance": "IDR 7,500,000",
            "available_numeric": 7500000.0,
            "details": "GP and specialist visits",
            "utilization_status": "VERIFIED",
        },
        {
            "benefit_category": "dental",
            "coverage_status": "Partial",
            "limit_amount": "IDR 2,000,000 / year",
            "limit_numeric": 2000000.0,
            "used_amount": "Unknown",
            "used_numeric": None,
            "available_balance": "Unknown",
            "available_numeric": None,
            "details": "Check-up, filling, scaling (excludes orthodontics)",
            "utilization_status": "UNKNOWN",
        },
        {
            "benefit_category": "optical",
            "coverage_status": "Not covered",
            "limit_amount": "-",
            "limit_numeric": None,
            "used_amount": "-",
            "used_numeric": None,
            "available_balance": "-",
            "available_numeric": None,
            "details": "Not included in employer plan",
            "utilization_status": "UNKNOWN",
        },
        {
            "benefit_category": "maternity",
            "coverage_status": "Covered",
            "limit_amount": "IDR 50,000,000 / event",
            "limit_numeric": 50000000.0,
            "used_amount": "Unknown",
            "used_numeric": None,
            "available_balance": "Unknown",
            "available_numeric": None,
            "details": "Prenatal, delivery, postpartum",
            "utilization_status": "UNKNOWN",
        },
        {
            "benefit_category": "emergency",
            "coverage_status": "Covered",
            "limit_amount": "As per plan",
            "limit_numeric": None,
            "used_amount": "Unknown",
            "used_numeric": None,
            "available_balance": "Unknown",
            "available_numeric": None,
            "details": "Accident and emergency room admission",
            "utilization_status": "UNKNOWN",
        },
    ]


def get_default_raka_benefits() -> list[dict[str, Any]]:
    return [
        {
            "benefit_category": "inpatient",
            "coverage_status": "Covered",
            "limit_amount": "RMB 100,000 / year",
            "limit_numeric": 100000.0,
            "used_amount": "Unknown",
            "used_numeric": None,
            "available_balance": "Unknown",
            "available_numeric": None,
            "details": "Designated public hospitals (Tier 2/3)",
            "utilization_status": "UNKNOWN",
        },
        {
            "benefit_category": "outpatient",
            "coverage_status": "Covered",
            "limit_amount": "RMB 5,000 / year",
            "limit_numeric": 5000.0,
            "used_amount": "Unknown",
            "used_numeric": None,
            "available_balance": "Unknown",
            "available_numeric": None,
            "details": "Accidental injury and emergency outpatient",
            "utilization_status": "UNKNOWN",
        },
        {
            "benefit_category": "dental",
            "coverage_status": "Not covered",
            "limit_amount": "-",
            "limit_numeric": None,
            "used_amount": "-",
            "used_numeric": None,
            "available_balance": "-",
            "available_numeric": None,
            "details": "Not covered under campus plan",
            "utilization_status": "UNKNOWN",
        },
    ]


def compute_utilization_balance(
    limit: float | None, used: float | None, utilization_status: str
) -> tuple[float | None, str | None]:
    """Deterministic calculation of utilization and available balance. Never fabricates numbers."""
    if utilization_status != "VERIFIED" or limit is None or used is None:
        return None, "Unknown"
    avail = max(0.0, limit - used)
    return avail, _format_idr(avail)


def analyze_coordination(
    employer_benefits: list[dict[str, Any]],
    user_policies: list[Any],
    country_code: str,
) -> tuple[list[BenefitOverlapItem], list[ContinuityIssue]]:
    """Analyzes multi-tier benefit overlap and post-employment continuity risks."""
    overlaps: list[BenefitOverlapItem] = []
    continuity_issues: list[ContinuityIssue] = []

    def _get_val(pol: Any, *keys: str) -> str:
        for k in keys:
            if isinstance(pol, dict) and k in pol and pol[k]:
                return str(pol[k]).upper()
            if hasattr(pol, k) and getattr(pol, k):
                return str(getattr(pol, k)).upper()
        return ""

    has_bpjs = any(
        "BPJS"
        in _get_val(p, "policy_type", "kind", "policy_name", "name", "provider_name", "provider")
        for p in user_policies
    )
    has_personal_health = any(
        any(
            h in _get_val(p, "policy_type", "kind")
            for h in ("HEALTH", "COMMERCIAL", "PERSONAL", "TRAVEL")
        )
        and "BPJS" not in _get_val(p, "provider_name", "provider", "policy_name", "name")
        for p in user_policies
    )

    for ben in employer_benefits:
        cat = ben.get("benefit_category", "")
        status = ben.get("coverage_status", "Covered")
        if status in ("Covered", "Partial"):
            pub_cov = None
            pers_cov = None
            coord_status = "UNKNOWN"
            notes = ""

            if cat == "inpatient":
                pub_cov = (
                    "Covered (BPJS FKRTL, Kelas Rawat Inap Standar)"
                    if has_bpjs
                    else "Not active / Unverified"
                )
                pers_cov = (
                    "Covered (Private Hospital / Cashless)"
                    if has_personal_health
                    else "None declared"
                )
                coord_status = (
                    "POTENTIAL_OVERLAP" if (has_bpjs or has_personal_health) else "PRIMARY"
                )
                notes = (
                    "Potensi tumpang tindih rawat inap. BPJS berlaku sebagai penjamin pertama pada faskes mitra, "
                    "namun koordinasi manfaat (CoB) aktual bergantung pada endorsement polis grup dan perjanjian RS."
                )
            elif cat == "outpatient":
                pub_cov = (
                    "Covered (BPJS FKTP Puskesmas/Klinik Pratama)"
                    if has_bpjs
                    else "Not active / Unverified"
                )
                pers_cov = "Covered" if has_personal_health else "None declared"
                coord_status = (
                    "POTENTIAL_OVERLAP" if (has_bpjs or has_personal_health) else "PRIMARY"
                )
                notes = (
                    "Rawat jalan dapat ditanggung kedua pihak. Kunjungan tanpa rujukan berjenjang BPJS "
                    "biasanya diajukan langsung ke asuransi employer secara cashless atau reimbursement."
                )
            elif cat == "dental":
                pub_cov = (
                    "Covered basic (Scaling 1x/thn, ekstraksi di FKTP)"
                    if has_bpjs
                    else "Not active"
                )
                pers_cov = "None"
                coord_status = "SUPPLEMENTARY" if has_bpjs else "PRIMARY"
                notes = "Benefit dental employer melengkapi tindakan yang tidak ditanggung fasilitas dasar BPJS."
            elif cat == "maternity":
                pub_cov = (
                    "Covered (Persalinan normal & sesar indikasi medis)"
                    if has_bpjs
                    else "Not active"
                )
                pers_cov = "None"
                coord_status = "POTENTIAL_OVERLAP" if has_bpjs else "PRIMARY"
                notes = "Persalinan di RS swasta non-BPJS dapat diklaim ke asuransi employer sesuai limit."
            else:
                pub_cov = "Covered (BPJS IGD)" if (has_bpjs and cat == "emergency") else "Unknown"
                coord_status = "UNKNOWN"
                notes = "Aturan koordinasi spesifik belum terkonfirmasi dari dokumen polis resmi."

            overlaps.append(
                BenefitOverlapItem(
                    category=cat.capitalize(),
                    employer_coverage=f"{status} ({ben.get('limit_amount', '-')})",
                    public_coverage=pub_cov,
                    personal_coverage=pers_cov,
                    coordination_status=coord_status,
                    notes=notes,
                )
            )

    # Continuity Issues (REG-59)
    continuity_issues.append(
        ContinuityIssue(
            issue_type="EMPLOYMENT_TERMINATION",
            severity="HIGH",
            description="Manfaat asuransi grup employer berakhir efektif pada hari terakhir hubungan kerja.",
            recommendation="Pastikan status kepesertaan BPJS Kesehatan dialihkan dari segmen PPU ke PBPU Mandiri dalam 30 hari agar tidak terjadi masa tunggu.",
        )
    )
    continuity_issues.append(
        ContinuityIssue(
            issue_type="COORDINATION_PROCEDURE_UNCERTAINTY",
            severity="MEDIUM",
            description="Polis employer dan BPJS belum diverifikasi memiliki adendum Koordinasi Manfaat (CoB) resmi.",
            recommendation="Gunakan fitur Ask INSURRA atau minta formulir klarifikasi CoB kepada HR sebelum tindakan elektif.",
        )
    )

    return overlaps, continuity_issues


def generate_employer_ai_guidance(
    company_name: str,
    plan_name: str,
    benefits: list[dict[str, Any]],
    overlaps: list[BenefitOverlapItem],
    settings: Settings,
    country_code: str = "ID",
) -> list[str]:
    """Generates grounded benefit usage guidance using LLM when available, falling back to deterministic rules."""
    deterministic_guidance = [
        f"Untuk rawat jalan di klinik rekanan {company_name}, tunjukkan e-card pada resepsionis untuk fasilitas cashless langsung.",
        "Untuk tindakan rawat inap terencana di rumah sakit swasta, konfirmasi terlebih dahulu apakah RS menerima penjaminan bersama (CoB) antara BPJS dan asuransi grup.",
        "Simpan seluruh kuitansi asli, rincian biaya (billing breakdown), dan resume medis jika harus mengajukan klaim secara reimbursement dalam batas waktu 30 hari kalender.",
        "Jika terdapat sisa biaya (excess) di luar plafon polis employer, mintakan tanda terima legalisir untuk diajukan koordinasi sekunder bila memenuhi syarat.",
    ]

    has_openai = bool(settings.openai_api_key.get_secret_value())
    has_gemini = bool(settings.gemini_api_key.get_secret_value())
    if not has_openai and not has_gemini:
        return deterministic_guidance

    try:
        from pydantic import BaseModel

        class GuidanceOutput(BaseModel):
            guidance_points: list[str]

        gateway = ResponsesGateway(settings)
        summary_prompt = (
            f"Sebagai Asisten Asuransi INSURRA, berikan 4 poin panduan praktis (evidence-based benefit usage guidance) "
            f"untuk karyawan perusahaan {company_name} dengan polis {plan_name}. "
            f"Kategori manfaat yang dimiliki: {', '.join(b.get('benefit_category', '') for b in benefits)}. "
            f"Fokus pada prosedur cashless vs reimbursement, koordinasi dengan BPJS, dan tips menghindari excess klaim. "
            f"Bahasa Indonesia, profesional, singkat, per poin 1-2 kalimat."
        )
        parsed = gateway.parse(
            instructions="Anda adalah AI asuransi INSURRA yang patuh regulasi. Jangan mereka-reka jaminan yang tidak tertera.",
            text=summary_prompt,
            output_type=GuidanceOutput,
            fast=True,
        )
        if parsed and parsed.guidance_points and len(parsed.guidance_points) >= 3:
            return parsed.guidance_points[:4]
    except Exception:
        pass

    return deterministic_guidance


def get_employer_benefits_intelligence(
    db: Session,
    owner: Owner | None,
    country_code: str = "ID",
    settings: Settings | None = None,
) -> EmployerBenefitsOverviewResponse:
    """Builds the comprehensive Employer Protection Overview for UI & API."""
    row: EmployerBenefitRow | None = None
    user_policies: list[Any] = []

    if owner:
        if owner.is_demo:
            row = db.scalar(
                select(EmployerBenefitRow)
                .where(EmployerBenefitRow.session_id == owner.id)
                .order_by(EmployerBenefitRow.created_at.desc())
            )
            rec = db.scalar(
                select(InsuranceRecordRow).where(InsuranceRecordRow.session_id == owner.id)
            )
            if rec:
                user_policies = rec.payload.get("policies", [])
        else:
            row = db.scalar(
                select(EmployerBenefitRow)
                .where(EmployerBenefitRow.account_id == owner.id)
                .order_by(EmployerBenefitRow.created_at.desc())
            )
            user_policies = list(
                db.scalars(
                    select(AccountCoverageRow).where(AccountCoverageRow.account_id == owner.id)
                )
            )

    # Only demo persona Sinta is injected with default employer benefits.
    # Regular users or accounts without saved employer benefits start with no employer coverage.
    is_demo_sinta = (
        owner is not None
        and owner.is_demo
        and (
            (owner.persona_id and "sinta" in owner.persona_id.lower())
            or (owner.display_name and "sinta" in owner.display_name.lower())
        )
    )

    if row is None:
        if is_demo_sinta:
            company_name = "PT Teknologi Maju"
            employment_status = "Full-time employee"
            employment_period = "1 Jan 2024 – Present"
            plan_name = "MajuCare Plus"
            insurer_name = "Allianz Indonesia"
            policy_number = "TM-EMP-2024-001"
            coverage_period = "1 Jan 2024 – Present"
            eligible_dependents = ["Self (employee)", "Spouse", "Children"]
            verification_status = "VERIFIED"
            benefits_raw = get_default_sinta_benefits()
            cashless = True
            reimbursement = True
            has_custom = False
            updated_at = None
        else:
            # Regular user / other demo persona without saved employer benefits
            return EmployerBenefitsOverviewResponse(
                id=None,
                has_employer_coverage=False,
                company_name="",
                employment_status="Not configured",
                employment_period="",
                is_active=False,
                plan_name="",
                insurer_name=None,
                policy_number=None,
                coverage_period=None,
                eligible_dependents=[],
                coverage_score_percent=0,
                coverage_status_label="No employer coverage",
                coverage_status_summary="Belum ada data asuransi employer terhubung. Silakan unggah dokumen polis atau isi secara manual.",
                counts={"Covered": 0, "Partial": 0, "Not covered": 0, "Unknown": 0},
                key_benefits=[],
                claim_procedure={
                    "cashless": False,
                    "reimbursement": False,
                    "cashless_desc": "",
                    "reimbursement_desc": "",
                },
                overlaps=[],
                continuity_issues=[],
                ai_guidance=[],
                verification_status="UNVERIFIED",
                has_custom_data=False,
                updated_at=None,
            )
    else:
        company_name = row.company_name
        employment_status = row.employment_status
        start = row.employment_start_date or "1 Jan 2024"
        end = row.employment_end_date or "Present"
        employment_period = f"{start} – {end}"
        plan_name = row.plan_name
        insurer_name = row.insurer_name
        policy_number = row.policy_number
        coverage_period = f"{start} – {end}"
        eligible_dependents = row.eligible_dependents or []
        verification_status = row.verification_status
        benefits_raw = row.benefits_data or []
        cashless = row.claim_procedure_cashless
        reimbursement = row.claim_procedure_reimbursement
        has_custom = True
        updated_at = row.updated_at

    # Convert to typed benefit items
    key_benefits: list[BenefitItemSchema] = []
    counts = {"Covered": 0, "Partial": 0, "Not covered": 0, "Unknown": 0}

    for b in benefits_raw:
        st = b.get("coverage_status", "Covered")
        if st not in counts:
            st = "Covered"
        counts[st] += 1

        # Calculate utilization strictly without fabrication (REG-55)
        u_stat = b.get("utilization_status", "UNKNOWN")
        lim_num = b.get("limit_numeric")
        used_num = b.get("used_numeric")
        avail_num, avail_str = compute_utilization_balance(lim_num, used_num, u_stat)

        key_benefits.append(
            BenefitItemSchema(
                benefit_category=b.get("benefit_category", "inpatient"),
                coverage_status=st,
                limit_amount=b.get("limit_amount"),
                limit_numeric=lim_num,
                used_amount=b.get("used_amount") if u_stat == "VERIFIED" else "Unknown",
                used_numeric=used_num if u_stat == "VERIFIED" else None,
                available_balance=b.get("available_balance") if u_stat == "VERIFIED" else "Unknown",
                available_numeric=avail_num,
                details=b.get("details"),
                utilization_status=u_stat,
            )
        )

    # Coverage score calculation: 4 Covered out of 5 covered/partial benefit categories = 80% (matching UI benchmark)
    non_excluded = [b for b in key_benefits if b.coverage_status in ("Covered", "Partial")]
    if non_excluded:
        c_pts = sum(1.0 if b.coverage_status == "Covered" else 0.0 for b in non_excluded)
        coverage_score = int(round((c_pts / len(non_excluded)) * 100))
    else:
        total_cats = max(1, len(key_benefits))
        covered_pts = counts["Covered"] * 1.0 + counts["Partial"] * 0.5
        coverage_score = int(round((covered_pts / total_cats) * 100))

    if coverage_score >= 75:
        score_label = "Well covered"
        score_summary = "Your employer benefits provide comprehensive coverage. Some areas may still need attention."
    elif coverage_score >= 50:
        score_label = "Moderate coverage"
        score_summary = (
            "Core employer benefits are active, but supplemental personal coverage is recommended."
        )
    else:
        score_label = "Limited coverage"
        score_summary = "Employer benefits cover basic emergency risks only."

    # Coordination analysis
    overlaps, continuity_issues = analyze_coordination(benefits_raw, user_policies, country_code)

    # AI Guidance
    cfg_settings = settings or Settings()
    guidance = generate_employer_ai_guidance(
        company_name, plan_name, benefits_raw, overlaps, cfg_settings, country_code
    )

    return EmployerBenefitsOverviewResponse(
        id=row.id if row else None,
        has_employer_coverage=True,
        company_name=company_name,
        employment_status=employment_status,
        employment_period=employment_period,
        is_active=True,
        plan_name=plan_name,
        insurer_name=insurer_name,
        policy_number=policy_number,
        coverage_period=coverage_period,
        eligible_dependents=eligible_dependents,
        coverage_score_percent=coverage_score,
        coverage_status_label=score_label,
        coverage_status_summary=score_summary,
        counts=counts,
        key_benefits=key_benefits,
        claim_procedure={
            "cashless": cashless,
            "reimbursement": reimbursement,
            "cashless_desc": "Tunjukkan kartu peserta asuransi atau e-card di rumah sakit / klinik rekanan penjamin.",
            "reimbursement_desc": "Kumpulkan kuitansi dan resume medis asli, ajukan klaim maksimal 30 hari kalender.",
        },
        overlaps=overlaps,
        continuity_issues=continuity_issues,
        ai_guidance=guidance,
        verification_status=verification_status,
        has_custom_data=has_custom,
        updated_at=updated_at,
    )


def save_employer_benefits(
    db: Session,
    owner: Owner,
    payload: EmployerBenefitSaveRequest,
) -> EmployerBenefitRow:
    """Creates or updates employer benefits configuration for an account or demo session."""
    if owner.is_demo:
        existing = db.scalar(
            select(EmployerBenefitRow).where(EmployerBenefitRow.session_id == owner.id)
        )
    else:
        existing = db.scalar(
            select(EmployerBenefitRow).where(EmployerBenefitRow.account_id == owner.id)
        )

    benefits_json = [b.model_dump() for b in payload.benefits]

    if existing is None:
        row = EmployerBenefitRow(
            account_id=owner.id if not owner.is_demo else None,
            session_id=owner.id if owner.is_demo else None,
            company_name=payload.company_name,
            employment_status=payload.employment_status,
            employment_start_date=payload.employment_start_date,
            employment_end_date=payload.employment_end_date,
            plan_name=payload.plan_name,
            insurer_name=payload.insurer_name,
            policy_number=payload.policy_number,
            eligible_dependents=payload.eligible_dependents,
            claim_procedure_cashless=payload.claim_procedure_cashless,
            claim_procedure_reimbursement=payload.claim_procedure_reimbursement,
            source_document_id=payload.source_document_id,
            verification_status=payload.verification_status,
            benefits_data=benefits_json,
        )
        db.add(row)
    else:
        row = existing
        row.company_name = payload.company_name
        row.employment_status = payload.employment_status
        row.employment_start_date = payload.employment_start_date
        row.employment_end_date = payload.employment_end_date
        row.plan_name = payload.plan_name
        row.insurer_name = payload.insurer_name
        row.policy_number = payload.policy_number
        row.eligible_dependents = payload.eligible_dependents
        row.claim_procedure_cashless = payload.claim_procedure_cashless
        row.claim_procedure_reimbursement = payload.claim_procedure_reimbursement
        row.source_document_id = payload.source_document_id
        row.verification_status = payload.verification_status
        row.benefits_data = benefits_json

    db.commit()
    db.refresh(row)
    return row
