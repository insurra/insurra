# Screen route specifications

These are PRD route specifications, not a plan to scaffold nineteen pages. Existing routes stay intact. The later Joshua demo slice adds partial emergency, claim and action screens; shells and partial demos do not fulfill complete screen acceptance criteria.

| ID | Exact PRD name | PRD route | Priority | Purpose | Current route/status |
| --- | --- | --- | --- | --- | --- |
| SC-01 | Masuk & Persetujuan Data | /auth | P0 | Daftar, masuk, keluar; persetujuan pemrosesan data per tujuan saat pertama kali masuk | Planned /auth; existing demo consent at /onboarding, no login. |
| SC-02 | Onboarding & Konteks | /onboarding | P0 | Pilih konteks; detail tempat tinggal (luar negeri: negara, kota, status, tanggal tiba, akhir visa); tanggungan; perlindungan yang dimiliki; prioritas; anggaran; saran dokumen per negara | Existing /onboarding is consent-only; full context wizard planned. |
| SC-03 | Unggah & Review Ekstraksi | /documents | P0 | Unggah dokumen; status proses; review dan koreksi field dengan sumber halaman; penanda instruksi mencurigakan | Existing account upload/review flow; OCR/extraction availability depends on server tools, consent, and verified evidence. |
| SC-04 | Status Kelengkapan dan Kontinuitas Perlindungan | /completeness | P0 | Pilih tugas sesuai negara; status data; factual date comparison; source-backed follow-up | Existing account completeness view; institutional requirements remain unverified unless a current verified source is configured. |
| SC-05 | Command Center | /home | P0 | Badge konteks; kartu ringkasan angka; maksimal 3 rekomendasi (termasuk kewajiban visa); pintasan; nomor darurat sesuai negara | Planned /home; existing partial demo at /dashboard. |
| SC-06 | Tanya Polis | /ask | P0 | Chat; jawaban dengan kutipan klausul dan halaman; label kepastian; deteksi tanda bahaya | Planned /ask; existing placeholder at /ask-policy. |
| SC-07 | Bandingkan Jalur Layanan | /pathways | P0 | Form keluhan non-darurat; kartu jalur dari basis pengetahuan negara (AU: GP vs urgent care vs IGD; ID: BPJS vs kantor vs pribadi); hal yang belum pasti; pilih jalur | Planned /pathways; existing placeholder at /care. |
| SC-08 | Arahan Darurat | /emergency | P0 | Layar penuh arahan darurat dari KB negara aktif; info dokumen untuk nanti | CN/ID official sourced contacts and limited positive-only multilingual red-flag phrase escalation live; AU contacts stay unverified/empty. |
| SC-09 | Kesiapan Klaim | /claims/[id] | P0 | Checklist dokumen per jalur; unggah bukti klaim dan pencocokan; draf formulir klaim | Demo case list/create/detail and stored case timeline live; evidence, verified checklist, draft and sandbox status sync remain 501/inactive. |
| SC-10 | Persetujuan Tindakan | /actions | P0 | Antrean draf; setujui, ubah, atau tolak; eksekusi yang disetujui | Demo queue and hash-bound approve/reject live for persisted actions; editing and execution remain 501. |
| SC-11 | Riwayat Audit | /audit | P0 | Daftar keputusan agen; filter dan detail; sorotan guardrail | Existing partial /audit; detailed PRD audit UX planned. |
| SC-12 | Privasi & Data Saya | /settings/privacy | P0 | Kelola persetujuan; daftar data tersimpan; hapus data | Planned /settings/privacy; demo document consent at /onboarding. |
| SC-13 | Dompet Polis | /policies | P1 | Daftar perlindungan; detail manfaat, limit, sisa limit, pengecualian, status KAPJ | Existing account policy list/detail; only extracted or declared evidence is shown, and unsupported facts remain unavailable. |
| SC-14 | Cek Kebutuhan Perlindungan | /coverage-needs | P0 | Daftar kebutuhan dari basis pengetahuan negara (wajib visa, disarankan); status Sudah punya / Belum punya / Perlu dicek; alasan dan sumber aturan | Planned /coverage-needs; existing placeholder at /coverage. |
| SC-15 | Benefit Employer | /employer-benefits | P1 | Ringkasan benefit employer; manfaat yang tumpang tindih dengan polis pribadi | Planned; no page implementation. |
| SC-16 | Perencana Perjalanan | /travel | P1 | Input perjalanan; cek wilayah dan tanggal berlaku polis yang ada | Planned; no page implementation. |
| SC-17 | Bandingkan Produk | /products/compare | P1 | Tabel perbandingan produk resmi dengan tanggal data; pengungkapan komisi | Planned; no page implementation. |
| SC-18 | Anggota Keluarga | /family | P1 | Tambah anggota dengan persetujuan; ringkasan perlindungan per anggota | Existing account member list; coverage association is unavailable until explicitly evidenced and linked. |
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
| `/claims` | Demo owned case list and manual creation | `/claims/[id]` (SC-09 detail) | Select a persisted owned case before navigating to `/claims/<id>`; no invented ID or inferred readiness. |
| `/audit` | Scoped audit list/filter | `/audit` (SC-11) | Same URL; detailed PRD audit UX remains deferred. |

The Joshua slice adds `/emergency`, `/claims/[id]` and `/actions` as partial screens. Their deferred behavior is stated in the 19-row table above. Other account and product route statuses are recorded per row; a route alone does not imply completed acceptance criteria.

Story-derived deep-link specifications remain planned: SC-04 accepts `?task=coverage_continuity&coverage=<owned-coverage-id>` (US-04-01); SC-02 accepts `?mode=edit` (US-02-02). Frontend `coverage` query naming is not the API's `coverage_id` query; a future adapter must validate/translate it. Country task configuration remains unverified, so task availability does not imply a country requirement. Current working links are intentionally unchanged; future canonical route rollout must preserve demo compatibility and avoid links to unimplemented destinations.
