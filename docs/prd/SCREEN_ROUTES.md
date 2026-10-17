# Screen route specifications

These are PRD route specifications, not a plan to scaffold nineteen pages. Existing routes stay intact. No new product screens are built in Phase 1.5. Existing shells/partial demos do not fulfill complete screen acceptance criteria.

| ID | Exact PRD name | PRD route | Priority | Purpose | Current route/status |
| --- | --- | --- | --- | --- | --- |
| SC-01 | Masuk & Persetujuan Data | /auth | P0 | Daftar, masuk, keluar; persetujuan pemrosesan data per tujuan saat pertama kali masuk | Planned /auth; existing demo consent at /onboarding, no login. |
| SC-02 | Onboarding & Konteks | /onboarding | P0 | Pilih konteks; detail tempat tinggal (luar negeri: negara, kota, status, tanggal tiba, akhir visa); tanggungan; perlindungan yang dimiliki; prioritas; anggaran; saran dokumen per negara | Existing /onboarding is consent-only; full context wizard planned. |
| SC-03 | Unggah & Review Ekstraksi | /documents | P0 | Unggah sertifikat/polis asuransi, Visa Grant Notice, benefit employer, kartu BPJS; status proses; review dan koreksi field dengan sumber halaman dan label Bahasa Indonesia; penanda instruksi mencurigakan | Existing /documents metadata shell; upload/review planned. |
| SC-04 | Cek Kelengkapan Data | /completeness | P0 | Pilih tugas sesuai negara; status 4 jenis untuk setiap field wajib; kartu hasil aturan visa; tindak lanjut data hilang | Planned; no page implementation. |
| SC-05 | Command Center | /home | P0 | Badge konteks; kartu ringkasan angka; maksimal 3 rekomendasi (termasuk kewajiban visa); pintasan; nomor darurat sesuai negara | Planned /home; existing partial demo at /dashboard. |
| SC-06 | Tanya Polis | /ask | P0 | Chat; jawaban dengan kutipan klausul dan halaman; label kepastian; deteksi tanda bahaya | Planned /ask; existing placeholder at /ask-policy. |
| SC-07 | Bandingkan Jalur Layanan | /pathways | P0 | Form keluhan non-darurat; kartu jalur dari basis pengetahuan negara (AU: GP vs urgent care vs IGD; ID: BPJS vs kantor vs pribadi); hal yang belum pasti; pilih jalur | Planned /pathways; existing placeholder at /care. |
| SC-08 | Arahan Darurat | /emergency | P0 | Layar penuh arahan nomor darurat negara aktif (AU 000, ID 119) atau IGD; info dokumen untuk nanti | Planned; no page implementation. |
| SC-09 | Kesiapan Klaim | /claims/[id] | P0 | Checklist dokumen per jalur; unggah bukti klaim dan pencocokan; draf formulir klaim | Planned /claims/[id]; existing /claims placeholder. |
| SC-10 | Persetujuan Tindakan | /actions | P0 | Antrean draf; setujui, ubah, atau tolak; eksekusi yang disetujui | Planned; no page implementation. |
| SC-11 | Riwayat Audit | /audit | P0 | Daftar keputusan agen; filter dan detail; sorotan guardrail | Existing partial /audit; detailed PRD audit UX planned. |
| SC-12 | Privasi & Data Saya | /settings/privacy | P0 | Kelola persetujuan; daftar data tersimpan; hapus data | Planned /settings/privacy; demo document consent at /onboarding. |
| SC-13 | Dompet Polis | /policies | P1 | Daftar perlindungan; detail manfaat, limit, sisa limit, pengecualian, status KAPJ | Planned; no page implementation. |
| SC-14 | Cek Kebutuhan Perlindungan | /coverage-needs | P0 | Daftar kebutuhan dari basis pengetahuan negara (wajib visa, disarankan); status Sudah punya / Belum punya / Perlu dicek; alasan dan sumber aturan | Planned /coverage-needs; existing placeholder at /coverage. |
| SC-15 | Benefit Employer | /employer-benefits | P1 | Ringkasan benefit employer; manfaat yang tumpang tindih dengan polis pribadi | Planned; no page implementation. |
| SC-16 | Perencana Perjalanan | /travel | P1 | Input perjalanan; cek wilayah dan tanggal berlaku polis yang ada | Planned; no page implementation. |
| SC-17 | Bandingkan Produk | /products/compare | P1 | Tabel perbandingan produk resmi dengan tanggal data; pengungkapan komisi | Planned; no page implementation. |
| SC-18 | Anggota Keluarga | /family | P1 | Tambah anggota dengan persetujuan; ringkasan perlindungan per anggota | Planned; no page implementation. |
| SC-19 | Bukti Dokumen Testnet | /proof | Bonus | Daftar hash dokumen klaim; verifikasi file belum berubah | Planned; no page implementation. |
