"""Private document ingestion and evidence review for authenticated accounts."""

import hashlib
from datetime import UTC, datetime
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, select

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
    AccountDocumentDetail,
    AccountDocumentSummary,
    AccountField,
    AccountFieldUpdate,
    AccountUploadResult,
    Deleted,
    DeleteRequest,
)
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

router = APIRouter(prefix="/account", tags=["Authenticated documents"])


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


@router.get("/documents", response_model=list[AccountDocumentSummary])
def list_documents(db: DB, account: ActiveAccount):
    return [
        document_summary(row)
        for row in db.scalars(
            select(AccountDocumentRow)
            .where(AccountDocumentRow.account_id == account.id)
            .order_by(AccountDocumentRow.created_at.desc())
        )
    ]


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
    for page in pages:
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
    return AccountDocumentDetail(
        **document_summary(row),
        fields=[field_result(field) for field in fields],
        pages=[
            {"page_no": page.page_no, "text": page.text, "ocr_used": page.ocr_used}
            for page in pages
        ],
    )


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
    db.commit()
    db.refresh(row)
    return field_result(row)


@router.delete("/documents/{document_id}", response_model=Deleted)
def delete_document(document_id: UUID, body: DeleteRequest, db: DB, account: ActiveAccount):
    row = _owned_document(db, account.id, document_id)
    db.execute(delete(AccountFieldRow).where(AccountFieldRow.document_id == row.id))
    db.execute(delete(AccountDocumentPageRow).where(AccountDocumentPageRow.document_id == row.id))
    db.execute(delete(AccountCoverageRow).where(AccountCoverageRow.document_id == row.id))
    db.delete(row)
    audit(db, account.id, "DOCUMENT_DELETED", document_id=str(document_id))
    db.commit()
    return Deleted(deleted=True)
