"""Exact, owner-scoped source validation shared by needs and policy answers."""

import re
from types import SimpleNamespace

from sqlalchemy import select

from app.core.config import ROOT
from app.models import AccountDocumentPageRow, AccountDocumentRow, DemoSessionRow
from app.repositories.session_data import insurance_row
from app.schemas.document import SourceEvidence
from app.schemas.insurance import UnifiedInsuranceRecord
from app.services.policy_guard import PolicyGuard
from app.services.workspace import grants

PLACEHOLDER_LINE = re.compile(
    r"not a policy clause, legal source, or evidence of benefits|"
    r"not a real insurer product and not an official requirement|"
    r"非真实保险产品，非官方要求|"
    r"not a real medical invoice",
    re.I,
)


def _demo_document_meta(db, session_id, document_id):
    session = db.get(DemoSessionRow, session_id)
    if session is None or not re.fullmatch(r"[a-z0-9_-]{1,50}", session.persona_id or ""):
        return None, None
    try:
        record = UnifiedInsuranceRecord.model_validate(insurance_row(db, session_id).payload)
    except Exception:
        return None, None
    doc = next((d for d in record.documents if d.id == document_id), None)
    if doc is None or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", doc.original_filename or ""):
        return None, None
    return session, doc


def document_filename(db, actor, document_id) -> str | None:
    if actor.account_id:
        row = db.scalar(
            select(AccountDocumentRow).where(
                AccountDocumentRow.id == document_id,
                AccountDocumentRow.account_id == actor.account_id,
            )
        )
        return row.original_filename if row else None
    if actor.session_id:
        _, doc = _demo_document_meta(db, actor.session_id, document_id)
        return doc.original_filename if doc else None
    return None


def retained_page(db, actor, document_id, page_no):
    if actor.account_id:
        if not grants(db, actor).get("retention"):
            return None
        row = db.scalar(
            select(AccountDocumentRow).where(
                AccountDocumentRow.id == document_id,
                AccountDocumentRow.account_id == actor.account_id,
            )
        )
        if row is None or row.content is None or row.injection_flag or row.status != "COMPLETED":
            return None
        return db.scalar(
            select(AccountDocumentPageRow).where(
                AccountDocumentPageRow.document_id == row.id,
                AccountDocumentPageRow.page_no == page_no,
            )
        )
    if actor.session_id:
        if page_no != 1 or not grants(db, actor).get("process_documents"):
            return None
        session, doc = _demo_document_meta(db, actor.session_id, document_id)
        if session is None or doc is None:
            return None
        path = ROOT / "fixtures" / session.persona_id / doc.original_filename
        if not path.is_file():
            return None
        return SimpleNamespace(
            document_id=doc.id,
            page_no=1,
            text=path.read_text(encoding="utf-8"),
            ocr_used=False,
        )
    return None


def validated_quote(db, actor, coverage, document_id, page_no, quote):
    if document_id not in coverage.document_ids or not quote or len(quote) > 2000:
        return None
    page = retained_page(db, actor, document_id, page_no)
    if page is None or quote not in page.text or PLACEHOLDER_LINE.search(quote):
        return None
    evidence = SourceEvidence(document_id=document_id, page_number=page_no, original_text=quote)
    PolicyGuard().validate_evidence_reference(evidence, set(coverage.document_ids), page.text)
    return evidence


def supports_exclusion(quote: str, terms: list[str]) -> bool:
    lower = quote.casefold()
    denial = re.search(
        r"\b(excluded|exclusion|not covered|does not cover|tidak ditanggung|dikecualikan)\b"
        r"|(?:不予赔付|不在保障范围|除外责任|不承保)",
        lower,
    )
    negated = re.search(r"\b(not|never)\s+(?:an?\s+)?(?:excluded|exclusion)\b", lower)
    return bool(denial and not negated and any(term.casefold() in lower for term in terms))
