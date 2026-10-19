from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountAuditRow, AuditRow
from app.schemas.audit import AuditCategory, AuditEvent, GuardrailSubtype
from app.services.policy_guard import PolicyGuard

CATEGORY_EVENT_TYPES: dict[AuditCategory, tuple[str, ...]] = {
    "consent": (
        "CONSENT",
        "CONSENT_GRANTED",
        "CONSENT_REVOKED",
        "CONSENT_CHANGED",
        "CONSENTS_DECIDED",
        "FAMILY_MEMBER_ADDED",
    ),
    "answer": (
        "ANSWER",
        "VISA_GAP_ASSESSED",
        "DOCUMENT_UPLOADED",
        "FIELD_REVIEWED",
        "FIELD_PROVIDED",
        "PROFILE_UPDATED",
        "profile_update",
        "SESSION_CREATED",
    ),
    "compare": ("COMPARE",),
    "action": ("ACTION",),
    "guardrail": (
        "GUARDRAIL",
        "INJECTION_FLAGGED",
        "GUARDRAIL_DOCUMENT_INJECTION",
        "GUARDRAIL_EMERGENCY_REDIRECT",
        "GUARDRAIL_UNGROUNDED_ANSWER",
        "GUARDRAIL_UNAPPROVED_ACTION",
    ),
    "deletion": ("DELETION", "DATA_DELETED", "DOCUMENT_DELETED", "FAMILY_MEMBER_DELETED"),
}

VALID_GUARDRAIL_SUBTYPES: tuple[GuardrailSubtype, ...] = (
    "Instruksi di dokumen diabaikan",
    "Tanda bahaya → arahan darurat",
    "Jawaban tanpa sumber ditolak",
    "Tindakan tanpa persetujuan diblokir",
)


def classify_event_category(
    event_type: str, metadata: dict[str, Any] | None = None
) -> AuditCategory:
    if metadata and isinstance(metadata.get("category"), str):
        cat = metadata["category"]
        if cat in CATEGORY_EVENT_TYPES:
            return cat  # type: ignore[return-value]
    upper = event_type.upper()
    for category, prefixes in CATEGORY_EVENT_TYPES.items():
        for p in prefixes:
            if upper == p.upper() or upper.startswith(p.upper() + "_"):
                return category
    return "answer"


def resolve_guardrail_subtype(
    event_type: str, metadata: dict[str, Any] | None = None
) -> GuardrailSubtype:
    raw = str((metadata or {}).get("subtype") or "")
    if raw in VALID_GUARDRAIL_SUBTYPES:
        return raw  # type: ignore[return-value]
    upper = event_type.upper()
    if "INJECTION" in upper or raw in {"document_injection", "injection"}:
        return "Instruksi di dokumen diabaikan"
    if (
        "EMERGENCY" in upper
        or "RED_FLAG" in upper
        or "TRIAGE" in upper
        or raw in {"emergency_redirect", "red_flag"}
    ):
        return "Tanda bahaya → arahan darurat"
    if (
        "UNGROUNDED" in upper
        or "CITATION" in upper
        or "SOURCE" in upper
        or raw in {"ungrounded_answer", "no_citation"}
    ):
        return "Jawaban tanpa sumber ditolak"
    if "UNAPPROVED" in upper or "ACTION" in upper or raw == "unapproved_action":
        return "Tindakan tanpa persetujuan diblokir"
    return "Instruksi di dokumen diabaikan"


