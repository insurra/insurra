"""Deterministic personal protection plan and catalog candidate matching."""

from datetime import date

from app.schemas.consent import ConsentPurpose
from app.schemas.profile import Situation
from app.schemas.protection_plan import (
    EligibilityState,
    EvidenceBasis,
    PersonalProtectionPlan,
    ProductCandidate,
    ProtectionFinding,
    ProtectionFindingStatus,
)
from app.services.workspace import coverages, grants, profile
from app.workflow import kbdata


def _contains(values: list[str], *needles: str) -> bool:
    normalized = " ".join(values).casefold()
    return any(needle.casefold() in normalized for needle in needles)


def _finding(code, title, status, reason, basis, category, next_step):
    return ProtectionFinding(
        code=code,
        title=title,
        status=status,
        reason=reason,
        evidence_basis=basis,
        category=category,
        next_step=next_step,
    )


def _catalog_candidates(country_code: str, gaps: set[str], today: date) -> list[ProductCandidate]:
    companies = {item.get("insurer_id"): item for item in kbdata.companies(country_code)}
    result = []
    for product in kbdata.products(country_code):
        category = product.get("product_category")
        if category not in gaps or product.get("product_status") != "ACTIVE":
            continue
        if product.get("effective_to") and product["effective_to"] < today.isoformat():
            continue
        source_url = product.get("product_url")
        if not isinstance(source_url, str) or not source_url.startswith("https://"):
            continue
        company = companies.get(product.get("insurer_id"), {})
        verified = (
            product.get("verification_status") == "VERIFIED"
            and product.get("evidence_class") == "RETRIEVED_OFFICIAL"
            and bool(product.get("retrieval_artifact_sha256"))
        )
        limitations = [
            "Kelayakan akhir dan keputusan underwriting hanya dapat ditentukan oleh penyedia.",
            "Premi perlu diminta melalui kanal resmi penyedia."
            if not product.get("published_pricing")
            else "Harga yang dipublikasikan tetap perlu dikonfirmasi untuk profil pengguna.",
        ]
        if not verified:
            limitations.insert(
                0, "Ringkasan katalog belum diverifikasi terhadap artefak polis tersimpan."
            )
        result.append(
            ProductCandidate(
                product_id=product["product_id"],
                insurer_name=company.get("brand_name")
                or company.get("legal_entity_name")
                or product.get("insurer_id", "Provider"),
                product_name=product.get("english_name")
                or product.get("original_product_name")
                or product["product_id"],
                category=category,
                eligibility=EligibilityState.POTENTIAL_MATCH
                if verified
                else EligibilityState.UNKNOWN,
                match_reasons=[
                    "Kategori produk sesuai dengan kebutuhan perlindungan yang teridentifikasi.",
                    f"Produk dicatat untuk yurisdiksi {country_code}.",
                ],
                limitations=limitations,
                official_source_url=source_url,
                source_checked_at=product.get("checked_at"),
                verification_status="VERIFIED" if verified else "UNVERIFIED",
                pricing_available=bool(product.get("published_pricing")),
            )
        )
    return result[:6]


