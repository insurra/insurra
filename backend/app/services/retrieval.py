"""Bounded multilingual lexical retrieval over exact retained-page references."""

import hashlib
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import AccountDocumentPageRow, ClauseChunkRow
from app.services.evidence import retained_page
from app.services.workspace import grants

STOP = set(
    (
        "apa apakah saya aku kamu yang di ke dari ini itu dan atau untuk "
        "my the is are a an it do does cover covered policy insurance polis "
        "ditanggung nggak tidak not"
    ).split()
)
INSTRUCTIONS = re.compile(
    r"ignore\s+(?:all|previous|prior).*instructions|abaikan.*instruksi|system\s+prompt|"
    r"developer\s+message|reveal.*(?:secret|token)|ikuti.*(?:instruksi|perintah)|"
    r"<\s*/?\s*(?:system|developer)\b",
    re.I,
)
IDENTIFIERS = re.compile(
    r"\b(?:member|policy|nomor polis|nomor anggota)\s*(?:number|no[.:]?)?\s*[:#]\s*\S+", re.I
)


@dataclass
class RetrievedClause:
    coverage_id: object
    doc: object
    page: int
    quote: str


def terms(text, country):
    value = text.casefold()
    output = set(re.findall(r"\w+", value)) - STOP
    for code, aliases in country.resources.retrieval_terms.data.items():
        if any(
            re.search(r"(?<!\w)" + re.escape(a.casefold()) + r"(?!\w)", value)
            for a in [code, *aliases]
        ):
            output.add(code)
            for alias in aliases:
                output.update(re.findall(r"\w+", alias.casefold()))
    return output - STOP


def retrieve_clauses(db, actor, country, items, question):
    if not actor.account_id or not grants(db, actor).get("retention"):
        return []
    query_terms = terms(question, country)
    ranked = []
    for coverage in items:
        for doc in coverage.document_ids:
            pages = list(
                db.scalars(
                    select(AccountDocumentPageRow)
                    .where(AccountDocumentPageRow.document_id == doc)
                    .order_by(AccountDocumentPageRow.page_no)
                    .limit(30)
                )
            )
            for page in pages:
                if retained_page(db, actor, doc, page.page_no) is None:
                    continue
                existing = list(
                    db.scalars(
                        select(ClauseChunkRow).where(
                            ClauseChunkRow.account_id == actor.account_id,
                            ClauseChunkRow.coverage_id == coverage.id,
                            ClauseChunkRow.document_id == doc,
                            ClauseChunkRow.page_no == page.page_no,
                        )
                    )
                )
                expected = {}
                for line in re.finditer(r"[^\n]+", page.text):
                    if INSTRUCTIONS.search(line.group()) or IDENTIFIERS.search(line.group()):
                        continue
                    for start in range(line.start(), line.end(), 800):
                        end = min(start + 900, line.end())
                        quote = page.text[start:end]
                        if len(quote.strip()) < 15:
                            continue
                        digest = hashlib.sha256(quote.encode()).hexdigest()
                        expected[start, end] = digest
                        overlap = query_terms & terms(quote, country)
                        if overlap:
                            ranked.append(
                                (
                                    len(overlap),
                                    str(doc),
                                    page.page_no,
                                    start,
                                    RetrievedClause(coverage.id, doc, page.page_no, quote),
                                )
                            )
                for chunk in existing:
                    if expected.get((chunk.start_offset, chunk.end_offset)) != chunk.text_sha256:
                        db.delete(chunk)
                present = {(c.start_offset, c.end_offset, c.text_sha256) for c in existing}
                for (start, end), digest in expected.items():
                    if (start, end, digest) not in present:
                        try:
                            with db.begin_nested():
                                db.add(
                                    ClauseChunkRow(
                                        account_id=actor.account_id,
                                        coverage_id=coverage.id,
                                        document_id=doc,
                                        page_no=page.page_no,
                                        start_offset=start,
                                        end_offset=end,
                                        text_sha256=digest,
                                    )
                                )
                                db.flush()
                        except IntegrityError:
                            pass  # Concurrent idempotent index creation; never copy source text.
    db.commit()
    ranked.sort(key=lambda row: (-row[0], row[1], row[2], row[3]))
    return [row[-1] for row in ranked[:5]]