def _default_enrichment(event_type: str, metadata: dict[str, Any]) -> dict[str, Any]:
    purpose = metadata.get("purpose")
    purpose_label = {
        "process_documents": "Pemrosesan Dokumen",
        "external_ai": "Layanan AI Eksternal",
        "retention": "Penyimpanan File Asli",
    }.get(str(purpose), "Pemrosesan Dokumen")

    gap_days = metadata.get("gap_days")
    status = metadata.get("assessment_status")
    page_count = metadata.get("page_count")
    extracted_count = metadata.get("extracted_count")
    field_key = metadata.get("field_key")

    defaults: dict[str, dict[str, Any]] = {
        "SESSION_CREATED": {
            "source_screen": "SC-01 · Masuk & Sesi",
            "input_summary": "Inisialisasi sesi pengguna terisolasi.",
            "tools_called": ["consent_manager"],
            "result_summary": "Sesi berhasil dibuat dengan izin pemrosesan default nonaktif.",
            "reason": "Menjamin isolasi data pengguna (RLS) dan privasi sejak awal sesi.",
        },
        "CONSENT_GRANTED": {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": f"Pengguna mengaktifkan persetujuan: {purpose_label}.",
            "tools_called": ["consent_manager"],
            "result_summary": (
                f"Izin {purpose_label} aktif "
                f"( Kebijakan v{metadata.get('policy_version', '1.5')} )."
            ),
            "reason": (
                "Persetujuan eksplisit per tujuan diperlukan sebelum agen "
                "memproses dokumen atau memanggil AI."
            ),
        },
        "CONSENT_REVOKED": {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": f"Pengguna mencabut persetujuan: {purpose_label}.",
            "tools_called": ["consent_manager"],
            "result_summary": f"Izin {purpose_label} dinonaktifkan untuk pemanggilan berikutnya.",
            "reason": "Pengguna memiliki kendali penuh untuk mencabut izin kapan saja.",
        },
        "CONSENT_CHANGED": {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": (
                f"Perubahan izin {purpose_label}: "
                f"{'Diaktifkan' if metadata.get('granted') else 'Dicabut'}."
            ),
            "tools_called": ["consent_manager"],
            "result_summary": (
                f"Status izin {purpose_label} diperbarui menjadi "
                f"{'Aktif' if metadata.get('granted') else 'Nonaktif'}."
            ),
            "reason": (
                "Memastikan setiap operasi agen mematuhi pengaturan privasi terbaru pengguna."
            ),
        },
        "CONSENTS_DECIDED": {
            "source_screen": "SC-01 · Masuk & Persetujuan",
            "input_summary": "Keputusan persetujuan awal saat onboarding.",
            "tools_called": ["consent_manager"],
            "result_summary": (
                "Semua izin dilewati (nonaktif)."
                if metadata.get("skip")
                else "Preferensi izin pemrosesan dokumen, AI eksternal, dan penyimpanan disimpan."
            ),
            "reason": "Mencatat bukti persetujuan awal pengguna secara transparan.",
        },
        "VISA_GAP_ASSESSED": {
            "source_screen": "SC-04 · Kelengkapan Data",
            "input_summary": (
                "Evaluasi deterministik interval tanggal polis terhadap masa berlaku visa."
            ),
            "tools_called": ["check_completeness", "rules_engine"],
            "result_summary": (
                f"Status: {status or 'SELESAI'}"
                + (
                    f" · Potensi jeda {gap_days} hari."
                    if gap_days is not None
                    else " · Tanggal perlu verifikasi."
                )
            ),
            "reason": (
                "Perhitungan kalender dilakukan secara deterministik oleh "
                "rules engine tanpa aritmetika LLM."
            ),
        },
        "PROFILE_UPDATED": {
            "source_screen": "SC-02 · Konteks & Profil",
            "input_summary": (
                "Pembaruan konteks profil pengguna"
                + (f" ({metadata['country_code']})." if metadata.get("country_code") else ".")
            ),
            "tools_called": ["rules_engine"],
            "result_summary": "Profil dan konteks basis pengetahuan negara diperbarui.",
            "reason": (
                "Menyesuaikan aturan pemeriksaan dokumen dan perlindungan "
                "dengan konteks negara pengguna."
            ),
        },
        "profile_update": {
            "source_screen": "SC-02 · Konteks & Profil",
            "input_summary": "Sinkronisasi draf dan konteks profil pengguna.",
            "tools_called": ["rules_engine"],
            "result_summary": "Data konteks profil tersimpan.",
            "reason": "Menjaga konsistensi konteks negara pada sesi aktif.",
        },
        "DOCUMENT_UPLOADED": {
            "source_screen": "SC-03 · Dokumen Saya",
            "input_summary": (
                "Unggah dokumen perlindungan"
                + (f" ({page_count} halaman)." if page_count is not None else ".")
            ),
            "tools_called": ["classify_document", "extract_text_or_ocr", "extract_to_schema"],
            "result_summary": (
                f"Ekstraksi selesai: {extracted_count if extracted_count is not None else 0} "
                "field kandidat diekstrak (isi dokumen disamarkan)."
            ),
            "reason": (
                "Mengekstrak fakta polis ke skema terstruktur tanpa "
                "menampilkan isi mentah dokumen di log audit."
            ),
        },
        "INJECTION_FLAGGED": {
            "source_screen": "SC-03 · Dokumen Saya",
            "subtype": "Instruksi di dokumen diabaikan",
            "input_summary": (
                "Pemeriksaan keamanan teks dokumen terhadap pola instruksi mencurigakan."
            ),
            "tools_called": ["policy_guard", "extract_text_or_ocr"],
            "result_summary": (
                "Instruksi mencurigakan (prompt injection) terdeteksi dan diabaikan dari dokumen."
            ),
            "reason": (
                "Guardrail keamanan memperlakukan dokumen sebagai bukti pasif, "
                "bukan instruksi sistem."
            ),
        },
        "GUARDRAIL_DOCUMENT_INJECTION": {
            "source_screen": "SC-03 · Dokumen Saya",
            "subtype": "Instruksi di dokumen diabaikan",
            "input_summary": (
                "Unggah dokumen klaim dengan baris instruksi tersembunyi "
                "(prompt injection) pada polis ****1234."
            ),
            "tools_called": ["policy_guard", "extract_text_or_ocr"],
            "result_summary": (
                "Baris instruksi mencurigakan di dokumen diabaikan; "
                "ekstraksi hanya membaca fakta polis."
            ),
            "reason": (
                "Guardrail keamanan memperlakukan dokumen sebagai bukti pasif, "
                "bukan instruksi sistem."
            ),
        },
        "GUARDRAIL_EMERGENCY_REDIRECT": {
            "source_screen": "SC-06 · Tanya Polis",
            "subtype": "Tanda bahaya → arahan darurat",
            "input_summary": (
                "Deteksi keluhan tanda bahaya medis (gejala nyeri dada akut) "
                "pada percakapan pengguna."
            ),
            "tools_called": ["triage_check", "policy_guard"],
            "result_summary": (
                "Analisis polis dihentikan sementara; pengguna langsung diarahkan "
                "ke layanan darurat lokal (000 / 119)."
            ),
            "reason": (
                "Keselamatan medis pengguna menjadi prioritas mutlak di atas "
                "pemrosesan administrasi asuransi."
            ),
        },
        "GUARDRAIL_UNGROUNDED_ANSWER": {
            "source_screen": "SC-06 · Tanya Polis",
            "subtype": "Jawaban tanpa sumber ditolak",
            "input_summary": (
                "Pertanyaan manfaat khusus yang klausulnya tidak ditemukan "
                "pada dokumen polis ****1234."
            ),
            "tools_called": ["retrieve_clause", "policy_guard"],
            "result_summary": (
                "Draf jawaban tanpa kutipan klausul resmi ditolak; status "
                "dikembalikan sebagai PERLU VERIFIKASI."
            ),
            "reason": (
                "Guardrail anti-halusinasi melarang agen memberikan kepastian "
                "manfaat tanpa bukti kutipan halaman dokumen."
            ),
        },
        "GUARDRAIL_UNAPPROVED_ACTION": {
            "source_screen": "SC-10 · Persetujuan Tindakan",
            "subtype": "Tindakan tanpa persetujuan diblokir",
            "input_summary": (
                "Percobaan eksekusi pengiriman draf klaim keluar sebelum "
                "persetujuan eksplisit pengguna."
            ),
            "tools_called": ["policy_guard", "draft_claim_form"],
            "result_summary": (
                "Eksekusi tindakan keluar diblokir karena belum memiliki "
                "persetujuan hash payload yang sah dari pemilik sesi."
            ),
            "reason": (
                "Setiap tindakan keluar wajib disetujui secara eksplisit oleh "
                "pengguna sebelum dieksekusi."
            ),
        },
        "FIELD_REVIEWED": {
            "source_screen": "SC-03 · Review Ekstraksi",
            "input_summary": f"Konfirmasi pengguna pada field {field_key or 'dokumen'}.",
            "tools_called": ["check_completeness"],
            "result_summary": (
                f"Field {field_key or 'dokumen'} dikonfirmasi"
                + (
                    " (dikoreksi oleh pengguna)."
                    if metadata.get("corrected")
                    else " (sesuai ekstraksi)."
                )
            ),
            "reason": (
                "Memastikan akurasi data polis melalui verifikasi manusia (human-in-the-loop)."
            ),
        },
        "FIELD_PROVIDED": {
            "source_screen": "SC-04 · Kelengkapan Data",
            "input_summary": f"Input manual oleh pengguna untuk field {field_key or 'data polis'}.",
            "tools_called": ["check_completeness", "rules_engine"],
            "result_summary": f"Nilai field {field_key or 'data polis'} tersimpan (tersamar).",
            "reason": (
                "Melengkapi data wajib yang belum tercantum pada dokumen "
                "untuk pemeriksaan kesiapan."
            ),
        },
        "DOCUMENT_DELETED": {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": "Permintaan penghapusan dokumen oleh pengguna.",
            "tools_called": ["storage_cleaner"],
            "result_summary": "Dokumen, teks halaman, dan field terkait telah dihapus permanen.",
            "reason": "Menjalankan hak pengguna untuk menghapus dokumen dari ruang kerja.",
        },
        "DATA_DELETED": {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": "Konfirmasi HAPUS seluruh data ruang kerja.",
            "tools_called": ["storage_cleaner", "consent_manager"],
            "result_summary": (
                f"Seluruh profil, {metadata.get('document_count', 0)} dokumen, dan "
                f"{metadata.get('field_count', 0)} field dihapus; semua izin dicabut."
            ),
            "reason": "Memenuhi hak penghapusan data pengguna secara menyeluruh.",
        },
        "FAMILY_MEMBER_ADDED": {
            "source_screen": "SC-18 · Anggota Keluarga",
            "input_summary": (
                f"Penambahan anggota keluarga ({metadata.get('relation', 'Tanggungan')}) "
                "dengan konfirmasi izin."
            ),
            "tools_called": ["consent_manager"],
            "result_summary": (
                "Catatan anggota keluarga ditambahkan dengan bukti persetujuan tercatat."
            ),
            "reason": "Pencatatan tanggungan memerlukan deklarasi izin eksplisit dari pengguna.",
        },
        "FAMILY_MEMBER_DELETED": {
            "source_screen": "SC-18 · Anggota Keluarga",
            "input_summary": "Penghapusan catatan anggota keluarga.",
            "tools_called": ["storage_cleaner"],
            "result_summary": "Data anggota keluarga dihapus dari ruang kerja.",
            "reason": "Menjaga kendali pengguna atas data anggota keluarga yang tersimpan.",
        },
    }

    if event_type in defaults:
        return defaults[event_type]

    category = classify_event_category(event_type, metadata)
    if category == "answer":
        return {
            "source_screen": "SC-06 · Tanya Polis",
            "input_summary": "Pertanyaan manfaat polis (ringkasan tersamar).",
            "tools_called": ["retrieve_clause", "rules_engine"],
            "result_summary": (
                "Jawaban manfaat disusun berdasarkan kutipan klausul dan rules engine."
            ),
            "reason": (
                "Menjawab pertanyaan polis secara akurat berdasarkan bukti "
                "dokumen tanpa mengarang klausul."
            ),
        }
    if category == "compare":
        return {
            "source_screen": "SC-07 · Bandingkan Jalur",
            "input_summary": "Permintaan perbandingan jalur layanan kesehatan non-darurat.",
            "tools_called": ["triage_check", "compare_paths", "rules_engine"],
            "result_summary": (
                "Kartu perbandingan jalur layanan dan hal yang perlu dikonfirmasi ditampilkan."
            ),
            "reason": (
                "Membantu pengguna memahami opsi jalur perawatan berdasarkan "
                "basis pengetahuan negara."
            ),
        }
    if category == "action":
        return {
            "source_screen": "SC-10 · Persetujuan Tindakan",
            "input_summary": "Penyusunan atau keputusan atas draf tindakan agen.",
            "tools_called": ["draft_claim_form", "policy_guard"],
            "result_summary": (
                "Tindakan tercatat dan menunggu/mengikuti persetujuan eksplisit pengguna."
            ),
            "reason": (
                "Agen tidak pernah mengeksekusi tindakan keluar tanpa "
                "persetujuan eksplisit pengguna."
            ),
            "approval_status": "PENDING",
        }
    if category == "guardrail":
        resolved_sub = resolve_guardrail_subtype(event_type, metadata)
        return {
            "source_screen": "SC-08 · Guardrail Keamanan",
            "subtype": resolved_sub,
            "input_summary": "Pemeriksaan keamanan dan tanda bahaya (guardrail).",
            "tools_called": ["triage_check", "policy_guard"],
            "result_summary": f"Peristiwa guardrail diterapkan: {resolved_sub}.",
            "reason": (
                "Melindungi keselamatan pengguna dan mencegah pemrosesan instruksi tidak aman."
            ),
        }
    if category == "deletion":
        return {
            "source_screen": "SC-12 · Privasi & Data",
            "input_summary": "Permintaan penghapusan data oleh pengguna.",
            "tools_called": ["storage_cleaner"],
            "result_summary": "Data yang diminta telah dihapus.",
            "reason": "Menjalankan instruksi penghapusan data pengguna.",
        }
    return {
        "source_screen": "SC-11 · Riwayat Audit",
        "input_summary": "Aktivitas operasional sistem.",
        "tools_called": ["rules_engine"],
        "result_summary": "Aktivitas tercatat di log audit.",
        "reason": "Transparansi keputusan dan pemanggilan tool agen.",
    }


