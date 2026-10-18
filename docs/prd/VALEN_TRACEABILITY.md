# Valen acceptance traceability

Baseline: `3fa80ce`, clean current master (origin refreshed). The supplied brief is preserved in `docs/agent-tasks/valen/VALEN_IMPLEMENTATION_PROMPT.md`. All 16 Valen story acceptance criteria match the local immutable Requirement CSV. P0 has 13 stories; P1 Travel is gated on P0 completion.

Status is implementation evidence, not a claim that unavailable dependencies are complete.

| Story | Priority | AC | Verbatim acceptance criterion | Test | Status | Notes / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| US-05-01 | P0 | 1 | Given konteks Australia, then badge "Australia · <kota> · <status>" serta teks hari sejak tiba dan tanggal visa berakhir tampil. | Pending | NOT_STARTED | Implementation pending |
| US-05-01 | P0 | 2 | Given OSHC berakhir 20 hari lagi, then OSHC dihitung di "Aktif" dan "Berakhir ≤ 30 hari". | Pending | NOT_STARTED | Implementation pending |
| US-05-01 | P0 | 3 | Given BPJS tersimpan saat konteks Australia, then BPJS tampil dengan label "Indonesia". | Pending | NOT_STARTED | Implementation pending |
| US-05-01 | P0 | 4 | Given belum ada dokumen, then empty state dan tombol unggah tampil. | Pending | NOT_STARTED | Implementation pending |
| US-05-01 | P0 | 5 | Unit test rules_engine lulus untuk batas 0 dan 30 hari serta dua zona waktu. | Pending | NOT_STARTED | Implementation pending |
| US-05-01 | P0 | 6 | Tidak ada nomor polis atau member lengkap di screen ini. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 1 | Given konteks AU dan belum ada OSHC, then rekomendasi teratas "Unggah sertifikat OSHC kamu" tampil dengan tautan sumber. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 2 | Given OSHC berakhir sebelum visa, then rekomendasi "Ada jeda <n> hari antara asuransi dan visa" tampil dan membuka SC-04?task=visa_cover. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 3 | Given konteks ID, then aturan [AU] tidak pernah muncul. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 4 | Given 5 aturan terpicu, then hanya 3 dengan prioritas tertinggi yang tampil. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 5 | Given rekomendasi kewajiban visa, then tombol Abaikan tidak tersedia. | Pending | NOT_STARTED | Implementation pending |
| US-05-02 | P0 | 6 | Setiap rekomendasi yang tampil memiliki rule_id yang tercatat. | Pending | NOT_STARTED | Implementation pending |
| US-05-03 | P0 | 1 | Keempat tombol membuka route yang benar. | Pending | NOT_STARTED | Implementation pending |
| US-05-03 | P0 | 2 | Given konteks Australia, then teks darurat menampilkan 000; given konteks Indonesia, then 119. | Pending | NOT_STARTED | Implementation pending |
| US-05-03 | P0 | 3 | Mengubah /kb/AU/emergency.json mengubah nomor yang tampil tanpa mengubah kode. | Pending | NOT_STARTED | Implementation pending |
| US-05-03 | P0 | 4 | Given user belum punya perlindungan, then tombol Siapkan klaim disabled dengan tooltip. | Pending | NOT_STARTED | Implementation pending |
| US-05-03 | P0 | 5 | Tautan darurat terlihat tanpa scroll pada lebar layar 375 px. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 1 | Given user belum punya polis tersimpan, then empty state dan tombol ke SC-03 tampil, dan input disabled. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 2 | Given persetujuan external_ai belum aktif, then input terkunci dan banner ke SC-12 tampil. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 3 | Given konteks AU, then chip contoh berisi pertanyaan tentang OSHC/GP; given konteks ID, then chip berisi pertanyaan tentang BPJS/asuransi kantor. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 4 | Given user memilih satu polis di dropdown, then retrieval hanya memakai klausul dari polis tersebut. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 5 | Given pertanyaan "obat apa yang cocok untuk radang tenggorokan?", then agen menolak memberi nasihat medis dan menampilkan tautan ke SC-07. | Pending | NOT_STARTED | Implementation pending |
| US-06-01 | P0 | 6 | Given pertanyaan ke-21 dalam satu jam, then pesan batas tampil dan pertanyaan tidak diproses. | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 1 | Given pertanyaan "Periksa gigi ditanggung nggak?" pada polis OSHC demo, then jawaban menyatakan perawatan gigi umum tidak termasuk, dengan kutipan klausul pengecualian dan halamannya. | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 2 | Given jawaban tampil, then setiap poin memiliki minimal satu chip kutipan yang bisa dibuka ke potongan klausul asli. | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 3 | Given respons LLM berisi poin tanpa kutipan, then poin tersebut dibuang dan audit guardrail uncited_answer tercatat. | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 4 | Given pertanyaan tentang manfaat yang tidak ada di polis, then blok "Tidak ditemukan di dokumen" dan langkah verifikasi tampil, tanpa kata "tidak ditanggung". | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 5 | Given klausul berbahasa Inggris, then kutipan tampil dalam bahasa asli dan penjelasan dalam Bahasa Indonesia. | Pending | NOT_STARTED | Implementation pending |
| US-06-02 | P0 | 6 | Given JSON LLM tidak valid dua kali, then pesan "Belum bisa menjawab" tampil tanpa stack trace. | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 1 | Given limit AUD 500 dan terpakai AUD 120 berstatus Ditemukan, then kartu menampilkan Sisa AUD 380 berlabel "Dari dokumen". | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 2 | Given field limit berstatus Belum terverifikasi, then poin terkait berlabel "Estimasi". | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 3 | Given used_amount tidak ada, then tampil "Sisa: tidak diketahui" berlabel "Perlu konfirmasi". | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 4 | Given teks LLM menyebut angka yang berbeda dari rules_engine, then angka diganti nilai rules_engine dan audit guardrail number_mismatch tercatat. | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 5 | Unit test rules_engine untuk sisa limit lulus pada tiga kasus: normal, used kosong, used > limit. | Pending | NOT_STARTED | Implementation pending |
| US-06-03 | P0 | 6 | Nominal tampil dalam mata uang dokumen tanpa konversi. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 1 | Given konteks AU dan user mengetik "aku sesak napas, ditanggung nggak?", then LLM tidak dipanggil dan user diarahkan ke SC-08 dengan nomor 000. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 2 | Given konteks ID dengan teks yang sama, then SC-08 menampilkan nomor 119. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 3 | Given teks berbahasa Inggris "chest pain", then pemicu tetap terdeteksi. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 4 | Given pemicu terdeteksi, then satu entri audit guardrail red_flag tampil di /audit?type=guardrail. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 5 | Given teks tanpa tanda bahaya ("periksa gigi ditanggung?"), then alur normal US-06-02 berjalan. | Pending | NOT_STARTED | Implementation pending |
| US-06-04 | P0 | 6 | Test guardrail triase (W-43) lulus untuk minimal 10 frasa uji dari red_flags.json. | Pending | NOT_STARTED | Implementation pending |
| US-07-01 | P0 | 1 | Given konteks AU, then chip jenis layanan memuat GP dan berasal dari /kb/AU/pathways.json. | Pending | NOT_STARTED | Implementation pending |
| US-07-01 | P0 | 2 | Given keluhan "sesak napas berat", then user diarahkan ke SC-08 tanpa menampilkan perbandingan. | Pending | NOT_STARTED | Implementation pending |
| US-07-01 | P0 | 3 | Given keluhan atau jenis layanan kosong, then tombol Bandingkan jalur disabled. | Pending | NOT_STARTED | Implementation pending |
| US-07-01 | P0 | 4 | Given form valid, then hasil perbandingan tampil (US-07-02). | Pending | NOT_STARTED | Implementation pending |
| US-07-01 | P0 | 5 | Form tidak memiliki field riwayat penyakit atau obat. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 1 | Given konteks AU, OSHC aktif, dan layanan GP, then minimal kartu GP dan urgent care tampil, masing-masing dengan langkah, syarat, perkiraan biaya (AUD, label Estimasi), dan dokumen. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 2 | Given konteks ID dengan BPJS dan asuransi kantor, then kartu BPJS dan asuransi kantor tampil. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 3 | Given prioritas "Biaya berobat rendah", then badge "Paling sesuai prioritasmu" ada di kartu dengan perkiraan biaya terendah, beserta alasannya. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 4 | Tidak ada angka waktu tunggu di kartu mana pun. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 5 | Mengubah /kb/AU/pathways.json mengubah isi kartu tanpa mengubah kode. | Pending | NOT_STARTED | Implementation pending |
| US-07-02 | P0 | 6 | Setiap kartu memiliki tautan sumber dan tanggal cek. | Pending | NOT_STARTED | Implementation pending |
| US-07-03 | P0 | 1 | Given status jaringan provider tidak diketahui, then item "provider dalam jaringan" tampil dengan langkah cek dari verification_steps.json. | Pending | NOT_STARTED | Implementation pending |
| US-07-03 | P0 | 2 | Given konteks ID dan kapj_status unknown, then item koordinasi BPJS–asuransi kantor tampil. | Pending | NOT_STARTED | Implementation pending |
| US-07-03 | P0 | 3 | Given semua syarat terverifikasi, then pesan "Semua syarat utama sudah terverifikasi" tampil. | Pending | NOT_STARTED | Implementation pending |
| US-07-03 | P0 | 4 | Given user menekan "Salin pertanyaan untuk klinik", then daftar pertanyaan tersalin ke clipboard. | Pending | NOT_STARTED | Implementation pending |
| US-07-03 | P0 | 5 | Maksimal 5 item tampil. | Pending | NOT_STARTED | Implementation pending |
| US-07-04 | P0 | 1 | Given user memilih kartu GP dan mengonfirmasi, then satu claim_case berstatus Draft tercipta dan /claims/[id] terbuka. | Pending | NOT_STARTED | Implementation pending |
| US-07-04 | P0 | 2 | Given tombol ditekan dua kali dengan cepat, then hanya satu kasus tercipta. | Pending | NOT_STARTED | Implementation pending |
| US-07-04 | P0 | 3 | Given user menekan Batal, then tidak ada kasus tercipta. | Pending | NOT_STARTED | Implementation pending |
| US-07-04 | P0 | 4 | Given kartu IGD, then tombol membuka SC-08, bukan membuat kasus. | Pending | NOT_STARTED | Implementation pending |
| US-07-04 | P0 | 5 | Entri audit claim_case_created tercatat. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 1 | Given konteks AU dan status Pelajar, then OSHC tampil di grup Wajib dengan tautan sumber dan tanggal cek. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 2 | Given konteks AU dan status Pekerja, then daftar Wajib mengikuti aturan pekerja di coverage_needs.json, bukan aturan pelajar. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 3 | Given konteks ID, then daftar kebutuhan berasal dari /kb/ID/coverage_needs.json. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 4 | Mengubah coverage_needs.json mengubah daftar tanpa mengubah kode. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 5 | Tidak ada nama produk atau penyedia yang direkomendasikan. | Pending | NOT_STARTED | Implementation pending |
| US-14-01 | P0 | 6 | Given user mengubah status di SC-02, then daftar kebutuhan diperbarui. | Pending | NOT_STARTED | Implementation pending |
| US-14-02 | P0 | 1 | Given OSHC aktif dengan tanggal berstatus Ditemukan, then status OSHC "Sudah punya" dengan alasan berisi penyedia dan masa berlaku. | Pending | NOT_STARTED | Implementation pending |
| US-14-02 | P0 | 2 | Given OSHC berakhir 31-03-2027 dan visa berakhir 15-06-2027, then kartu OSHC menampilkan "Ada jeda 76 hari" dengan tautan ke SC-04. | Pending | NOT_STARTED | Implementation pending |
| US-14-02 | P0 | 3 | Given polis tidak memuat kategori gigi, then kebutuhan cover gigi berstatus "Belum punya" dengan alasan "tidak ditemukan di dokumen yang kamu unggah". | Pending | NOT_STARTED | Implementation pending |
| US-14-02 | P0 | 4 | Given tanggal berakhir OSHC Belum terverifikasi, then statusnya "Perlu dicek". | Pending | NOT_STARTED | Implementation pending |
| US-14-02 | P0 | 5 | Given data yang sama, then hasil jeda visa di SC-14 identik dengan SC-04. | Pending | NOT_STARTED | Implementation pending |
| US-16-01 | P1 | 1 | Given tanggal kembali sebelum tanggal berangkat, then pesan validasi tampil dan tombol disabled. | Pending | NOT_STARTED | P0 gate |
| US-16-01 | P1 | 2 | Given tujuan Liburan, then form menerima lebih dari satu negara tujuan. | Pending | NOT_STARTED | P0 gate |
| US-16-01 | P1 | 3 | Form tidak memiliki field paspor, visa, atau tiket. | Pending | NOT_STARTED | P0 gate |
| US-16-01 | P1 | 4 | Given rencana disimpan, then rencana muncul di daftar dan bisa diedit atau dihapus. | Pending | NOT_STARTED | P0 gate |
| US-16-02 | P1 | 1 | Given OSHC demo dengan klausul wilayah yang hanya berlaku di Australia dan rencana liburan ke Prancis, then baris OSHC berstatus "Tidak" dengan kutipan klausulnya. | Pending | NOT_STARTED | P0 gate |
| US-16-02 | P1 | 2 | Given polis perjalanan berakhir 3 hari sebelum tanggal kembali, then tampil "Ada jeda 3 hari". | Pending | NOT_STARTED | P0 gate |
| US-16-02 | P1 | 3 | Given klausul wilayah tidak ditemukan, then status "Perlu konfirmasi" dengan langkah verifikasi. | Pending | NOT_STARTED | P0 gate |
| US-16-02 | P1 | 4 | Given ada celah, then tombol ke US-16-03 dan SC-17 tampil. | Pending | NOT_STARTED | P0 gate |
| US-16-03 | P1 | 1 | Given rencana Studi ke Australia, then OSHC tampil sebagai Wajib dengan sumber resmi dan status kepemilikan. | Pending | NOT_STARTED | P0 gate |
| US-16-03 | P1 | 2 | Given rencana Kerja ke negara tanpa basis pengetahuan, then label "Panduan umum – belum spesifik negara" tampil tanpa angka nominal. | Pending | NOT_STARTED | P0 gate |
| US-16-03 | P1 | 3 | Status kepemilikan memakai fungsi yang sama dengan US-14-02 (dibuktikan unit test bersama). | Pending | NOT_STARTED | P0 gate |
| US-16-03 | P1 | 4 | Tidak ada nama produk atau penyedia yang direkomendasikan. | Pending | NOT_STARTED | P0 gate |
