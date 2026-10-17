# PRD traceability

All 55 stories: 44 P0, 11 P1. Exact CSV IDs, names, priorities and feature areas are preserved. Local CSVs are authoritative reference material and are not committed. No PIC metadata is used as an assignment.

Status describes shared foundation coverage, **not acceptance-criteria completion**. `existing`: a working partial foundation predates alignment; `foundation_updated`: this pass changes a shared primitive; `contract_only`: typed 501 boundary; `deferred`: no implementation in this pass. Every full product workflow remains future work.

| ID | Priority | Feature area | Exact story name | Screens | Foundation status | Future integration |
| --- | --- | --- | --- | --- | --- | --- |
| US-01-01 | P0 | E1 Akun & Privasi | Daftar akun | SC-01 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-01-02 | P0 | E1 Akun & Privasi | Masuk dan keluar | SC-01 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-01-03 | P0 | E1 Akun & Privasi | Persetujuan pemrosesan data per tujuan | SC-01 | foundation_updated | Shared purpose consent/profile validation only; complete onboarding/privacy screens remain deferred. |
| US-02-01 | P0 | E2 Profil Pengguna | Pilih konteks negara dan isi profil | SC-02 | foundation_updated | Shared purpose consent/profile validation only; complete onboarding/privacy screens remain deferred. |
| US-02-02 | P0 | E2 Profil Pengguna | Simpan dan ubah profil | SC-02 | foundation_updated | Shared purpose consent/profile validation only; complete onboarding/privacy screens remain deferred. |
| US-02-03 | P0 | E2 Profil Pengguna | Saran dokumen wajib dan disarankan per negara | SC-02 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-03-01 | P0 | E3 Document Intelligence | Unggah dokumen perlindungan | SC-03 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-03-02 | P0 | E3 Document Intelligence | Klasifikasi dan ekstraksi otomatis | SC-03 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-03-03 | P0 | E3 Document Intelligence | Review dan koreksi hasil ekstraksi | SC-03 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-03-04 | P0 | E3 Document Intelligence | Penanda instruksi mencurigakan di dokumen | SC-03 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-04-01 | P0 | E3 Document Intelligence | Pilih tugas yang ingin disiapkan | SC-04 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-04-02 | P0 | E3 Document Intelligence | Status kelengkapan dan aturan jeda visa | SC-04 | existing | Preserve seeded demo, date interval and scoped audit; full PRD calculations, recommendations and detailed UI remain deferred. |
| US-04-03 | P0 | E3 Document Intelligence | Tindak lanjut data yang hilang | SC-04 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-05-01 | P0 | E4 Command Center | Kartu ringkasan perlindungan | SC-05 | existing | Preserve seeded demo, date interval and scoped audit; full PRD calculations, recommendations and detailed UI remain deferred. |
| US-05-02 | P0 | E4 Command Center | Rekomendasi tindakan berikutnya | SC-05 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-05-03 | P0 | E4 Command Center | Pintasan situasi dan nomor darurat lokal | SC-05 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-11-01 | P0 | E8 Tindakan & Audit | Daftar keputusan agen | SC-11 | existing | Preserve seeded demo, date interval and scoped audit; full PRD calculations, recommendations and detailed UI remain deferred. |
| US-11-02 | P0 | E8 Tindakan & Audit | Filter dan detail entri | SC-11 | existing | Preserve seeded demo, date interval and scoped audit; full PRD calculations, recommendations and detailed UI remain deferred. |
| US-11-03 | P0 | E8 Tindakan & Audit | Sorotan peristiwa guardrail | SC-11 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-12-01 | P0 | E1 Akun & Privasi | Kelola persetujuan | SC-12 | foundation_updated | Shared purpose consent/profile validation only; complete onboarding/privacy screens remain deferred. |
| US-12-02 | P0 | E1 Akun & Privasi | Daftar data tersimpan | SC-12 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-12-03 | P0 | E1 Akun & Privasi | Hapus data | SC-12 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-13-01 | P1 | E9 Perlindungan Lanjutan | Daftar polis | SC-13 | deferred | Product implementation and acceptance criteria deferred. |
| US-13-02 | P1 | E9 Perlindungan Lanjutan | Detail polis | SC-13 | deferred | Product implementation and acceptance criteria deferred. |
| US-15-01 | P1 | E9 Perlindungan Lanjutan | Ringkasan benefit employer | SC-15 | deferred | Product implementation and acceptance criteria deferred. |
| US-15-02 | P1 | E9 Perlindungan Lanjutan | Tumpang tindih dengan polis pribadi | SC-15 | deferred | Product implementation and acceptance criteria deferred. |
| US-18-01 | P1 | E9 Perlindungan Lanjutan | Tambah anggota keluarga | SC-18 | deferred | Product implementation and acceptance criteria deferred. |
| US-18-02 | P1 | E9 Perlindungan Lanjutan | Ringkasan per anggota | SC-18 | deferred | Product implementation and acceptance criteria deferred. |
| US-06-01 | P0 | E5 Tanya Polis | Ajukan pertanyaan tentang manfaat | SC-06 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-06-02 | P0 | E5 Tanya Polis | Jawaban dengan kutipan klausul | SC-06 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-06-03 | P0 | E5 Tanya Polis | Label kepastian dan angka dari rules engine | SC-06 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-06-04 | P0 | E5 Tanya Polis | Deteksi tanda bahaya di chat | SC-06 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-07-01 | P0 | E6 Decision Support | Ceritakan keluhan non-darurat | SC-07 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-07-02 | P0 | E6 Decision Support | Kartu perbandingan jalur | SC-07 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-07-03 | P0 | E6 Decision Support | Daftar hal yang belum pasti | SC-07 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-07-04 | P0 | E6 Decision Support | Pilih jalur dan buat kasus klaim | SC-07 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-08-01 | P0 | E6 Decision Support | Tampilkan arahan darurat | SC-08 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-08-02 | P0 | E6 Decision Support | Daftar tanda bahaya terkonfigurasi | SC-08 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-08-03 | P0 | E6 Decision Support | Info dokumen untuk setelah kondisi aman | SC-08 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-09-01 | P0 | E7 Kesiapan Klaim | Checklist dokumen per jalur | SC-09 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-09-02 | P0 | E7 Kesiapan Klaim | Unggah bukti klaim dan pencocokan | SC-09 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-09-03 | P0 | E7 Kesiapan Klaim | Draf formulir klaim | SC-09 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-10-01 | P0 | E8 Tindakan & Audit | Antrean tindakan menunggu persetujuan | SC-10 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-10-02 | P0 | E8 Tindakan & Audit | Setujui, ubah, atau tolak | SC-10 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-10-03 | P0 | E8 Tindakan & Audit | Eksekusi tindakan yang disetujui | SC-10 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-14-01 | P0 | E6 Decision Support | Daftar kebutuhan perlindungan sesuai konteks | SC-14 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-14-02 | P0 | E6 Decision Support | Status kepemilikan dan alasan tiap kebutuhan | SC-14 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-16-01 | P1 | E9 Perlindungan Lanjutan | Input perjalanan | SC-16 | deferred | Product implementation and acceptance criteria deferred. |
| US-16-02 | P1 | E9 Perlindungan Lanjutan | Cek perlindungan yang ada | SC-16 | deferred | Product implementation and acceptance criteria deferred. |
| US-17-01 | P1 | E9 Perlindungan Lanjutan | Tabel perbandingan produk | SC-17 | deferred | Product implementation and acceptance criteria deferred. |
| US-17-02 | P1 | E9 Perlindungan Lanjutan | Urutan dan pengungkapan komisi | SC-17 | deferred | Product implementation and acceptance criteria deferred. |
| US-09-04 | P0 | E7 Kesiapan Klaim | Cek konsistensi antardokumen klaim | SC-09 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-09-05 | P0 | E7 Kesiapan Klaim | Daftar dan status kasus klaim | SC-09 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-10-04 | P0 | E8 Tindakan & Audit | Kirim klaim ke penyedia (sandbox) | SC-10 | contract_only | Implement behind registered contracts after maintainer review; no feature pipeline exists. |
| US-16-03 | P1 | E9 Perlindungan Lanjutan | Kebutuhan perlindungan di negara tujuan (studi/kerja/travel) | SC-16 | deferred | Product implementation and acceptance criteria deferred. |