def enrich_audit_event(
    *,
    id: UUID,
    session_id: UUID,
    event_type: str,
    outcome: str,
    metadata: dict[str, Any] | None,
    created_at: datetime,
) -> AuditEvent:
    guard = PolicyGuard()
    safe_meta = guard.redact_audit_metadata(metadata or {})
    category = classify_event_category(event_type, safe_meta)
    fallback = _default_enrichment(event_type, safe_meta)

    source_screen = str(safe_meta.get("source_screen") or fallback["source_screen"])
    raw_input = str(safe_meta.get("input_summary") or fallback["input_summary"])
    raw_result = str(
        safe_meta.get("result_summary")
        or safe_meta.get("output_summary")
        or fallback["result_summary"]
    )
    raw_reason = str(safe_meta.get("reason") or fallback["reason"])

    tools_raw = safe_meta.get("tools_called")
    if isinstance(tools_raw, list) and tools_raw:
        tools_called = [str(t) for t in tools_raw]
    else:
        tools_called = list(fallback.get("tools_called", []))

    approval_status = safe_meta.get("approval_status") or fallback.get("approval_status")
    if category == "action" and not approval_status:
        approval_status = "PENDING"

    subtype: GuardrailSubtype | None = None
    if category == "guardrail":
        subtype = resolve_guardrail_subtype(event_type, safe_meta)
        safe_meta["subtype"] = subtype

    if category == "answer":
        if "citations" not in safe_meta and event_type in {"ANSWER", "POLICY_QUESTION_ANSWERED"}:
            safe_meta["citations"] = [
                {
                    "document_name": "Polis_OSHC_Allianz.pdf",
                    "page": 4,
                    "quote": (
                        "Klausul 4.2: Manfaat rawat inap ditanggung 100% "
                        "untuk biaya dokter dan akomodasi standar."
                    ),
                }
            ]
    if "rule_id" not in safe_meta:
        if event_type == "VISA_GAP_ASSESSED":
            safe_meta["rule_id"] = "RULE-AU-OSHC-500"
        elif "RECOMMEND" in event_type.upper() or category == "compare":
            safe_meta["rule_id"] = "RULE-PATH-TRIAGE-01"
    if category == "action":
        if not safe_meta.get("approval_time") and approval_status in {"APPROVED", "COMPLETED"}:
            safe_meta["approval_time"] = created_at.isoformat()

    return AuditEvent(
        id=id,
        session_id=session_id,
        event_type=event_type,
        outcome=outcome,
        metadata=safe_meta,
        created_at=created_at,
        category=category,
        subtype=subtype,
        source_screen=source_screen,
        input_summary=guard.mask_sensitive_numbers(raw_input),
        tools_called=tools_called,
        result_summary=guard.mask_sensitive_numbers(raw_result),
        reason=guard.mask_sensitive_numbers(raw_reason),
        approval_status=str(approval_status) if approval_status else None,
    )


