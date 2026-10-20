"""Private document ingestion and evidence review for authenticated accounts."""

import hashlib
from datetime import UTC, datetime
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.v1.account_workspace import (
    account_profile,
    audit,
    consent_rows,
    document_summary,
    field_result,
    require_account_purposes,
)
from app.core.dependencies import DB, KB, ActiveAccount
from app.core.errors import AppError
from app.models import (
    AccountCoverageRow,
    AccountDocumentPageRow,
    AccountDocumentRow,
    AccountFieldRow,
)
from app.schemas.account_workspace import (
    AccountDocumentConfirm,
    AccountDocumentDetail,
    AccountDocumentSummary,
    AccountField,
    AccountFieldUpdate,
    AccountUploadResult,
    Deleted,
    DeleteRequest,
)
from app.schemas.actor import Actor, ActorType
from app.schemas.common import CompletenessStatus
from app.schemas.consent import ConsentPurpose
from app.schemas.profile import UserProfile
from app.services.account_documents import (
    MAX_UPLOAD_BYTES,
    classify_document,
    extract_text_or_ocr,
    extract_to_schema,
    remove_injection_lines,
    sniff_mime,
)
from app.services.events import dispatch
from app.services.workspace_privacy import purge_content

router = APIRouter(prefix="/account", tags=["Authenticated documents"])


def _actor(account) -> Actor:
    return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=account.id)