def build_protection_plan(db, actor, kb) -> PersonalProtectionPlan:
    user = profile(db, actor)
    current_grants = grants(db, actor)
    use_documents = bool(current_grants.get(ConsentPurpose.PROCESS_DOCUMENTS.value))
    use_health = bool(current_grants.get(ConsentPurpose.HEALTH_PROFILE.value))
    evidence = coverages(db, actor, kb) if use_documents else []
    verified_categories = {item.kind.casefold() for item in evidence if item.verified}
    declared = user.owned_coverage
    findings: list[ProtectionFinding] = []

    medical_met = bool(verified_categories) and any(
        token in " ".join(verified_categories) for token in ("medical", "health", "bpjs", "student")
    )
    if medical_met:
        medical_status = ProtectionFindingStatus.MET
        medical_reason = (
            "Bukti polis terverifikasi menunjukkan perlindungan kesehatan yang relevan."
        )
        medical_basis = [EvidenceBasis.VERIFIED_EVIDENCE]
    elif _contains(declared, "health", "medical", "bpjs", "student"):
        medical_status = ProtectionFindingStatus.NEEDS_VERIFICATION
        medical_reason = "Perlindungan kesehatan dilaporkan pengguna, tetapi manfaat dan masa aktif belum terverifikasi."
        medical_basis = [EvidenceBasis.SELF_REPORTED]
    else:
        medical_status = ProtectionFindingStatus.POTENTIAL_GAP
        medical_reason = (
            "Belum ada perlindungan kesehatan yang tercatat untuk risiko biaya perawatan utama."
        )
        medical_basis = [EvidenceBasis.PROFILE]
    findings.append(
        _finding(
            "core_medical",
            "Perlindungan kesehatan utama",
            medical_status,
            medical_reason,
            medical_basis,
            "private_medical",
            "Unggah ringkasan polis yang ada atau bandingkan kandidat produk resmi.",
        )
    )

    if user.situation == Situation.STUDENT:
        student_met = _contains(declared, "student") or any(
            "student" in category for category in verified_categories
        )
        findings.append(
            _finding(
                "student_requirement",
                "Perlindungan studi dan persyaratan kampus",
                ProtectionFindingStatus.NEEDS_VERIFICATION
                if student_met
                else ProtectionFindingStatus.POTENTIAL_GAP,
                "Skema mahasiswa perlu dicocokkan dengan ketentuan kampus dan status enrollment terbaru."
                if student_met
                else "Belum ada skema mahasiswa yang tercatat; cek ketentuan kampus sebelum memilih produk retail.",
                [EvidenceBasis.PROFILE, EvidenceBasis.SELF_REPORTED]
                if student_met
                else [EvidenceBasis.PROFILE],
                "international_student",
                "Konfirmasi enrollment, persyaratan kampus, dan sertifikat asuransi mahasiswa.",
            )
        )

    if user.has_dependents:
        life_met = _contains(declared, "life", "family")
        findings.append(
            _finding(
                "dependent_protection",
                "Perlindungan tanggungan keluarga",
                ProtectionFindingStatus.NEEDS_VERIFICATION
                if life_met
                else ProtectionFindingStatus.POTENTIAL_GAP,
                "Ada tanggungan finansial; jumlah manfaat, penerima manfaat, dan keberlanjutan pendapatan perlu ditinjau.",
                [EvidenceBasis.PROFILE],
                "life",
                "Tinjau kebutuhan biaya hidup tanggungan tanpa memasukkan nominal pendapatan persis.",
            )
        )

    exposure = bool(user.lifestyle_exposures or user.work_exposures)
    if exposure:
        accident_met = _contains(declared, "accident")
        findings.append(
            _finding(
                "activity_exposure",
                "Risiko aktivitas dan kecelakaan",
                ProtectionFindingStatus.NEEDS_VERIFICATION
                if accident_met
                else ProtectionFindingStatus.POTENTIAL_GAP,
                "Aktivitas yang dilaporkan perlu dicocokkan dengan pengecualian dan batas manfaat polis.",
                [EvidenceBasis.PROFILE],
                "personal_accident",
                "Periksa pengecualian aktivitas pada wording resmi sebelum mengambil keputusan.",
            )
        )

    if use_health and user.health_sharing_preference == "SHARE_RELEVANT":
        findings.append(
            _finding(
                "health_preferences",
                "Kebutuhan akses layanan kesehatan",
                ProtectionFindingStatus.NEEDS_VERIFICATION,
                "Preferensi kesehatan sukarela digunakan hanya untuk menandai manfaat, jaringan, masa tunggu, dan pengecualian yang perlu ditinjau; ini bukan diagnosis atau prediksi underwriting.",
                [EvidenceBasis.PROFILE],
                "private_medical",
                "Bandingkan wording dan tanyakan penyedia tentang kebutuhan akses yang Anda nyatakan.",
            )
        )

    gaps = {
        item.category for item in findings if item.status == ProtectionFindingStatus.POTENTIAL_GAP
    }
    candidates = _catalog_candidates(user.country_code, gaps, date.today())
    open_findings = sum(item.status != ProtectionFindingStatus.MET for item in findings)
    return PersonalProtectionPlan(
        country_code=user.country_code,
        health_profile_used=use_health and user.health_sharing_preference == "SHARE_RELEVANT",
        document_evidence_used=use_documents,
        findings=findings,
        product_candidates=candidates,
        overall_summary=(
            "Tidak ada kebutuhan tambahan yang teridentifikasi dari data saat ini. Tetap tinjau perubahan profil dan masa berlaku polis."
            if open_findings == 0
            else f"Ada {open_findings} area yang perlu dilengkapi atau diverifikasi sebelum keputusan pembelian."
        ),
        limitations=[
            "Hasil ini adalah panduan informasi berbasis data profil dan bukti yang tersedia.",
            "Kandidat produk bukan penawaran, persetujuan, atau jaminan dapat diasuransikan.",
            "Ketiadaan bukti tidak membuktikan bahwa suatu manfaat dikecualikan.",
        ],
    )
