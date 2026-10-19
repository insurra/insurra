# Screen route specifications

Current rollout (19 October 2026): `/home`, `/ask`, `/pathways` and `/coverage-needs` exist and reuse current account/demo authentication. `/ask-policy`, `/care` and `/coverage` re-export their canonical page; `/dashboard` remains the existing demo dashboard. Q&A/pathways remain fail-closed with shipped unverified triage. SC-08 `/emergency`, SC-09 `/claims/[id]` and SC-10 `/actions` remain absent. Case creation shows its real ID with an unavailable-checklist state. Existing Rere account/onboarding/document/privacy wrappers remain intact. The earlier route/status inventory below is historical; it is not a current absence claim for these activated routes.


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
| SC-08 | Arahan Darurat | /emergency | P0 | Layar penuh arahan darurat dari KB negara aktif; info dokumen untuk nanti (konten belum diverifikasi) | Planned; no page implementation. |
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

## Existing demo URLs → intended frontend routes

Reviewed against `PRD - Daftar Screen.csv` at baseline `59bfdc2`. The CSV contains exactly 19 screen rows; its Total row is not a screen. These are frontend URLs, distinct from `/api/v1` API paths. The existing navigation remains on working demo URLs; **no aliases, redirects, route renames or new pages are introduced** by this review.

| Existing URL | Current behavior | Intended PRD URL / screen | Integration decision |
| --- | --- | --- | --- |
| `/` | Synthetic persona selector | No equivalent among SC-01–SC-19 | Keep the demo entry point; it is not `/auth` or real login. |
| `/dashboard` | Seeded record summary and deterministic visa-interval widget | `/home` (SC-05) | Future Command Center canonical URL. The embedded visa result belongs to SC-04, not a separate coverage-needs engine. |
| `/onboarding` | Initial/revocable document-processing consent only | `/auth` (SC-01 initial consent), `/settings/privacy` (SC-12 ongoing consent); `/onboarding` reserved for SC-02 context wizard | Current reuse is a demo shortcut. Do not claim the wizard, auth or full privacy screen exists. Future profile edit is `/onboarding?mode=edit` per US-02-02; that query does not activate a form today. |
| `/documents` | Seeded document metadata | `/documents` (SC-03) | Same URL; full upload/review is deferred. Claim evidence belongs to SC-09; the final policy wallet belongs to SC-13. |
| `/ask-policy` | Deferred-feature placeholder | `/ask` (SC-06) | Migrate links only when the feature route exists; no redirect now. |
| `/care` | Deferred-feature placeholder | `/pathways` (SC-07) | Canonical pathway comparison, not the emergency page. |
| `/coverage` | Deferred coverage-needs placeholder | `/coverage-needs` (SC-14) | This maps to needs, **not** `/completeness` (SC-04). |
| `/claims` | Deferred claim-preparation placeholder | `/claims/[id]` (SC-09 detail) | No case ID exists in this placeholder. Never redirect to a literal `[id]` or invent one. US-09-05 separately specifies `/claims` as the future case list; select an owned case before navigating to `/claims/<id>`. |
| `/audit` | Scoped audit list/filter | `/audit` (SC-11) | Same URL; detailed PRD audit UX remains deferred. |

No existing standalone demo page maps to SC-04 `/completeness`, SC-08 `/emergency`, SC-10 `/actions`, SC-13 `/policies`, or SC-15–SC-19. Their intended URLs and status are in the 19-row table above. `/auth` and `/settings/privacy` likewise have no standalone implementation.

Story-derived deep-link specifications remain planned: SC-04 accepts `?task=visa_cover&coverage=<owned-coverage-id>` (US-04-01); SC-02 accepts `?mode=edit` (US-02-02). Frontend `coverage` query naming is not the API's `coverage_id` query; a future adapter must validate/translate it. Current KB task lists are empty, so these specifications do not imply an active task. Current working links are intentionally unchanged; future canonical route rollout must preserve demo compatibility and avoid links to unimplemented destinations.