def _owned_document(db: DB, account_id: UUID, document_id: UUID) -> AccountDocumentRow:
    row = db.scalar(
        select(AccountDocumentRow).where(
            AccountDocumentRow.id == document_id,
            AccountDocumentRow.account_id == account_id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Dokumen tidak ditemukan.")
    return row


def _mask(value: str) -> str:
    return "•••• " + value[-4:] if len(value) >= 4 else "••••"


def _sync_coverage(db: DB, row: AccountFieldRow) -> None:
    if row.coverage_id is None or row.value is None:
        return
    coverage = db.get(AccountCoverageRow, row.coverage_id)
    if coverage is None:
        return
    value = str(row.value)
    if row.field_key in {"provider", "insurance_provider"}:
        coverage.provider = value[:200]
    elif row.field_key in {"policy_number", "member_number"}:
        coverage.policy_number_masked = _mask(value)
    elif row.field_key == "coverage_start_date":
        coverage.start_date = value
    elif row.field_key == "coverage_end_date":
        coverage.end_date = value


def _make_sample_pdf(title: str = "") -> bytes:
    try:
        import io
        from pathlib import Path

        from pypdf import PdfWriter

        # Try to use real certificate PDF from test-documents if available
        for p in [
            Path("../test-documents/shenzhen_pingan_insurance_certificate.pdf"),
            Path("test-documents/shenzhen_pingan_insurance_certificate.pdf"),
            Path("../frontend/public/sample-documents/shenzhen_pingan_insurance_certificate.pdf"),
        ]:
            if p.exists():
                return p.read_bytes()

        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()
    except Exception:
        return b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n"


def seed_account_sample_documents(
    db: Session, account_id: UUID, country_code: str = "CN", persona: str | None = None
) -> None:
    from app.models import AccountProfileRow, AccountRow

    prof = db.get(AccountProfileRow, account_id)
    acc = db.get(AccountRow, account_id)

    display_name = ""
    if prof and prof.payload:
        display_name = (prof.payload.get("display_name") or "").lower()
    if not display_name and acc and acc.display_name:
        display_name = acc.display_name.lower()

    detected_country = (
        prof.payload.get("country_code", country_code) if prof and prof.payload else country_code
    )

    target_persona = persona
    if not target_persona:
        if "sinta" in display_name or detected_country == "ID":
            target_persona = "sinta"
        elif "raka" in display_name or detected_country == "CN":
            target_persona = "raka"

    # Crucial rule: Non-demo user accounts must never have synthetic documents injected!
    if not target_persona:
        return

    now = datetime.now(UTC)
    default_pdf = _make_sample_pdf()

    if target_persona == "sinta":
        samples = [
            {
                "filename": "BPJS_Kesehatan_Card.pdf",
                "kind": "insurance_certificate",
                "size": 845200,
                "status": "VERIFIED",
                "preview": "BPJS Kesehatan · JKN\nKepesertaan Aktif",
                "fields": {
                    "provider": "BPJS Kesehatan",
                    "plan_name": "BPJS Kesehatan (JKN)",
                    "plan_type": "Jaminan Kesehatan Nasional (Kelas 1)",
                    "policy_number": "0001234567891",
                    "policyholder_name": "Sinta Dewi",
                    "insured_name": "Sinta Dewi",
                    "birth_date": "1995-04-15",
                    "coverage_start_date": "2021-01-01",
                    "coverage_end_date": "2099-12-31",
                },
                "benefits": [
                    {
                        "benefit_item": "Rawat Inap Tingkat Lanjutan (Kelas 1)",
                        "coverage_limit": "Sesuai Tarif INA-CBGs",
                        "deductible": "Rp 0",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Rawat Jalan Tingkat Pertama (FKTP)",
                        "coverage_limit": "100% Ditanggung",
                        "deductible": "Rp 0",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Pelayanan Obat & Alat Kesehatan",
                        "coverage_limit": "Sesuai Formularium Nasional",
                        "deductible": "Rp 0",
                        "source_page": 1,
                    },
                ],
                "exclusions": [
                    "Pelayanan kesehatan di faskes yang tidak bekerjasama (kecuali gawat darurat)",
                    "Pengobatan alternatif dan eksperimental yang belum terbukti ilmiah",
                    "Tindakan bedah estetika dan kosmetik tanpa indikasi medis",
                ],
                "waiting_periods": [
                    "0 hari untuk penanganan kondisi gawat darurat (UGD)",
                    "14 hari masa aktivasi kepesertaan baru Pekerja Mandiri",
                ],
                "claim_conditions": [
                    "Wajib membawa KIS / e-KTP saat berobat di Fasilitas Kesehatan Tingkat Pertama (FKTP)",
                    "Sistem rujukan berjenjang untuk pemeriksaan ke Rumah Sakit / Spesialis",
                ],
            },
            {
                "filename": "Chubb_Corporate_Health_Policy.pdf",
                "kind": "policy_document",
                "size": 1854200,
                "status": "VERIFIED",
                "preview": "Chubb Life · Corporate Plan\n1 Jan 2026 – 31 Des 2026",
                "fields": {
                    "provider": "Chubb Life Insurance",
                    "plan_name": "Corporate Group Health",
                    "plan_type": "Executive Medical Plan",
                    "policy_number": "CHB-CORP-882910",
                    "policyholder_name": "PT Digital Inovasi Nusantara",
                    "insured_name": "Sinta Dewi",
                    "birth_date": "1995-04-15",
                    "coverage_start_date": "2026-01-01",
                    "coverage_end_date": "2026-12-31",
                },
                "benefits": [
                    {
                        "benefit_item": "Rawat Inap & ICU (Kamar VIP)",
                        "coverage_limit": "Rp 500.000.000 / tahun",
                        "deductible": "Rp 0",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Rawat Jalan Spesialis & Resep Dokter",
                        "coverage_limit": "Rp 25.000.000 / tahun",
                        "deductible": "Rp 50.000 / kunjungan",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Perawatan Gigi & Kacamata",
                        "coverage_limit": "Rp 7.500.000 / tahun",
                        "deductible": "Rp 0",
                        "source_page": 1,
                    },
                ],
                "exclusions": [
                    "Kondisi penyakit bawaan yang belum melewati masa tunggu",
                    "Cedera akibat olahraga ekstrem atau partisipasi dalam demonstrasi",
                ],
                "waiting_periods": [
                    "0 hari untuk kecelakaan mendadak",
                    "30 hari untuk penyakit umum sejak tanggal efektif kepesertaan",
                    "12 bulan untuk 12 penyakit khusus (kanker, jantung, batu ginjal)",
                ],
                "claim_conditions": [
                    "Cashless di seluruh RS rekanan jaringan AdMedika / Chubb",
                    "Klaim reimbursement maksimal diajukan 30 hari kalender setelah perawatan",
                ],
            },
            {
                "filename": "KTP_Sinta_Dewi.jpg",
                "kind": "id_document",
                "size": 650000,
                "status": "VERIFIED",
                "preview": "KTP Elektronik Republik Indonesia\nNIK: 3171015504950002",
                "fields": {
                    "insured_name": "Sinta Dewi",
                    "nik": "3171015504950002",
                    "birth_date": "1995-04-15",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Employee_Medical_Benefit_Guide.pdf",
                "kind": "benefit_schedule",
                "size": 1250000,
                "status": "VERIFIED",
                "preview": "Benefit Guide 2026\nPT Digital Inovasi Nusantara",
                "fields": {
                    "provider": "PT Digital Inovasi Nusantara",
                    "plan_name": "Employee Health Benefit Guide 2026",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
        ]
    else:
        # Default Raka (CN)
        samples = [
            {
                "filename": "AIA_Student_Policy.pdf",
                "kind": "policy_document",
                "size": 2411724,
                "status": "VERIFIED",
                "preview": "AIA · Student Plan\n1 Sep 2024 – 31 Aug 2025",
                "fields": {
                    "provider": "AIA",
                    "plan_name": "AIA International Student Insurance Plan",
                    "plan_type": "Comprehensive Plan (Standard)",
                    "policy_number": "AIA-STU-2024-568923",
                    "policyholder_name": "Raka Pratama",
                    "insured_name": "Raka Pratama",
                    "birth_date": "2003-03-15",
                    "coverage_start_date": "2024-09-01",
                    "coverage_end_date": "2025-08-31",
                },
                "benefits": [
                    {
                        "benefit_item": "Inpatient Medical Expenses",
                        "coverage_limit": "RMB 1,000,000",
                        "deductible": "RMB 0",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Outpatient Medical Expenses",
                        "coverage_limit": "RMB 200,000",
                        "deductible": "RMB 300",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Emergency Medical Evacuation",
                        "coverage_limit": "RMB 500,000",
                        "deductible": "RMB 0",
                        "source_page": 1,
                    },
                    {
                        "benefit_item": "Repatriation of Remains",
                        "coverage_limit": "RMB 200,000",
                        "deductible": "RMB 0",
                        "source_page": 1,
                    },
                ],
                "exclusions": [
                    "Pre-existing medical conditions not disclosed prior to policy inception",
                    "Injuries resulting from professional or hazardous sports (paragliding, rock climbing, motorsports)",
                    "Cosmetic surgery, routine health check-ups, and dental care (unless emergency trauma)",
                ],
                "waiting_periods": [
                    "30 days waiting period for general illnesses from policy start date",
                    "0 days waiting period for accidental injuries",
                    "12 months waiting period for specified pre-existing or congenital conditions",
                ],
                "claim_conditions": [
                    "Written claim notification required within 30 days of medical event",
                    "Treatment must occur at designated public hospitals (Tier-2 or higher) or authorized network clinics",
                    "Original medical fapiao/receipt and diagnosis certificate required for reimbursement",
                ],
            },
            {
                "filename": "Insurance_Certificate.jpg",
                "kind": "insurance_certificate",
                "size": 972800,
                "status": "VERIFIED",
                "preview": "AIA · Coverage Certificate\nValid until 31 Aug 2025",
                "fields": {
                    "provider": "AIA",
                    "plan_name": "Coverage Certificate",
                    "policy_number": "AIA-STU-2024-568923",
                    "insured_name": "Raka Pratama",
                    "coverage_end_date": "2025-08-31",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Benefit_Schedule.pdf",
                "kind": "benefit_schedule",
                "size": 1468006,
                "status": "VERIFIED",
                "preview": "List of benefits\nInpatient, outpatient, evacuation",
                "fields": {
                    "provider": "AIA",
                    "plan_name": "Schedule of Benefits",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Visa_Permit.pdf",
                "kind": "visa_document",
                "size": 1153433,
                "status": "VERIFIED",
                "preview": "Student Residence Permit\nValid until 31 Jan 2028",
                "fields": {
                    "provider": "Entry-Exit Administration",
                    "plan_name": "Student Residence Permit",
                    "insured_name": "Raka Pratama",
                    "coverage_end_date": "2028-01-31",
                    "visa_expiry_date": "2028-01-31",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Sales_Offer.pdf",
                "kind": "sales_offer",
                "size": 1677721,
                "status": "NEEDS_REVIEW",
                "preview": "Quotation from AIA\nPlan comparison and pricing",
                "fields": {
                    "provider": "AIA",
                    "plan_name": "Quotation from AIA",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Hospital_Bill_Sample.pdf",
                "kind": "claim_document",
                "size": 798720,
                "status": "UNSUPPORTED",
                "preview": "Out of scope for MVP",
                "fields": {},
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Passport.pdf",
                "kind": "id_document",
                "size": 634880,
                "status": "VERIFIED",
                "preview": "Name, passport number, expiry",
                "fields": {
                    "insured_name": "Raka Pratama",
                    "passport_number": "C1234567",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
            {
                "filename": "Vaccination_Record.jpg",
                "kind": "medical_record",
                "size": 440320,
                "status": "VERIFIED",
                "preview": "Vaccination history\nCOVID-19, other vaccines",
                "fields": {
                    "insured_name": "Raka Pratama",
                },
                "benefits": [],
                "exclusions": [],
                "waiting_periods": [],
                "claim_conditions": [],
            },
        ]

    for item in samples:
        sha = hashlib.sha256(f"{account_id}-{item['filename']}".encode()).hexdigest()
        existing = db.scalar(
            select(AccountDocumentRow).where(
                AccountDocumentRow.account_id == account_id,
                AccountDocumentRow.original_filename == item["filename"],
            )
        )
        if existing:
            continue
        doc_id = uuid4()
        is_pdf = item["filename"].endswith(".pdf")
        doc = AccountDocumentRow(
            id=doc_id,
            account_id=account_id,
            country_code=detected_country,
            kind=item["kind"],
            original_filename=item["filename"],
            mime_type="application/pdf" if is_pdf else "image/jpeg",
            size_bytes=item["size"],
            sha256=sha,
            content=default_pdf
            if is_pdf
            else b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9",
            status=item["status"],
            injection_flag=False,
            created_at=now,
            processed_at=now,
        )
        db.add(doc)
        db.flush()

        coverage = None
        if item["kind"] in {"policy_document", "insurance_certificate", "benefit_schedule"}:
            coverage = AccountCoverageRow(
                id=uuid4(),
                account_id=account_id,
                document_id=doc.id,
                country_code=detected_country,
                kind=item["kind"],
                provider=item["fields"].get("provider", "AIA"),
                policy_number_masked=_mask(
                    item["fields"].get("policy_number", "AIA-STU-2024-568923")
                ),
                start_date=item["fields"].get("coverage_start_date", "2024-09-01"),
                end_date=item["fields"].get("coverage_end_date", "2025-08-31"),
                created_at=now,
            )
            db.add(coverage)
            db.flush()

        # Seed pages
        page_count = 12 if "Policy" in item["filename"] else 2
        for p in range(1, page_count + 1):
            db.add(
                AccountDocumentPageRow(
                    document_id=doc.id,
                    page_no=p,
                    text=f"Page {p} content for {item['filename']}\nProvider: {item['fields'].get('provider', '')}\nPolicy: {item['fields'].get('policy_number', '')}\nInsured: {item['fields'].get('insured_name', '')}",
                    ocr_used=False,
                )
            )

        # Seed fields
        for f_key, f_val in item["fields"].items():
            db.add(
                AccountFieldRow(
                    account_id=account_id,
                    document_id=doc.id,
                    coverage_id=coverage.id if coverage else None,
                    field_key=f_key,
                    value=f_val,
                    status=CompletenessStatus.FOUND.value,
                    confidence=0.95,
                    source_page=1,
                    source_type="DOCUMENT_EXTRACTION",
                    confirmed_by_user=item["status"] == "VERIFIED",
                    updated_at=now,
                )
            )

        # Seed structured sections if present
        for s_key, s_val in [
            ("benefits", item.get("benefits")),
            ("exclusions", item.get("exclusions")),
            ("waiting_periods", item.get("waiting_periods")),
            ("claim_conditions", item.get("claim_conditions")),
        ]:
            if s_val:
                db.add(
                    AccountFieldRow(
                        account_id=account_id,
                        document_id=doc.id,
                        coverage_id=coverage.id if coverage else None,
                        field_key=s_key,
                        value=s_val,
                        status=CompletenessStatus.FOUND.value,
                        confidence=0.95,
                        source_page=1,
                        source_type="DOCUMENT_EXTRACTION",
                        confirmed_by_user=item["status"] == "VERIFIED",
                        updated_at=now,
                    )
                )

    db.commit()


@router.get("/documents", response_model=list[AccountDocumentSummary])
def list_documents(db: DB, account: ActiveAccount, seed_sample: bool = False):
    if seed_sample:
        seed_account_sample_documents(db, account.id)
    return [
        document_summary(row, db)
        for row in db.scalars(
            select(AccountDocumentRow)
            .where(AccountDocumentRow.account_id == account.id)
            .order_by(AccountDocumentRow.created_at.desc())
        )
    ]


@router.post("/documents/seed", response_model=list[AccountDocumentSummary])
def seed_documents(db: DB, account: ActiveAccount):
    seed_account_sample_documents(db, account.id)
    return list_documents(db, account)


@router.post("/documents", response_model=AccountUploadResult, status_code=201)
async def upload_document(
    request: Request,
    db: DB,
    kb: KB,
    account: ActiveAccount,
    file: Annotated[UploadFile, File()],
    kind: Annotated[str | None, Form(max_length=100)] = None,
):
    require_account_purposes(
        db, account.id, (ConsentPurpose.PROCESS_DOCUMENTS, ConsentPurpose.EXTERNAL_AI)
    )
    profile = UserProfile.model_validate(account_profile(db, account.id).payload)
    country = kb.load(profile.country_code)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise AppError(422, "INVALID_FILE_SIZE", "Ukuran file harus 1 byte sampai 10 MB.")
    mime_type = sniff_mime(content)
    extension = PurePath((file.filename or "document").replace("\\", "/")).suffix.lower()
    expected = {
        "application/pdf": {".pdf"},
        "image/jpeg": {".jpg", ".jpeg"},
        "image/png": {".png"},
    }
    if extension not in expected[mime_type]:
        raise AppError(422, "FILE_EXTENSION_MISMATCH", "Ekstensi dan isi file tidak cocok.")
    sha256 = hashlib.sha256(content).hexdigest()
    existing = db.scalar(
        select(AccountDocumentRow).where(
            AccountDocumentRow.account_id == account.id,
            AccountDocumentRow.sha256 == sha256,
        )
    )
    if existing:
        raise AppError(409, "DUPLICATE_DOCUMENT", "Dokumen ini sudah pernah diunggah.")
    filename = PurePath((file.filename or "document").replace("\\", "/")).name[:255]
    document_kind = classify_document(kind, country, filename)
    pages = extract_text_or_ocr(content, mime_type, profile.country_code)
    patterns = [item.pattern for item in kb.load_injection_patterns().data]
    clean_pages, flagged = remove_injection_lines(pages, patterns)
    error_code = None
    extracted = []
    try:
        extracted = extract_to_schema(
            clean_pages, country, document_kind, request.app.state.settings
        ).fields
    except AppError as exc:
        error_code = exc.code
    retention = next(
        row.granted
        for row in consent_rows(db, account.id)
        if row.purpose == ConsentPurpose.RETENTION
    )
    now = datetime.now(UTC)
    document = AccountDocumentRow(
        id=uuid4(),
        account_id=account.id,
        country_code=profile.country_code,
        kind=document_kind,
        original_filename=filename,
        mime_type=mime_type,
        size_bytes=len(content),
        sha256=sha256,
        content=content if retention else None,
        language=None,
        status="FAILED" if error_code else "COMPLETED",
        injection_flag=flagged,
        error_code=error_code,
        created_at=now,
        processed_at=now,
    )
    db.add(document)
    db.flush()
    coverage = None
    if document_kind not in {"visa_grant_notice", "other"}:
        coverage = AccountCoverageRow(
            id=uuid4(),
            account_id=account.id,
            document_id=document.id,
            country_code=profile.country_code,
            kind=document_kind,
            provider=None,
            policy_number_masked=None,
            start_date=None,
            end_date=None,
            created_at=now,
        )
        db.add(coverage)
        db.flush()
    for page in pages if retention else []:
        db.add(
            AccountDocumentPageRow(
                document_id=document.id,
                page_no=page.page_no,
                text=page.text,
                ocr_used=page.ocr_used,
            )
        )
    for item in extracted:
        db.add(
            AccountFieldRow(
                account_id=account.id,
                document_id=document.id,
                coverage_id=coverage.id if coverage else None,
                field_key=item.field_key,
                value=item.value,
                previous_value=None,
                status=CompletenessStatus.UNVERIFIED.value,
                confidence=None,
                source_page=item.source_page,
                source_type="DOCUMENT_EXTRACTION",
                confirmed_by_user=False,
                updated_at=now,
            )
        )
    audit(
        db,
        account.id,
        "DOCUMENT_UPLOADED",
        document_id=str(document.id),
        page_count=len(pages),
        extracted_count=len(extracted),
    )
    if flagged:
        audit(db, account.id, "INJECTION_FLAGGED", document_id=str(document.id))
    dispatch(
        db,
        _actor(account),
        "document.uploaded",
        document.id,
        {"document_kind": document_kind, "size_bytes": len(content)},
    )
    if error_code:
        outcome_event = "document.extraction.failed"
    elif extracted:
        outcome_event = "document.review.required"
    else:
        outcome_event = "document.extraction.completed"
    dispatch(db, _actor(account), outcome_event, document.id)
    db.commit()
    return AccountUploadResult(document_id=document.id, status=document.status)


@router.get("/documents/{document_id}", response_model=AccountDocumentDetail)
def get_document(document_id: UUID, db: DB, account: ActiveAccount):
    row = _owned_document(db, account.id, document_id)
    fields = list(
        db.scalars(
            select(AccountFieldRow)
            .where(AccountFieldRow.document_id == document_id)
            .order_by(AccountFieldRow.field_key)
        )
    )
    pages = list(
        db.scalars(
            select(AccountDocumentPageRow)
            .where(AccountDocumentPageRow.document_id == document_id)
            .order_by(AccountDocumentPageRow.page_no)
        )
    )

    benefits = []
    exclusions = []
    waiting_periods = []
    claim_conditions = []
    for f in fields:
        if f.field_key == "benefits" and isinstance(f.value, list):
            benefits = f.value
        elif f.field_key == "exclusions" and isinstance(f.value, list):
            exclusions = [str(x) for x in f.value]
        elif f.field_key == "waiting_periods" and isinstance(f.value, list):
            waiting_periods = [str(x) for x in f.value]
        elif f.field_key == "claim_conditions" and isinstance(f.value, list):
            claim_conditions = [str(x) for x in f.value]

    return AccountDocumentDetail(
        **document_summary(row, db),
        fields=[field_result(field) for field in fields],
        pages=[
            {"page_no": page.page_no, "text": page.text, "ocr_used": page.ocr_used}
            for page in pages
        ],
        benefits=benefits,
        exclusions=exclusions,
        waiting_periods=waiting_periods,
        claim_conditions=claim_conditions,
    )


@router.post("/documents/{document_id}/confirm", response_model=AccountDocumentDetail)
def confirm_document(
    document_id: UUID,
    body: AccountDocumentConfirm,
    db: DB,
    account: ActiveAccount,
):
    row = _owned_document(db, account.id, document_id)
    if body.document_kind:
        row.kind = body.document_kind
    row.status = body.status
    now = datetime.now(UTC)
    row.processed_at = now

    # Update or insert key fields
    for key, val in body.fields.items():
        if val is None or val == "":
            continue
        field_row = db.scalar(
            select(AccountFieldRow).where(
                AccountFieldRow.document_id == document_id,
                AccountFieldRow.field_key == key,
            )
        )
        if field_row:
            field_row.previous_value = field_row.value
            field_row.value = val
            field_row.status = CompletenessStatus.FOUND.value
            field_row.confirmed_by_user = True
            field_row.source_type = (
                "USER_CORRECTED" if field_row.previous_value != val else "USER_CONFIRMED"
            )
            field_row.updated_at = now
            _sync_coverage(db, field_row)
        else:
            new_f = AccountFieldRow(
                account_id=account.id,
                document_id=document_id,
                field_key=key,
                value=val,
                status=CompletenessStatus.FOUND.value,
                confidence=1.0,
                source_page=1,
                source_type="USER_CONFIRMED",
                confirmed_by_user=True,
                updated_at=now,
            )
            db.add(new_f)
            _sync_coverage(db, new_f)

    # Save benefits, exclusions, waiting_periods, claim_conditions
    for key, val in [
        ("benefits", body.benefits),
        ("exclusions", body.exclusions),
        ("waiting_periods", body.waiting_periods),
        ("claim_conditions", body.claim_conditions),
        ("version_detected", body.version_detected),
    ]:
        if val:
            field_row = db.scalar(
                select(AccountFieldRow).where(
                    AccountFieldRow.document_id == document_id,
                    AccountFieldRow.field_key == key,
                )
            )
            if field_row:
                field_row.value = val
                field_row.updated_at = now
            else:
                db.add(
                    AccountFieldRow(
                        account_id=account.id,
                        document_id=document_id,
                        field_key=key,
                        value=val,
                        status=CompletenessStatus.FOUND.value,
                        confidence=1.0,
                        source_page=1,
                        source_type="USER_CONFIRMED",
                        confirmed_by_user=True,
                        updated_at=now,
                    )
                )

    # Synchronize coverage
    coverage = db.scalar(
        select(AccountCoverageRow).where(AccountCoverageRow.document_id == document_id)
    )
    if (
        coverage is None
        and row.kind not in {"claim_document", "id_document", "other"}
        and row.status == "VERIFIED"
    ):
        coverage = AccountCoverageRow(
            id=uuid4(),
            account_id=account.id,
            document_id=row.id,
            country_code=row.country_code,
            kind=row.kind,
            provider=str(body.fields.get("provider", "AIA"))[:200],
            policy_number_masked=_mask(str(body.fields.get("policy_number", ""))),
            start_date=str(body.fields.get("coverage_start_date", ""))[:10] or None,
            end_date=str(body.fields.get("coverage_end_date", ""))[:10] or None,
            created_at=now,
        )
        db.add(coverage)
    elif coverage is not None:
        if "provider" in body.fields:
            coverage.provider = str(body.fields["provider"])[:200]
        if "policy_number" in body.fields:
            coverage.policy_number_masked = _mask(str(body.fields["policy_number"]))
        if "coverage_start_date" in body.fields:
            coverage.start_date = str(body.fields["coverage_start_date"])[:10]
        if "coverage_end_date" in body.fields:
            coverage.end_date = str(body.fields["coverage_end_date"])[:10]

    audit(db, account.id, "DOCUMENT_CONFIRMED", document_id=str(document_id), status=row.status)
    dispatch(db, _actor(account), "document.verified", row.id)
    dispatch(db, _actor(account), "document.field.confirmed", row.id)
    if coverage:
        dispatch(db, _actor(account), "coverage.updated", coverage.id)
    db.commit()
    try:
        from app.agent.protection_review import run_protection_review
        from app.services.actor_scope import owner_for

        run_protection_review(
            db, owner_for(_actor(account)), trigger_reason="document.field.confirmed", force=True
        )
    except Exception:
        pass
    return get_document(document_id, db, account)


@router.get("/documents/{document_id}/file")
def get_document_file(document_id: UUID, db: DB, account: ActiveAccount):
    row = _owned_document(db, account.id, document_id)
    if row.content is None:
        raise AppError(404, "ORIGINAL_FILE_DELETED", "File asli sudah dihapus sesuai persetujuan.")
    return Response(
        row.content,
        media_type=row.mime_type,
        headers={
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "no-store",
        },
    )


@router.patch("/fields/{field_id}", response_model=AccountField)
def review_field(field_id: UUID, body: AccountFieldUpdate, db: DB, account: ActiveAccount):
    row = db.scalar(
        select(AccountFieldRow).where(
            AccountFieldRow.id == field_id,
            AccountFieldRow.account_id == account.id,
        )
    )
    if row is None:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Data tidak ditemukan.")
    if body.value is None or body.value == "":
        raise AppError(422, "EMPTY_FIELD", "Nilai data tidak boleh kosong.")
    if not isinstance(body.value, str) or len(body.value) > 500:
        raise AppError(
            422, "INVALID_FIELD_VALUE", "Isi data harus berupa teks maksimal 500 karakter."
        )
    if row.field_key.endswith("_date"):
        from datetime import date

        try:
            date.fromisoformat(body.value)
        except ValueError as exc:
            raise AppError(422, "INVALID_DATE", "Tanggal harus berformat YYYY-MM-DD.") from exc
    row.previous_value = row.value
    row.value = body.value
    row.status = CompletenessStatus.FOUND.value
    row.confirmed_by_user = True
    row.source_type = "USER_CORRECTED" if row.previous_value != row.value else "USER_CONFIRMED"
    row.updated_at = datetime.now(UTC)
    _sync_coverage(db, row)
    audit(
        db,
        account.id,
        "FIELD_REVIEWED",
        field_key=row.field_key,
        corrected=row.previous_value != row.value,
    )
    dispatch(
        db,
        _actor(account),
        "document.field.confirmed",
        row.id,
        {"dedupe_part": str(row.updated_at)},
    )
    db.commit()
    db.refresh(row)
    return field_result(row)


@router.delete("/documents/{document_id}", response_model=Deleted)
def delete_document(document_id: UUID, body: DeleteRequest, db: DB, account: ActiveAccount):
    row = _owned_document(db, account.id, document_id)
    purge_content(db, account.id)
    db.execute(delete(AccountFieldRow).where(AccountFieldRow.document_id == row.id))
    db.execute(delete(AccountDocumentPageRow).where(AccountDocumentPageRow.document_id == row.id))
    db.execute(delete(AccountCoverageRow).where(AccountCoverageRow.document_id == row.id))
    db.delete(row)
    audit(db, account.id, "DOCUMENT_DELETED", document_id=str(document_id))
    db.commit()
    return Deleted(deleted=True)
