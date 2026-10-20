"""Typed evidence fields, normalization helpers and a conservative invoice text parser.

The parser only reads labelled values with fixed patterns. Document text is data: no sentence in a
document can change a rule, a status or a destination.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

EVIDENCE_KINDS = (
    "FAPIAO",
    "MEDICAL_INVOICE",
    "ITEMIZED_BILL",
    "PAYMENT_RECEIPT",
    "MEDICAL_RECORD",
    "MEDICAL_SUMMARY",
    "PRESCRIPTION",
    "INSURANCE_CERTIFICATE",
    "REFERRAL_LETTER",
    "REJECTION_LETTER",
    "OTHER",
)
INVOICE_KINDS = ("FAPIAO", "MEDICAL_INVOICE", "ITEMIZED_BILL")
RECORD_KINDS = ("MEDICAL_RECORD", "MEDICAL_SUMMARY")


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    type: str  # text | date | money | currency
    required: bool = True


_INVOICE = [
    FieldSpec("invoice_number", "Invoice number", "text"),
    FieldSpec("invoice_code", "Invoice code", "text", False),
    FieldSpec("billing_date", "Billing or service date", "date"),
    FieldSpec("payer_name", "Patient or payer name", "text"),
    FieldSpec("hospital_name", "Medical provider", "text"),
    FieldSpec("total_amount", "Total amount", "money"),
    FieldSpec("currency", "Currency", "currency"),
    FieldSpec("diagnosed_condition", "Diagnosis or treatment", "text", False),
]
_RECORD = [
    FieldSpec("visit_date", "Visit date", "date"),
    FieldSpec("patient_name", "Patient name", "text"),
    FieldSpec("hospital_name", "Medical provider", "text"),
    FieldSpec("diagnosed_condition", "Diagnosis", "text", False),
]
FIELD_SPECS: dict[str, list[FieldSpec]] = {
    "FAPIAO": _INVOICE,
    "MEDICAL_INVOICE": _INVOICE,
    "ITEMIZED_BILL": [s for s in _INVOICE if s.key not in {"payer_name", "billing_date"}],
    "PAYMENT_RECEIPT": [
        FieldSpec("payment_date", "Payment date", "date"),
        FieldSpec("paid_amount", "Amount paid", "money"),
        FieldSpec("currency", "Currency", "currency"),
        FieldSpec("payer_name", "Payer name", "text", False),
        FieldSpec("hospital_name", "Medical provider", "text", False),
    ],
    "MEDICAL_RECORD": _RECORD,
    "MEDICAL_SUMMARY": _RECORD,
    "PRESCRIPTION": [FieldSpec("visit_date", "Prescription date", "date", False)],
    "INSURANCE_CERTIFICATE": [],
    "REFERRAL_LETTER": [FieldSpec("visit_date", "Issue date", "date", False)],
    "REJECTION_LETTER": [
        FieldSpec("rejection_reason", "Stated rejection reason", "text"),
        FieldSpec("cited_clause", "Cited policy clause or exclusion", "text", False),
        FieldSpec("rejection_date", "Rejection notice date", "date", False),
        FieldSpec("insurer_reference", "Insurer claim or letter reference", "text", False),
    ],
    "OTHER": [],
}


def specs_for(kind: str) -> list[FieldSpec]:
    return FIELD_SPECS.get(kind, [])


def norm_name(value: str | None) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", " ", (value or "").casefold()).strip()


_DATE_PATTERNS = (
    (re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$"), (0, 1, 2)),
    (re.compile(r"^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$"), (0, 1, 2)),
    (re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$"), (2, 1, 0)),
)


def parse_date(value) -> date | None:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    for pattern, order in _DATE_PATTERNS:
        match = pattern.match(text)
        if match:
            parts = match.groups()
            try:
                return date(int(parts[order[0]]), int(parts[order[1]]), int(parts[order[2]]))
            except ValueError:
                return None
    return None


def parse_money(value, currency: str | None = None) -> Decimal | None:
    text = re.sub(r"[^\d.,]", "", str(value if value is not None else ""))
    if not text or not re.search(r"\d", text):
        return None
    if "." in text and "," in text:
        decimal_sep = "." if text.rfind(".") > text.rfind(",") else ","
        other = "," if decimal_sep == "." else "."
        text = text.replace(other, "").replace(decimal_sep, ".")
    elif "," in text:
        head, _, tail = text.rpartition(",")
        text = head.replace(",", "") + "." + tail if len(tail) == 2 else text.replace(",", "")
    elif "." in text:
        head, _, tail = text.rpartition(".")
        if text.count(".") > 1 or (currency == "IDR" and len(tail) == 3):
            text = text.replace(".", "")
    try:
        return Decimal(text).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def money_str(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


_LABEL_END = r"[^:：\n]*[:：]\s*"
_VALUE_LINE = r"(.+?)(?:\s{2,}|$)"
_DATE_VALUE = r"(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})"


def _find(pattern: str, text: str, flags: int = re.MULTILINE | re.IGNORECASE):
    return re.search(pattern, text, flags)


def parse_invoice_text(pages: list[tuple[int, str]]) -> dict[str, dict]:
    """Return {field_key: {"value", "source_page"}} found by labelled patterns only."""
    found: dict[str, dict] = {}

    def put(key: str, value: str | None, page: int):
        if value and key not in found:
            found[key] = {"value": value.strip()[:200], "source_page": page}

    for page_no, text in pages:
        match = _find(
            r"(?:发票号码|Receipt No\.?|Invoice No\.?|Nomor (?:Invoice|Kuitansi|Faktur))"
            + _LABEL_END
            + r"([A-Za-z0-9][A-Za-z0-9\-/]{3,})",
            text,
        )
        put("invoice_number", match.group(1) if match else None, page_no)
        match = _find(r"(?:发票代码|Invoice Code)" + _LABEL_END + r"(\d{6,})", text)
        put("invoice_code", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:就诊日期|开票日期|Treatment Date|Service Date|Invoice Date|Tanggal(?: Layanan| Kunjungan| Perawatan)?)"
            + _LABEL_END
            + _DATE_VALUE,
            text,
        )
        if match:
            put("billing_date", match.group(1), page_no)
            put("visit_date", match.group(1), page_no)
        match = _find(
            r"(?:医疗机构|Hospital Name|Provider Name|Rumah Sakit|Nama (?:RS|Rumah Sakit|Klinik))"
            + _LABEL_END
            + _VALUE_LINE,
            text,
        )
        put("hospital_name", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:患者姓名|Insured Name|Patient Name|Nama Pasien)" + _LABEL_END + _VALUE_LINE, text
        )
        if match:
            put("payer_name", match.group(1), page_no)
            put("patient_name", match.group(1), page_no)
        match = _find(
            r"(?:合计金额|Total Amount|Total Tagihan|Total Biaya|Jumlah Total|Grand Total)"
            + _LABEL_END
            + r"(?:¥|￥|RMB|CNY|Rp\.?|IDR)?\s*([\d.,]+\d)",
            text,
        )
        put("total_amount", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:实付金额|Amount Paid|Jumlah Dibayar|Dibayar)"
            + _LABEL_END
            + r"(?:¥|￥|RMB|CNY|Rp\.?|IDR)?\s*([\d.,]+\d)",
            text,
        )
        put("paid_amount", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:支付日期|Payment Date|Tanggal Pembayaran)" + _LABEL_END + _DATE_VALUE, text
        )
        put("payment_date", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:初步诊断|Clinical Diagnosis|Diagnosis|Diagnosa)" + _LABEL_END + r"(.+)$", text
        )
        put("diagnosed_condition", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:拒赔原因|拒赔理由|Rejection Reason|Reason for (?:Denial|Rejection)|Alasan Penolakan)"
            + _LABEL_END
            + r"(.+)$",
            text,
        )
        put("rejection_reason", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:条款依据|引用条款|Policy Clause|Cited Clause|Exclusion Clause|Klausul Polis|Pasal Polis)"
            + _LABEL_END
            + r"(.+)$",
            text,
        )
        put("cited_clause", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:拒赔日期|通知日期|Rejection Date|Denial Date|Notice Date|Tanggal Penolakan|Tanggal Surat)"
            + _LABEL_END
            + _DATE_VALUE,
            text,
        )
        put("rejection_date", match.group(1) if match else None, page_no)
        match = _find(
            r"(?:理赔编号|赔案号|Claim Reference|Denial Reference|Insurer Reference|Nomor Klaim)"
            + _LABEL_END
            + r"([A-Za-z0-9][A-Za-z0-9\-/]{3,})",
            text,
        )
        put("insurer_reference", match.group(1) if match else None, page_no)
        if re.search(r"[¥￥]|RMB|CNY", text):
            put("currency", "CNY", page_no)
        elif re.search(r"\bRp\.?\s?\d|IDR", text):
            put("currency", "IDR", page_no)
    return found


def fields_for_kind(kind: str, parsed: dict[str, dict]) -> dict[str, dict]:
    wanted = {spec.key for spec in specs_for(kind)}
    output = {}
    for key, item in parsed.items():
        target = key
        if kind == "PAYMENT_RECEIPT" and key == "total_amount" and "paid_amount" not in parsed:
            target = "paid_amount"
        if kind in RECORD_KINDS and key == "billing_date":
            continue
        if target in wanted:
            output[target] = {
                "value": item["value"],
                "extracted_value": item["value"],
                "source_page": item.get("source_page"),
                "confirmed": False,
                "origin": "EXTRACTED",
            }
    return output


def missing_required(kind: str, fields: dict[str, dict]) -> list[str]:
    return [
        s.key for s in specs_for(kind) if s.required and not (fields.get(s.key) or {}).get("value")
    ]


def unconfirmed(kind: str, fields: dict[str, dict]) -> list[str]:
    return [
        s.key
        for s in specs_for(kind)
        if (fields.get(s.key) or {}).get("value") and not fields[s.key].get("confirmed")
    ]


def validate_field_value(spec: FieldSpec, value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError(f"{spec.label} cannot be empty")
    if spec.type == "date" and parse_date(value) is None:
        raise ValueError(f"{spec.label} must be a valid date")
    if spec.type == "money" and parse_money(value) is None:
        raise ValueError(f"{spec.label} must be a valid amount")
    if spec.type == "currency" and not re.fullmatch(r"[A-Za-z]{3}", value):
        raise ValueError("Currency must be a three letter code")
    if spec.type == "currency":
        value = value.upper()
    return value[:200]