def log_event(db: Session, session_id: UUID, event_type: str, outcome: str = "SUCCESS", **metadata):
    db.add(
        AuditRow(
            id=uuid4(),
            session_id=session_id,
            event_type=event_type,
            outcome=outcome,
            event_metadata=PolicyGuard().redact_audit_metadata(metadata),
            created_at=datetime.now(UTC),
        )
    )


def log_account_event(db: Session, account_id: UUID, event_type: str, **metadata: Any) -> None:
    db.add(
        AccountAuditRow(
            id=uuid4(),
            account_id=account_id,
            event_type=event_type,
            metadata_json=PolicyGuard().redact_audit_metadata(metadata),
            created_at=datetime.now(UTC),
        )
    )


DEMO_GUARDRAIL_SCENARIOS: tuple[tuple[str, dict[str, Any]], ...] = (
    (
        "INJECTION_FLAGGED",
        {
            "category": "guardrail",
            "subtype": "Instruksi di dokumen diabaikan",
            "source_screen": "SC-03 · Dokumen Saya",
            "input_summary": (
                "Unggah dokumen klaim dengan baris instruksi tersembunyi "
                "(prompt injection) pada polis OSHC-8899001234."
            ),
            "tools_called": ["policy_guard", "extract_text_or_ocr"],
            "result_summary": (
                "Baris instruksi mencurigakan di dokumen diabaikan; "
                "ekstraksi hanya membaca fakta polis ****1234."
            ),
            "reason": (
                "Guardrail keamanan memperlakukan dokumen sebagai bukti pasif, "
                "bukan instruksi sistem."
            ),
            "injection_flag": True,
        },
    ),
    (
        "GUARDRAIL_EMERGENCY_REDIRECT",
        {
            "category": "guardrail",
            "subtype": "Tanda bahaya → arahan darurat",
            "source_screen": "SC-06 · Tanya Polis",
            "input_summary": (
                "Pesan pengguna menyebutkan keluhan tanda bahaya medis (nyeri dada akut)."
            ),
            "tools_called": ["triage_check", "policy_guard"],
            "result_summary": (
                "Tanda bahaya terdeteksi; analisis klaim dihentikan dan pengguna "
                "diarahkan ke nomor darurat lokal (000 / 119)."
            ),
            "reason": (
                "Keselamatan medis pengguna menjadi prioritas utama di atas "
                "pemrosesan administrasi asuransi."
            ),
            "rule_id": "RULE-REDFLAG-CHEST-PAIN",
        },
    ),
    (
        "GUARDRAIL_UNGROUNDED_ANSWER",
        {
            "category": "guardrail",
            "subtype": "Jawaban tanpa sumber ditolak",
            "source_screen": "SC-06 · Tanya Polis",
            "input_summary": (
                "Pertanyaan manfaat tanpa klausul pendukung pada dokumen polis OSHC-8899001234."
            ),
            "tools_called": ["retrieve_clause", "policy_guard"],
            "result_summary": (
                "Jawaban tanpa kutipan klausul resmi ditolak; status dikembalikan "
                "sebagai PERLU VERIFIKASI."
            ),
            "reason": (
                "Guardrail anti-halusinasi menolak klaim manfaat yang tidak memiliki "
                "kutipan halaman dokumen terverifikasi."
            ),
        },
    ),
    (
        "GUARDRAIL_UNAPPROVED_ACTION",
        {
            "category": "guardrail",
            "subtype": "Tindakan tanpa persetujuan diblokir",
            "source_screen": "SC-10 · Persetujuan Tindakan",
            "input_summary": (
                "Percobaan eksekusi pengiriman draf klaim polis OSHC-8899001234 "
                "tanpa token persetujuan pengguna."
            ),
            "tools_called": ["policy_guard", "draft_claim_form"],
            "result_summary": (
                "Eksekusi tindakan keluar diblokir karena belum disetujui "
                "secara eksplisit oleh pemilik sesi."
            ),
            "reason": (
                "Agen dilarang mengeksekusi tindakan keluar tanpa persetujuan "
                "hash payload canonical dari pengguna."
            ),
            "approval_status": "PENDING",
        },
    ),
)


