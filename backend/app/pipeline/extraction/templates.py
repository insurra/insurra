"""Insurance Document Extraction Templates for China and Indonesia.
Defines schemas for extracting structured entities from insurance documents.
Never use em dashes in strings or docstrings.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TemplateFieldSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: str
    label_en: str
    label_original: str
    value_type: Literal["text", "date", "money", "number", "boolean", "json"]
    required: bool
    normalization_rule: str
    source_evidence_hint: str


class DocumentExtractionTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: str
    document_category: str
    country_code: Literal["CN", "ID"]
    original_language: str
    applicable_schemes: list[str]
    required_fields: list[TemplateFieldSpec]
    optional_fields: list[TemplateFieldSpec] = Field(default_factory=list)
    review_requirements: str


EXTRACTION_TEMPLATES: list[DocumentExtractionTemplate] = [
    DocumentExtractionTemplate(
        template_id="tmpl-cn-student-cert",
        document_category="DOC_INS_CERTIFICATE",
        country_code="CN",
        original_language="zh",
        applicable_schemes=[
            "Comprehensive Insurance & Protection Scheme for Foreigners Staying in China"
        ],
        required_fields=[
            TemplateFieldSpec(
                field_key="insured_name",
                label_en="Insured Legal Name",
                label_original="被保险人姓名",
                value_type="text",
                required=True,
                normalization_rule="Uppercase English name as printed in foreign passport",
                source_evidence_hint="Top section under '姓名 / Name'",
            ),
            TemplateFieldSpec(
                field_key="passport_number",
                label_en="Passport Number",
                label_original="护照号码",
                value_type="text",
                required=True,
                normalization_rule="Alphanumeric string without spaces",
                source_evidence_hint="Identifier field next to passport label",
            ),
            TemplateFieldSpec(
                field_key="institution_name",
                label_en="Educational Institution Name",
                label_original="学校名称",
                value_type="text",
                required=True,
                normalization_rule="Standard university title in China (e.g., Shenzhen University)",
                source_evidence_hint="Header block or school declaration",
            ),
            TemplateFieldSpec(
                field_key="coverage_start_date",
                label_en="Coverage Inception Date",
                label_original="保险起期",
                value_type="date",
                required=True,
                normalization_rule="ISO 8601 date YYYY-MM-DD",
                source_evidence_hint="'保险期间 / Coverage Period' start timestamp",
            ),
            TemplateFieldSpec(
                field_key="coverage_end_date",
                label_en="Coverage Expiry Date",
                label_original="保险止期",
                value_type="date",
                required=True,
                normalization_rule="ISO 8601 date YYYY-MM-DD",
                source_evidence_hint="'保险期间 / Coverage Period' end timestamp",
            ),
            TemplateFieldSpec(
                field_key="policy_number",
                label_en="Insurance Policy Number",
                label_original="保单号",
                value_type="text",
                required=True,
                normalization_rule="Numeric or alphanumeric policy tracking code",
                source_evidence_hint="Upper right corner of electronic certificate",
            ),
        ],
        optional_fields=[
            TemplateFieldSpec(
                field_key="premium_amount",
                label_en="Premium Paid",
                label_original="保费金额",
                value_type="money",
                required=False,
                normalization_rule="Decimal string in CNY (e.g., 800.00)",
                source_evidence_hint="Payment receipt summary row",
            ),
        ],
        review_requirements="Human confirmation required if OCR confidence is below 0.85 or passport number has special characters.",
    ),
    DocumentExtractionTemplate(
        template_id="tmpl-cn-medical-fapiao",
        document_category="DOC_MEDICAL_INVOICE",
        country_code="CN",
        original_language="zh",
        applicable_schemes=["All medical reimbursement plans in China"],
        required_fields=[
            TemplateFieldSpec(
                field_key="fapiao_code",
                label_en="Fiscal Invoice Code",
                label_original="发票代码",
                value_type="text",
                required=True,
                normalization_rule="12-digit national fiscal invoice code",
                source_evidence_hint="Top right header code",
            ),
            TemplateFieldSpec(
                field_key="fapiao_number",
                label_en="Invoice Number",
                label_original="发票号码",
                value_type="text",
                required=True,
                normalization_rule="8-digit invoice sequence number",
                source_evidence_hint="Below fiscal invoice code",
            ),
            TemplateFieldSpec(
                field_key="billing_date",
                label_en="Billing Date",
                label_original="开票日期",
                value_type="date",
                required=True,
                normalization_rule="ISO 8601 date YYYY-MM-DD",
                source_evidence_hint="Date stamp in header area",
            ),
            TemplateFieldSpec(
                field_key="payer_name",
                label_en="Patient / Payer Legal Name",
                label_original="交款人",
                value_type="text",
                required=True,
                normalization_rule="Must match claimant passport name",
                source_evidence_hint="Header row '交款人 / Name'",
            ),
            TemplateFieldSpec(
                field_key="total_amount",
                label_en="Total Invoiced Amount",
                label_original="合计金额（小写）",
                value_type="money",
                required=True,
                normalization_rule="Decimal string in CNY",
                source_evidence_hint="Bottom summary row labeled '合计 / Total'",
            ),
            TemplateFieldSpec(
                field_key="hospital_name",
                label_en="Hospital / Issuing Entity Name",
                label_original="收款单位",
                value_type="text",
                required=True,
                normalization_rule="Official public hospital registered title",
                source_evidence_hint="Bottom right official electronic fiscal seal",
            ),
        ],
        optional_fields=[],
        review_requirements="Verify national electronic fiscal seal and ensure invoice code passes checksum validation.",
    ),
    DocumentExtractionTemplate(
        template_id="tmpl-id-jkn-card",
        document_category="DOC_JKN_CARD",
        country_code="ID",
        original_language="id",
        applicable_schemes=["Program Jaminan Kesehatan Nasional (JKN)"],
        required_fields=[
            TemplateFieldSpec(
                field_key="participant_name",
                label_en="Participant Legal Name",
                label_original="Nama Peserta",
                value_type="text",
                required=True,
                normalization_rule="Uppercase text matching KTP / KITAS",
                source_evidence_hint="Center field on front of KIS digital card",
            ),
            TemplateFieldSpec(
                field_key="bpjs_card_number",
                label_en="BPJS Participant Number (No. Kartu KIS)",
                label_original="Nomor Kartu",
                value_type="text",
                required=True,
                normalization_rule="13-digit numeric string",
                source_evidence_hint="Large digits below participant name or barcode",
            ),
            TemplateFieldSpec(
                field_key="nik",
                label_en="National Identity Number (NIK)",
                label_original="NIK",
                value_type="text",
                required=True,
                normalization_rule="16-digit numeric string",
                source_evidence_hint="Field labeled NIK",
            ),
            TemplateFieldSpec(
                field_key="fktp_registered",
                label_en="Registered Primary Clinic (Faskes Tingkat 1)",
                label_original="Fasilitas Kesehatan Tingkat 1 (FKTP)",
                value_type="text",
                required=True,
                normalization_rule="Registered clinic title (e.g., Puskesmas Cilandak)",
                source_evidence_hint="Middle row labeled 'Faskes Tk. 1'",
            ),
            TemplateFieldSpec(
                field_key="membership_class",
                label_en="Entitled Care Class Tier",
                label_original="Kelas Rawat",
                value_type="text",
                required=True,
                normalization_rule="Kelas 1, Kelas 2, or Kelas 3",
                source_evidence_hint="Lower section labeled 'Kelas'",
            ),
        ],
        optional_fields=[],
        review_requirements="Check active payment status in Mobile JKN to confirm card is not suspended for premium arrears.",
    ),
    DocumentExtractionTemplate(
        template_id="tmpl-id-medical-kwitansi",
        document_category="DOC_MEDICAL_INVOICE",
        country_code="ID",
        original_language="id",
        applicable_schemes=["Indonesian commercial health insurance and private hospital claims"],
        required_fields=[
            TemplateFieldSpec(
                field_key="receipt_number",
                label_en="Official Receipt Number",
                label_original="Nomor Kuitansi / No. Bukti Pembayaran",
                value_type="text",
                required=True,
                normalization_rule="Alphanumeric sequence code",
                source_evidence_hint="Top header of receipt",
            ),
            TemplateFieldSpec(
                field_key="patient_name",
                label_en="Patient Name",
                label_original="Sudah Terima Dari / Nama Pasien",
                value_type="text",
                required=True,
                normalization_rule="Must match policy insured member name",
                source_evidence_hint="Patient name row",
            ),
            TemplateFieldSpec(
                field_key="total_amount_idr",
                label_en="Total Payment Amount in Rupiah",
                label_original="Jumlah Pembayaran (Rp)",
                value_type="money",
                required=True,
                normalization_rule="Decimal string in IDR",
                source_evidence_hint="Total box with currency symbol Rp",
            ),
            TemplateFieldSpec(
                field_key="hospital_name",
                label_en="Hospital / Clinic Name",
                label_original="Nama Rumah Sakit / Klinik",
                value_type="text",
                required=True,
                normalization_rule="Official clinic header or stamped seal",
                source_evidence_hint="Letterhead at top of receipt",
            ),
            TemplateFieldSpec(
                field_key="payment_date",
                label_en="Date of Settlement",
                label_original="Tanggal Pembayaran",
                value_type="date",
                required=True,
                normalization_rule="ISO 8601 date YYYY-MM-DD",
                source_evidence_hint="Signature block date stamp",
            ),
        ],
        optional_fields=[],
        review_requirements="Confirm presence of original hospital cashier red or blue ink stamp and cashier signature.",
    ),
]
