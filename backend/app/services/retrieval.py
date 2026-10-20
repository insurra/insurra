"""Bounded multilingual lexical retrieval over exact retained-page references."""

import hashlib
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import AccountDocumentPageRow, ClauseChunkRow
from app.services.evidence import PLACEHOLDER_LINE, retained_page
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
CJK_RUN = re.compile(r"[\u4e00-\u9fff]+")
ID_WORDS = re.compile(
    r"\b(apakah|ditanggung|polis|asuransi|rawat|jalan|inap|obat|dokter|gigi|klaim|"
    r"manfaat|biaya|rumah|sakit|tidak|yang|untuk|dalam|dengan|sisa|terpakai)\b",
    re.I,
)


@dataclass
class RetrievedClause:
    coverage_id: object
    doc: object
    page: int
    quote: str
    language: str = "unknown"


def detect_language(text: str) -> str:
    if CJK_RUN.search(text):
        return "zh"
    if ID_WORDS.search(text):
        return "id"
    if re.search(r"[a-zA-Z]", text):
        return "en"
    return "unknown"


def _cjk_tokens(value: str) -> set[str]:
    tokens: set[str] = set()
    for match in CJK_RUN.finditer(value):
        run = match.group(0)
        if len(run) == 1:
            tokens.add(run)
        else:
            for idx in range(len(run) - 1):
                tokens.add(run[idx : idx + 2])
    return tokens


def _alias_matches(alias: str, value: str) -> bool:
    folded = alias.casefold()
    if CJK_RUN.search(folded):
        return folded in value
    return bool(re.search(r"(?<![a-z0-9_])" + re.escape(folded) + r"(?![a-z0-9_])", value))


def terms(text, country):
    value = text.casefold()
    output = (set(re.findall(r"[a-z0-9_]+", value)) | _cjk_tokens(value)) - STOP
    for code, aliases in country.resources.retrieval_terms.data.items():
        if any(_alias_matches(a, value) for a in [code, *aliases]):
            output.add(code)
            for alias in aliases:
                folded = alias.casefold()
                output.update(re.findall(r"[a-z0-9_]+", folded))
                output.update(_cjk_tokens(folded))
                if CJK_RUN.search(folded):
                    output.add(folded)
    return output - STOP


def retrieve_clauses(db, actor, country, items, question):
    if actor.account_id and not grants(db, actor).get("retention"):
        return []
    if actor.session_id and not grants(db, actor).get("process_documents"):
        return []
    query_terms = terms(question, country)
    ranked = []
    for coverage in items:
        for doc in coverage.document_ids:
            if actor.account_id:
                pages = list(
                    db.scalars(
                        select(AccountDocumentPageRow)
                        .where(AccountDocumentPageRow.document_id == doc)
                        .order_by(AccountDocumentPageRow.page_no)
                        .limit(30)
                    )
                )
            else:
                demo_page = retained_page(db, actor, doc, 1)
                pages = [demo_page] if demo_page is not None else []
            for page in pages:
                if retained_page(db, actor, doc, page.page_no) is None:
                    continue
                existing = (
                    list(
                        db.scalars(
                            select(ClauseChunkRow).where(
                                ClauseChunkRow.account_id == actor.account_id,
                                ClauseChunkRow.coverage_id == coverage.id,
                                ClauseChunkRow.document_id == doc,
                                ClauseChunkRow.page_no == page.page_no,
                            )
                        )
                    )
                    if actor.account_id
                    else []
                )
                expected: dict[tuple[int, int], tuple[str, str]] = {}
                for line in re.finditer(r"[^\n]+", page.text):
                    line_text = line.group()
                    if (
                        INSTRUCTIONS.search(line_text)
                        or IDENTIFIERS.search(line_text)
                        or PLACEHOLDER_LINE.search(line_text)
                    ):
                        continue
                    for start in range(line.start(), line.end(), 800):
                        end = min(start + 900, line.end())
                        quote = page.text[start:end]
                        if len(quote.strip()) < 15:
                            continue
                        digest = hashlib.sha256(quote.encode()).hexdigest()
                        lang = detect_language(quote)
                        expected[start, end] = (digest, lang)
                        overlap = query_terms & terms(quote, country)
                        if overlap:
                            ranked.append(
                                (
                                    len(overlap),
                                    str(doc),
                                    page.page_no,
                                    start,
                                    RetrievedClause(coverage.id, doc, page.page_no, quote, lang),
                                )
                            )
                if actor.account_id:
                    for chunk in existing:
                        exp = expected.get((chunk.start_offset, chunk.end_offset))
                        if exp is None or exp[0] != chunk.text_sha256:
                            db.delete(chunk)
                        elif chunk.language != exp[1]:
                            chunk.language = exp[1]
                    present = {(c.start_offset, c.end_offset, c.text_sha256) for c in existing}
                    for (start, end), (digest, lang) in expected.items():
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
                                            language=lang,
                                        )
                                    )
                                    db.flush()
                            except IntegrityError:
                                pass  # Concurrent idempotent index creation; never copy source text.
    if actor.account_id:
        db.commit()
    ranked.sort(key=lambda row: (-row[0], row[1], row[2], row[3]))
    return [row[-1] for row in ranked[:5]]