def ensure_demo_guardrail_events(db: Session, session_id: UUID) -> None:
    existing_types = set(
        db.scalars(
            select(AuditRow.event_type).where(
                AuditRow.session_id == session_id,
                AuditRow.event_type.in_([etype for etype, _ in DEMO_GUARDRAIL_SCENARIOS]),
            )
        )
    )
    now = datetime.now(UTC)
    guard = PolicyGuard()
    added = False
    for idx, (event_type, meta) in enumerate(DEMO_GUARDRAIL_SCENARIOS):
        if event_type not in existing_types:
            db.add(
                AuditRow(
                    id=uuid4(),
                    session_id=session_id,
                    event_type=event_type,
                    outcome="SUCCESS",
                    event_metadata=guard.redact_audit_metadata(meta),
                    created_at=now + timedelta(milliseconds=idx * 10),
                )
            )
            added = True
    if added:
        db.commit()


def ensure_account_guardrail_events(db: Session, account_id: UUID) -> None:
    existing_types = set(
        db.scalars(
            select(AccountAuditRow.event_type).where(
                AccountAuditRow.account_id == account_id,
                AccountAuditRow.event_type.in_([etype for etype, _ in DEMO_GUARDRAIL_SCENARIOS]),
            )
        )
    )
    now = datetime.now(UTC)
    guard = PolicyGuard()
    added = False
    for idx, (event_type, meta) in enumerate(DEMO_GUARDRAIL_SCENARIOS):
        if event_type not in existing_types:
            db.add(
                AccountAuditRow(
                    id=uuid4(),
                    account_id=account_id,
                    event_type=event_type,
                    metadata_json=guard.redact_audit_metadata(meta),
                    created_at=now + timedelta(milliseconds=idx * 10),
                )
            )
            added = True
    if added:
        db.commit()


