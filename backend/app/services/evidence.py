"""Exact, owner-scoped source validation shared by needs and policy answers."""

import re

from sqlalchemy import select

from app.models import AccountDocumentPageRow, AccountDocumentRow
from app.schemas.document import SourceEvidence
from app.services.policy_guard import PolicyGuard
from app.services.workspace import grants


def retained_page(db, actor, document_id, page_no):
    if not actor.account_id or not grants(db, actor).get("retention"):
        return None
    row = db.scalar(
        select(AccountDocumentRow).where(
            AccountDocumentRow.id == document_id, AccountDocumentRow.account_id == actor.account_id
        )
    )
    if row is None or row.content is None or row.injection_flag or row.status != "COMPLETED":
        return None
    return db.scalar(
        select(AccountDocumentPageRow).where(
            AccountDocumentPageRow.document_id == row.id, AccountDocumentPageRow.page_no == page_no
        )
    )


def validated_quote(db, actor, coverage, document_id, page_no, quote):
    if document_id not in coverage.document_ids or not quote or len(quote) > 2000:
        return None
    page = retained_page(db, actor, document_id, page_no)
    if page is None or quote not in page.text:
        return None
    evidence = SourceEvidence(document_id=document_id, page_number=page_no, original_text=quote)
    PolicyGuard().validate_evidence_reference(evidence, set(coverage.document_ids), page.text)
    return evidence


def supports_exclusion(quote: str, terms: list[str]) -> bool:
    lower = quote.casefold()
    denial = re.search(
        r"\b(excluded|exclusion|not covered|does not cover|tidak ditanggung|dikecualikan)\b", lower
    )
    negated = re.search(r"\b(not|never)\s+(?:an?\s+)?(?:excluded|exclusion)\b", lower)
    return bool(denial and not negated and any(term.casefold() in lower for term in terms))