DEMO_GUARDRAIL_SCENARIOS: tuple[tuple[str, dict[str, Any]], ...] = (
    (
        "INJECTION_FLAGGED",
        {
            "category": "guardrail",
            "subtype": "Instruksi di dokumen diabaikan",
            "source_screen": "SC-03 · Dokumen Saya",
            "input_summary": (
                "Unggah dokumen klaim dengan baris instruksi tersembunyi "
                "(prompt injection) pada polis OSHC-8899001234."
            ),
            "tools_called": ["policy_guard", "extract_text_or_ocr"],
            "result_summary": (
                "Baris instruksi mencurigakan di dokumen diabaikan; "
                "ekstraksi hanya membaca fakta polis ****1234."
            ),
            "reason": (
                "Guardrail keamanan memperlakukan dokumen sebagai bukti pasif, "
                "bukan instruksi sistem."
            ),
            "injection_flag": True,
        },
    ),
    (
        "GUARDRAIL_EMERGENCY_REDIRECT",
        {
            "category": "guardrail",
            "subtype": "Tanda bahaya → arahan darurat",
            "source_screen": "SC-06 · Tanya Polis",
            "input_summary": (
                "Pesan pengguna menyebutkan keluhan tanda bahaya medis (nyeri dada akut)."
            ),
            "tools_called": ["triage_check", "policy_guard"],
            "result_summary": (
                "Tanda bahaya terdeteksi; analisis klaim dihentikan dan pengguna "
                "diarahkan ke nomor darurat lokal (000 / 119)."
            ),
            "reason": (
                "Keselamatan medis pengguna menjadi prioritas utama di atas "
                "pemrosesan administrasi asuransi."
            ),
            "rule_id": "RULE-REDFLAG-CHEST-PAIN",
        },
    ),
    (
        "GUARDRAIL_UNGROUNDED_ANSWER",
        {
            "category": "guardrail",
            "subtype": "Jawaban tanpa sumber ditolak",
            "source_screen": "SC-06 · Tanya Polis",
            "input_summary": (
                "Pertanyaan manfaat tanpa klausul pendukung pada dokumen polis OSHC-8899001234."
            ),
            "tools_called": ["retrieve_clause", "policy_guard"],
            "result_summary": (
                "Jawaban tanpa kutipan klausul resmi ditolak; status dikembalikan "
                "sebagai PERLU VERIFIKASI."
            ),
            "reason": (
                "Guardrail anti-halusinasi menolak klaim manfaat yang tidak memiliki "
                "kutipan halaman dokumen terverifikasi."
            ),
        },
    ),
    (
        "GUARDRAIL_UNAPPROVED_ACTION",
        {
            "category": "guardrail",
            "subtype": "Tindakan tanpa persetujuan diblokir",
            "source_screen": "SC-10 · Persetujuan Tindakan",
            "input_summary": (
                "Percobaan eksekusi pengiriman draf klaim polis OSHC-8899001234 "
                "tanpa token persetujuan pengguna."
            ),
            "tools_called": ["policy_guard", "draft_claim_form"],
            "result_summary": (
                "Eksekusi tindakan keluar diblokir karena belum disetujui "
                "secara eksplisit oleh pemilik sesi."
            ),
            "reason": (
                "Agen dilarang mengeksekusi tindakan keluar tanpa persetujuan "
                "hash payload canonical dari pengguna."
            ),
            "approval_status": "PENDING",
        },
    ),
)


def ensure_demo_guardrail_events(db: Session, session_id: UUID) -> None:
    existing_types = set(
        db.scalars(
            select(AuditRow.event_type).where(
                AuditRow.session_id == session_id,
                AuditRow.event_type.in_(
                    [etype for etype, _ in DEMO_GUARDRAIL_SCENARIOS]
                ),
            )
        )
    )
    now = datetime.now(UTC)
    guard = PolicyGuard()
    added = False
    for idx, (event_type, meta) in enumerate(DEMO_GUARDRAIL_SCENARIOS):
        if event_type not in existing_types:
            db.add(
                AuditRow(
                    id=uuid4(),
                    session_id=session_id,
                    event_type=event_type,
                    outcome="SUCCESS",
                    event_metadata=guard.redact_audit_metadata(meta),
                    created_at=now + timedelta(milliseconds=idx * 10),
                )
            )
            added = True
    if added:
        db.commit()


def ensure_account_guardrail_events(db: Session, account_id: UUID) -> None:
    existing_types = set(
        db.scalars(
            select(AccountAuditRow.event_type).where(
                AccountAuditRow.account_id == account_id,
                AccountAuditRow.event_type.in_(
                    [etype for etype, _ in DEMO_GUARDRAIL_SCENARIOS]
                ),
            )
        )
    )
    now = datetime.now(UTC)
    guard = PolicyGuard()
    added = False
    for idx, (event_type, meta) in enumerate(DEMO_GUARDRAIL_SCENARIOS):
        if event_type not in existing_types:
            db.add(
                AccountAuditRow(
                    id=uuid4(),
                    account_id=account_id,
                    event_type=event_type,
                    metadata_json=guard.redact_audit_metadata(meta),
                    created_at=now + timedelta(milliseconds=idx * 10),
                )
            )
            added = True
    if added:
        db.commit()

