# Insurra — Valen implementation agent brief (source-grounded)

> Generated from the uploaded PRD screens, requirements, API contracts and data-schema CSV files, and inspected against the last shared `3fa80ce` source snapshot. Read this file **in full**. The live checked-out repository and any newer changes take precedence for physical code layout; PRD remains authoritative for product behavior. This file is an implementation instruction for the coding agent, not a claim that code has already been implemented.

## ROLE AND OBJECTIVE

You are a senior full-stack engineer (FastAPI/Python + Next.js/TypeScript), focused on implementing **Valen's Insurra ownership** from end to end, not on producing a plan only. Work on an isolated feature branch created from the current **up-to-date** `master`. Build real working frontend and backend with validated schemas, versioned country KB, security/consent guardrails, deterministic rules, source-backed answers, unit/integration/E2E tests, and logical Conventional Commits.

**Scope:** 13 P0 user stories across SC-05 Command Center `/home`, SC-06 Tanya Polis `/ask`, SC-07 Bandingkan Jalur `/pathways`, SC-14 Kebutuhan Perlindungan `/coverage-needs`. 3 P1 stories for SC-16 Travel `/travel`, **after P0 is complete and tested**. This is not a general rewrite of the app. Existing live authentication, onboarding, document processing, profile, and privacy belong to Rere; emergency triage UI, claim readiness/actions/audit belong to Joshua. Integrate through their contracts, don't replace their work.

**Goal:** a reliable, connected AU (Raka) and ID (Sinta) user journey in Indonesian, with real server-backed state and correct evidence. Where a dependent module is incomplete, provide an explicitly honest, tested degraded state or narrow adapter; don't fake success.

## 0. PREFLIGHT — MANDATORY

1. Read repo root `AGENTS.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, README, docs/prd decision/mapping files, `.github/workflows/`, `Makefile` and the 5 local CSV PRDs under `docs/prd/` if present. DO NOT commit ignored PRD files. This brief includes authoritative Valen rows verbatim in Appendix A if local CSVs are absent.
2. Inspect `git status`, `git branch`, `git log -8 --oneline`, the current origin/master pointer, all currently implemented routes and schemas, and the actual DB models/migrations. The last shared source snapshot was `3fa80ce`, but new commits from teammates may supersede it. If changes are uncommitted or conflict with this scope, **preserve them**, report and resolve without resetting/stashing other people's work. Never force push/rebase/overwrite master.
3. Work from an up-to-date `master`; create `feat/valen-p0-command-policy-pathways` (or an equally clear dedicated branch), unless already on an appropriate feature branch. Do not commit directly on master and do not push unless explicitly requested. If `master` cannot safely be checked out or updated, stop and request direction rather than stomping the working tree.
4. Inspect and preserve Rere's **authenticated account** flow (`Authorization: Bearer ...`, account-owned `account_profiles`, `account_coverages`, `account_fields`, `account_documents`, `account_document_pages`, `account_consents`) plus existing demo session endpoints. **Important prior snapshot trap:** `backend/app/api/v1/foundation.py` has canonical 501 contracts relying on demo-session dependencies, while Rere added real account endpoints. Do not accidentally implement Valen features that work only for demo sessions or assume `X-Demo-Session` is account authentication. Prefer shared actor-aware dependencies/repositories, preserving both modes if supported.
5. Inspect current account frontend auth context and API client. Reuse their bearer auth, existing `AppShell`, common UI and CSS design; never create a second login/session implementation.
6. Before implementing, print a concise plan with per-story dependency mapping; **then code and test**. Never stop at planning or scaffolding.

## 1. OWNERSHIP, ROUTES, WIRE CONTRACTS

| Screen | Route | Stories | Scope |
|---|---|---|---|
| SC-05 Command Center | `/home` | US-05-01..03 | P0 |
| SC-06 Tanya Polis | `/ask` | US-06-01..04 | P0 |
| SC-07 Bandingkan Jalur Layanan | `/pathways` | US-07-01..04 | P0 |
| SC-14 Cek Kebutuhan Perlindungan | `/coverage-needs` | US-14-01..02 | P0 |
| SC-16 Perencana Perjalanan | `/travel` | US-16-01..03 | P1; after P0 |

Use canonical API prefix `/api/v1`, not duplicate unversioned `/api` endpoints. Respect all existing Pydantic/OpenAPI contract shape and account-based access. The PRD's `/api/...` maps to `/api/v1/...` by existing architecture decision.

**Four canonical P0 operations owned by Valen:**
- `GET /api/v1/home/summary` → `{active, expiring_30d, needs_verification, recommendations[<=3]}`; may be *additively* enriched for detailed cards / context / source, but do not silently break generated TS types.
- `POST /api/v1/ask` body `{question, coverage_id?}` → streaming `answer_points[{text,label,citations[{doc,page,quote}]}]`, or `{redirect:'emergency'}`. Reuse `AskAnswer`, `AnswerPoint`, `AskStreamEvent` in `schemas/foundation.py`; validate SSE encoding/sequence and error events. Include content-type/Accept negotiation only as explicitly needed. Do not fabricate stream data when AI unavailable.
- `POST /api/v1/pathways/compare` body `{complaint,service_type,city?}` → `{paths:[{name,steps,requirements,est_out_of_pocket,docs,uncertainties,sources,...}]}` or emergency redirect. Reuse existing Pathway schemas, compatible optional metadata.
- `POST /api/v1/claims` body `{path,coverage_id}` → `{claim_case_id}`; implement only **case creation** owned by Valen. The claim checklist/draft/evidence/actions remain Joshua-owned.

**Coverage needs:** reuse existing registered `GET /api/v1/coverage-needs` shape (list of typed `CoverageNeed`), extending it safely if required for complete SC-14 cards; align OpenAPI/TS and document amendments. No second parallel endpoint unless unavoidable.

**Triage dependency:** Joshua owns `POST /api/v1/triage` and SC-08. Call deterministic, server-side triage *before any LLM call or care comparison*. Use a reusable adapter/service contract tested with a triage fixture. If triage KB or Joshua's endpoint is unavailable/unverified, **do not assume the symptom is safe**; provide safe fail-closed messaging/no AI and clear emergency link, explicitly report blocker. Do not implement SC-08 over Joshua's work.

**Actions and claim readiness:** `SC-10 /actions` owned by Joshua. For `Buat pengingat`, use shared pending-action interface when available; do not fake created reminders or perform an action without approval. US-07-04 may create a case with owner-verified coverage and server-enforced idempotency, then link to `/claims/{id}` (SC-09 owned by Joshua). If SC-09 UI is absent, keep honest 'case created, next screen not yet available' state instead of inventing claim completion.

Update OpenAPI source of truth, run type generation (`make generate-types`) and contract drift checks (`make check-contracts`, `make check-prd-contracts`, and `make check-prd-source` when local PRD present). Do not hand-edit generated TS types. If a shape cannot meet both current client and PRD, implement additive compatibility and document exact decision in `docs/prd/DECISIONS.md` with tests.

## 2. DATABASE AND INTEGRATION

- Reuse account/actor IDs from verified auth; scope every `coverage_id`, `document_id`, `claim_case_id`, `chat_session_id` and file reference to the authenticated owner. Foreign IDs must not leak existence; use consistent error contract. Demo sessions remain distinct owners, not implicit accounts.
- Reuse Rere's normalized account coverages/fields/documents and existing foundation demo `UnifiedInsuranceRecord`; create a **single adapter** that presents a canonical coverage / extracted-field / evidence view to Valen's modules. Avoid two contradictory sources of truth or duplicating user profile data.
- Add only necessary **additive** SQLAlchemy/Alembic migrations for `benefits`, `clause_chunks` / validated queryable excerpts, account-owned claim_cases and any session/rate-limit/recommendation-dismiss tables actually needed. Check existing migrations and tables first; no destructive schema resets or `create_all` startup. Keep SQLite and PostgreSQL portable; use numeric decimal strings for amounts, datetime with timezone semantics, indexes, unique/idempotency constraints.
- PRD data ownership explicitly assigns `benefits`, `clause_chunks` and `claim_cases` to Valen, although document extraction, profile, and raw document pages are Rere's scope. Document the ingestion contract Rere must provide: reviewed coverage IDs, benefit categories/limits/currency/confidence, verified evidence with page number and exact text. Implement a deterministic/idempotent sync or reader of currently available normalized fields; never invent extracted fields or fake benefits.
- **Retention privacy dependency:** when retention consent is off, do not persist raw full page text, clause text or embeddings derived from content in violation of consent. Explicitly reconcile with Rere's retention behavior; citations can use approved temporary material only when available, otherwise explain that re-upload/consent is needed. On deletion/revocation purge or make inaccessible relevant chunks/history in accordance with existing rules. Avoid logging raw questions, symptoms, document text, tokens or exact policy/member IDs.
- Authenticated workspace should work end-to-end; synthetic demo persona support must not be removed. Use tested account-bound service dependencies, not direct database queries from Next.js.

## 3. SC-05 `/home`: DETERMINISTIC COMMAND CENTER (P0)

Implement US-05-01, 05-02, 05-03 exactly, with Indonesian copy and responsive app shell.

- Context header: first-name greeting, country/city/status badge, days since arrival where applicable and visa expiry, with timezone `zoneinfo` using active profile/country KB. Handle future arrivals, missing dates, timezone mismatches, expired/other-country policies.
- 3 number cards: active, expiring within **inclusive 0–30 days** (subset of active), and needs verification. Active: start<=today<=end; undated-ended BPJS only counted active when user-verified. Include all countries with their real country tags. No raw member or policy numbers. Empty state → `/documents`.
- Rule-driven recommendations (top 3 maximum), from country `recommendation_rules.json`, with rule_id, priority, context & source. Validate metadata before using regulatory rules; unverified regulation cannot be asserted as legal obligation. Rule order: AU missing required student cover; AU visa gap; missing required field; expiry<=30; ID BPJS unknown; injection-flag docs; failed processing. **No LLM-generated recommendation**. Omit or show 'needs verification' safely when data/rule unverifiable.
- Dismiss non-visa suggestions 7 days persisted per user/rule/subject; visa-related rules not dismissible (mark 'handled' with confirmation only). Link actions to canonical routes with task/policy prefills. Pending reminder integration must go through Joshua's actions interface.
- Four quick actions `/ask`, `/pathways`, `/claims`, `/coverage-needs`. Disable claim when no available protection. Country emergency number from verified `emergency.json`, not hardcoded in UI. Always show emergency CTA above fold at 375px; when unverified show a safe 'check local emergency services' fallback, don't assert a guessed number.
- Tests: AU/ID, Raka/Sinta, empty state, mixed-country coverages, missing dates, timezone boundary (Melbourne/Jakarta), 0 and 30-day expiry, confidentiality, ordering/maximum three, seven-day dismiss, non-dismissable visa warning, KB config mutation changes output.

## 4. SC-06 `/ask`: POLICY Q&A WITH VALID CITATIONS (P0)

Implement US-06-01..04 with authentic account/consent, retrieval and policy enforcement.

**Frontend:** max 500-char text, policy selection ('semua' or owned coverage), 3–4 context-sourced example chips (not hardcoded), session history (last 10 turns), new conversation, loading/cancel/retry, source drawer with original quote/page and user-visible evidence status, feedback buttons; no coverage → documents CTA, missing consent → privacy CTA. Mobile responsive, screen reader friendly, Indonesian copy.

**Backend:** server validates consent (`process_documents` AND `external_ai`) each request; owner scoping; 20 questions/hour/account persistent rate limit (proper 429), max ten turns of context per conversation, scoped policy filter, decline diagnosis/treatment/general noninsurance with polite redirect, and run **triage before every LLM call** (including negated red-flag phrases). Emergency trigger returns/streams redirect, logs red_flag id/version only, never policy answer/benefits/cost.

**Retrieval:** read clause chunks only for current actor and allowed documents/coverage; top five max, multilingual ID/EN, deterministic lexical fallback if embeddings unavailable (no invented relevance). Source quote is verbatim substring of authenticated document page/chunk; validate document id+page+quote provenance server-side. Don't present general model knowledge as a policy clause. If no relevant clause, show 'Tidak ditemukan di dokumen' with KB verification steps (NOT 'Tidak ditanggung'). Flag instruction-like document content as untrusted; refuse fabricated citations. Original source view must honor retention, privacy and page access.

**AI:** use existing `ai_gateway.py` and configured model via `OPENAI_MODEL`, structured Pydantic outputs (backend domain authority) validated and **retry at most once**. Backend policy layer rejects answer points without validated citations and logs masked `uncited_answer` events. No real network calls in CI. Exact explanation vs original quote; 5 answer points maximum, each cited. Display one certainty label per point (`FROM_DOCUMENT`, `ESTIMATE`, `NEEDS_CONFIRMATION`) based on evidence/field provenance, not just model suggestion.

**Numbers:** benefits/remaining limits/date/excess deterministic with Decimal and source-state. `remaining=limit-used` only if both known and same valid period; used absent → unknown, used>limit test negative/zero semantics clearly, currency no conversion. Never let LLM invent or compute numerical values. Reject/substitute model numeric values that disagree with a verified rule result and audit `number_mismatch`. Safer: assemble structured numeric facts outside model-generated natural language. Don't claim certainty of payment. Streaming: proper SSE event types + clean completion/error, cancellation, UTF-8, heartbeat where appropriate; meet first visible useful chunk <=5 seconds in mocked demo fixtures, do not fake network performance guarantees.

**Tests:** dental exclusion only if backed by exact synthetic **policy clause**; quotes English verbatim, no-citation dropped, no-match unknown, wrong foreign doc ID, cross-user contamination, missing consent, revoked consent, rate limit 21st, 10-turn cap, malicious document prompt injection, red-flag phrase both ID/EN incl negation → zero AI calls, absent used amount, mismatched number audit, invalid JSON twice → user-friendly error, streaming format/progress handling and UI citation click to page.

## 5. SC-07 `/pathways`: COUNTRY-KB SERVICE PATH COMPARISON (P0)

Implement US-07-01..04.

- Form: complaint <=300 chars, service type chips loaded from versioned pathways KB, city prefilled/editable, timeframe today/this week/unknown. Consent/auth, no medical diagnosis, no medical history or prescription requests. Triage before comparison; suspicious symptoms redirect to Joshua `/emergency` with no cards or prices. Emergency CTA always visible.
- Results: 2–3 relevant path cards where KB allows it. AU examples GP, urgent care, hospital ED as potential emergency redirect; ID examples BPJS, employer, personal. **Names/steps/requirements/from KB only**, not hardcoded. Display coverage match, 3–5 steps, referrals/network/billing caveats, docs to preserve, exact checked_at and official source where verified. No invented wait times or cost benchmarks. `best for your priorities` badge based on deterministic profile priority weighting and sourced estimates—not diagnosis.
- Cost estimate: Decimal rules from policy benefits/excess/claim mode + KB reference tariffs **only if valid source or clearly labeled synthetic demonstration assumption**. Do not show numeric costs if tariff or eligibility unknown; return null / 'Perlu konfirmasi'. A true denial ('tidak ditanggung') requires exact exclusion citation; otherwise unknown. No currency conversion.
- Unknowns: max five, from unverified/missing benefit fields, provider network, referral/eligibility, ID KAPJ unknown and verification steps from KB; copy questions button; pending reminder via Joshua API if live, otherwise explicit unavailable (do not fake action).
- Choosing route: confirmation modal showing chosen pathway, coverage and documents, direct-billing caveat; idempotent `POST /api/v1/claims` creates exactly one actor-owned `DRAFT` case for one decision, scrub complaint to <=80-character masked summary, audit `claim_case_created`, redirect `/claims/{id}`. ED/emergency cards **never create cases**, only open `/emergency`. Use server-side idempotency key and DB protection; double-click/client disable not sufficient. Validated policy/path and ownership required. Do not implement Joshua's claim checklist/draft beyond contract.
- Tests: AU+ID config-driven cards, missing data fallback, no unsupported 'not covered' claim, 2–3 max, priority ranking, no wait time numbers, 5-unknown maximum, copy questions, KAPJ unknown, coverage scoping, red-flag fail-close, duplicate claim request leads one DB record, cancel → none, ED → no claim, audit, cross-actor 404.

## 6. SC-14 `/coverage-needs`: NEEDS + OWNERSHIP (P0)

Implement US-14-01..02, including country/occupation/dependents/visa-context filters using versioned `coverage_needs.json`. Same matching engine shared by future `/travel`.

- Two groups REQUIRED / RECOMMENDED, source and checked date on each applicable rule, context badge and 'x of y owned', edit-profile CTA. No specific insurance purchase/product recommendation.
- **REQUIRED** only if verified *official* regulatory source; otherwise conservatively label 'Perlu konfirmasi' rather than falsely asserting a legal requirement. AU student vs worker use distinct applicability. ID loads ID KB. Unsupported countries 'Segera hadir'. Re-read context after edits; do not hardcode names in Python/TS.
- Match needs to active coverage type and verified benefit categories with source/status: OWNED only when active and essential fields found/confirmed; UNVERIFIED or MISSING core fields → NEEDS_CHECK; absent matching verified record may be NOT_OWNED, but copy says 'Tidak ditemukan di dokumen', never a categorical exclusion without exact citation. Dental example as in PRD. Deterministic match: source evidence + amount rules + data provenance; no LLM.
- For student insurance need show visa gap from **same existing** visa assessment logic as SC-04; no duplicate date algorithm. Link to `/completeness?task=visa_cover`. Log compare audit without sensitive details.
- Tests: AU student/worker, ID, requirements file mutation changes output, 76-day **synthetic** sample fixture matches SC-04 precisely, unknown expiration → NEEDS_CHECK, no policy vs missing field distinct, verified citation for actual exclusions, user editing profile refreshes results, no brands/products promoted.

## 7. SC-16 `/travel`: P1 — IMPLEMENT ONLY AFTER P0 ALL GREEN

US-16-01..03 are included verbatim below. Unless user explicitly says to omit P1, implement after all P0 acceptance criteria, migrations, frontend builds, Playwright tests, CI and docs are green, and after reporting expected effort. Keep route behind a nonintrusive feature flag if incomplete; don't put unfinished travel in primary P0 navigation.

- `/travel`: up to five account-owned itineraries; purpose travel/study/work, multi-country for travel and one for study/work, date validation, optional activities, no passport/ticket/medical histories. Add `trips` model/additive migration when actually implementing; edit/delete.
- Compare journey date coverage using same deterministic interval core. Territorial/exclusion status requires exact quote: unknown quote = NEEDS_CONFIRMATION; `NOT_COVERED` only with actual exclusion evidence. Reminder as pending action only; no execution.
- Destination needs reuse SC-14 needs-matching engine for AU/ID; countries without KB receive clearly labeled general checklist without sourced-pretend visa obligations/cost thresholds. No brand/product recommendations. Unit tests shared with SC-14 and integration tests for travel.

## 8. CROSS-CUTTING KB + SOURCE POLICY

- KB resource envelopes must be parseable by existing `CountryKBLoader`/`schemas/kb.py` (`schema_version`, `version`, `source_url`, `checked_at`, `verification_status`, `data`), synchronized with manifest version. Preserve existing nonempty verified data and update only what is needed. Check actual schema before editing.
- Rere/Joshua may own shared KB (`red_flags`, `emergency`, document types); do **not** invent sources or edit their content without coordination. Own/extend recommendation rules, example policy questions, coverage needs, pathways and verification step proposals using small additive, reviewed changes.
- A big risk in the current source snapshot: `recommendation_rules.json`/`verification_steps.json`/`red_flags.json` were empty and `emergency.json` number null/UNVERIFIED. **Don't silently convert placeholder to verified.** If current PRD requires official sources, identify authentic sources, checked date and applicability before enabling 'wajib' or an emergency number; otherwise keep UNKNOWN, show fallback and report acceptance blocker. Regulatory/medical citations are independent of policy-document citations; neither can substitute for the other.
- For synthetic Raka/Sinta data, use explicit demo/fiction labels. A fabricated example source must never be represented as an official policy clause or real regulatory page.
- Mark ALL user-visible screens primarily in Bahasa Indonesia; responsive at 375px and desktop; keyboard, focus, ARIA, consistent loading/skeleton/empty/error states. Follow existing design tokens and visual style rather than creating a disconnected UI.

## 9. TESTS / QUALITY GATES — NONNEGOTIABLE

- Map every AC from Appendix A to at least one backend unit/integration or frontend component/E2E test; maintain `docs/prd/VALEN_TRACEABILITY.md` with story ID, AC, files, test, status (`PASSED`, `BLOCKED`, `PARTIAL`, `NOT_STARTED`), and blocker/owner when applicable.
- Mock OpenAI with deterministic model fixtures for offline CI; test real OpenAI with explicit separate opt-in command only, no API key in CI. Ensure AI failure leads to honest user-facing fallback, not faux policy answers.
- Guardrails: unauthorized other-account data 404, missing/revoked consent 403, 20/h rate limit 429, no raw tokens/queries/document/medical data in logs/audit, no injection instructions followed, invalid KB/empty KB result safe, no fabricated source/cost/coverage, robust `ApiError` consistent.
- Regression: original Rere registration/onboarding/documents/coverage/privacy and Joshua interfaces must still work. `make test`, `make test-client`, `make check-contracts`, `make check-prd-contracts`, `make check-prd-source` where CSVs exist, `make check`, frontend `npm run build`, `npm run test:e2e` all executed and reported with exact failures (do not claim green without running). New tests must not be skipped/deleted/relaxed to pass.
- If frontend API URL isn't configured because only Vercel frontend is live, show proper network-unavailable state; do not force browser requests to localhost in production. Never embed API keys in `NEXT_PUBLIC_*` or frontend bundle.

## 10. IMPLEMENTATION SEQUENCE, COMMITS AND STOP RULES

Commit by logical unit, after relevant tests:

1. `chore(valen): map PRD contracts and integration boundaries` — doc/traceability only
2. `feat(data): add scoped benefits and clause persistence` — required migrations/repositories only
3. `feat(home): implement deterministic command center` — rules, endpoint, UI, tests
4. `feat(coverage): implement country-driven protection needs` — engine, endpoint, UI, tests
5. `feat(ask): implement evidence-grounded policy qna` — retrieval, guardrails, API, chat UI, tests
6. `feat(pathways): implement country-aware service comparisons` — calculator, UI, tests
7. `feat(claims): create idempotent claim cases from selected pathways` — Valen-only integration
8. `test(valen): cover PRD acceptance and cross-feature regressions`
9. `docs(valen): finalize usage and integration handoff`
10. *Only after P0 green:* `feat(travel): implement itinerary checks and destination needs` — P1 behind flag as needed.

Do not create empty commits or commit unfinished misleading documentation. Never push to master automatically. If a breaking shared schema change is unavoidable, document it for Rere/Joshua and stop for coordination before merging. Keep current branch changes intact.

**Final deliverables:**
- Working backend routes and services, real frontend pages `/home`, `/ask`, `/pathways`, `/coverage-needs`, responsive, integrated with **account login** and demo mode if supported.
- Additive migration(s), verified/explicitly-unverified KB data, Pydantic/OpenAPI generated frontend TS, audit/consent and policy guard tests.
- Deterministic example fixtures (including exact source text/page) without fictitious real-world facts, scenario demos Raka/Sinta.
- Traceability matrix per criterion; test report with exact commands; API contract diff; changes to AGENTS.md/README only when necessary.
- Commit log/hash, `git status`, explicit limitations and dependencies on Rere/Joshua, smoke-test instructions (including frontend-only deployment constraint).

**Stop rules:** Never substitute invented official documents, prices, medical triage or citations to make acceptance tests green. If dependent work is incomplete, implement everything within Valen scope, test via integration contract/mocks, and transparently declare BLOCKED cases. No fake successes, no full medical diagnosis, no actual insurance purchase/claim submission, no work on teammates' screens.

---

## APPENDIX A — COMPLETE, VERBATIM VALEN PRD USER STORIES AND ACCEPTANCE CRITERIA

The following story descriptions and acceptance criteria are copied from `PRD - Requirement.csv` without silently changing the business conditions. If local PRD changed, report drift and prioritize the newest authoritative source.

### US-05-01 — Kartu ringkasan perlindungan (P0, SC-05)

Command Center menampilkan kondisi perlindungan user dalam tiga angka utama dan badge konteks negara, agar user yang baru tiba di negara baru (atau baru punya perlindungan di Indonesia) langsung tahu posisinya.
 
 Components:
 - Salam "Halo, <nama depan>" dan badge konteks, misalnya "Australia · Melbourne · Pelajar" atau "Indonesia · Jakarta".
 - Untuk konteks luar negeri: teks kecil "Hari ke-<n> sejak tiba" dan "Visa berakhir <tanggal>".
 - Tiga kartu angka: "Perlindungan aktif", "Berakhir ≤ 30 hari", "Perlu verifikasi"; masing-masing berisi angka besar, label, dan sub-teks.
 - Klik kartu membuka daftar ringkas: nama penyelenggara, jenis perlindungan, negara, tanggal berakhir.
 - Empty state: "Belum ada perlindungan tersimpan" dan tombol "Unggah dokumen pertama".
 
 Cara kerja sistem (rules_engine):
 - Aktif: tanggal mulai ≤ hari ini ≤ tanggal berakhir.
 - Berakhir ≤ 30 hari: aktif dan selisih tanggal berakhir dengan hari ini 0–30 hari.
 - Perlu verifikasi: perlindungan dengan minimal satu data wajib berstatus Belum terverifikasi atau Hilang.
 - Perlindungan tanpa tanggal berakhir (misalnya BPJS) dihitung aktif hanya jika statusnya sudah dikonfirmasi user di SC-04; jika belum, masuk "Perlu verifikasi".
 - Perlindungan dari negara lain tetap dihitung, tetapi diberi label negara (contoh: BPJS berlabel "Indonesia" saat konteks aktif Australia).
 
 Constraint:
 - Semua angka dihitung kode, tidak dari LLM.
 - Perhitungan tanggal memakai zona waktu kota konteks aktif (contoh: Australia/Melbourne, Asia/Jakarta).
 - Nomor polis dan nomor member selalu tersamar di screen ini.
 - Command Center tidak menampilkan detail manfaat polis (itu P1 di SC-13).
 
 Post Condition:
 Angka-angka ini menjadi pemicu rekomendasi tindakan (US-05-02) di halaman yang sama.

**Acceptance criteria:**

• Given konteks Australia, then badge "Australia · <kota> · <status>" serta teks hari sejak tiba dan tanggal visa berakhir tampil.
 • Given OSHC berakhir 20 hari lagi, then OSHC dihitung di "Aktif" dan "Berakhir ≤ 30 hari".
 • Given BPJS tersimpan saat konteks Australia, then BPJS tampil dengan label "Indonesia".
 • Given belum ada dokumen, then empty state dan tombol unggah tampil.
 • Unit test rules_engine lulus untuk batas 0 dan 30 hari serta dua zona waktu.
 • Tidak ada nomor polis atau member lengkap di screen ini.

**Dependencies:** W-11, W-56, US-03-03, US-04-02

### US-05-02 — Rekomendasi tindakan berikutnya (P0, SC-05)

Sistem menampilkan maksimal 3 langkah berikutnya yang paling penting, berdasarkan aturan yang jelas. Untuk user yang baru tiba di luar negeri, rekomendasi teratas biasanya terkait kewajiban asuransi visa, karena risiko terbesarnya ada di sana.
 
 Components:
 - Section "Langkah berikutnya" berisi maksimal 3 kartu.
 - Setiap kartu: ikon, judul, 1–2 kalimat alasan, tautan sumber aturan (jika aturan berasal dari regulasi), tombol aksi, dan tombol "Abaikan".
 - Empty state: "Semua beres untuk saat ini."
 
 Cara kerja sistem (urutan prioritas aturan; aturan per negara dari /kb/{negara}/recommendation_rules.json):
 1. [AU] Belum ada asuransi wajib visa tersimpan → "Unggah sertifikat OSHC kamu" → SC-03.
 2. [AU] Masa cover tidak menutup seluruh masa visa → "Ada jeda <n> hari antara asuransi dan visa" → SC-04 tugas visa_cover.
 3. Data wajib Hilang pada perlindungan aktif → "Lengkapi data <nama polis>" → SC-04 dengan tugas terkait.
 4. Perlindungan berakhir ≤ 30 hari → "Tinjau perpanjangan <nama polis>" → buat draf pengingat ke SC-10.
 5. [ID] Status BPJS belum dikonfirmasi → "Cek status BPJS kamu" → SC-04 tugas BPJS.
 6. Dokumen ber-flag injection → "Periksa dokumen <nama>" → SC-03.
 7. Dokumen gagal diproses → "Unggah ulang <nama>" → SC-03.
 Aturan berlabel [AU] atau [ID] hanya aktif pada konteks negara tersebut. Sistem mengambil 3 rekomendasi teratas.
 
 Constraint:
 - Setiap rekomendasi wajib berasal dari aturan dan menyimpan rule_id; LLM tidak boleh menambah rekomendasi.
 - Aturan yang bersumber dari regulasi (contoh: kewajiban asuransi pelajar di Australia) wajib menyimpan source_url dan checked_at di basis pengetahuan.
 - Teks rekomendasi memakai template; LLM opsional hanya untuk merapikan kalimat.
 - "Abaikan" menyembunyikan rekomendasi selama 7 hari, kecuali aturan nomor 1 dan 2 (kewajiban visa) yang tidak bisa diabaikan, hanya bisa ditandai "Sudah saya urus" dengan konfirmasi.
 - Tidak ada rekomendasi membeli produk asuransi tertentu di P0.
 
 Post Condition:
 Tombol aksi membuka screen tujuan dengan konteks yang sudah terisi (tugas, polis, atau dokumen terkait).

**Acceptance criteria:**

• Given konteks AU dan belum ada OSHC, then rekomendasi teratas "Unggah sertifikat OSHC kamu" tampil dengan tautan sumber.
 • Given OSHC berakhir sebelum visa, then rekomendasi "Ada jeda <n> hari antara asuransi dan visa" tampil dan membuka SC-04?task=visa_cover.
 • Given konteks ID, then aturan [AU] tidak pernah muncul.
 • Given 5 aturan terpicu, then hanya 3 dengan prioritas tertinggi yang tampil.
 • Given rekomendasi kewajiban visa, then tombol Abaikan tidak tersedia.
 • Setiap rekomendasi yang tampil memiliki rule_id yang tercatat.

**Dependencies:** US-05-01, US-04-02, W-12, W-58

### US-05-03 — Pintasan situasi dan nomor darurat lokal (P0, SC-05)

Command Center menyediakan pintasan situasi agar user bisa langsung menuju bantuan yang dibutuhkan, termasuk nomor darurat yang sesuai negara tempat ia berada.
 
 Components:
 - Tiga tombol besar dengan ikon: "Tanya polis" (→ /ask), "Saya perlu berobat" (→ /pathways), "Siapkan klaim" (→ /claims).
 - Tombol keempat "Perlindungan apa yang aku butuhkan?" (→ /coverage-needs, fitur PM2).
 - Teks di bawah tombol "Saya perlu berobat": "Darurat? Hubungi <nomor>". Nomor diambil dari /kb/{negara}/emergency.json (contoh: 000 untuk Australia, 119 untuk Indonesia). Teks ini membuka SC-08.
 - Navigasi utama (sidebar desktop / bottom nav mobile): Home, Dokumen, Tanya, Klaim, Lainnya.
 
 Constraint:
 - Tidak ada input chat, form keluhan, atau perbandingan di Command Center; screen ini hanya menautkan.
 - Nomor darurat tidak boleh ditulis langsung di kode.
 - "Siapkan klaim" disabled jika user belum memiliki perlindungan, dengan tooltip "Unggah polis terlebih dulu".
 - Tautan darurat selalu terlihat tanpa scroll di layar mobile.
 
 Post Condition:
 User berpindah ke screen tujuan; isi dan logika screen tujuan diatur oleh PRD fitur terkait (PM2).

**Acceptance criteria:**

• Keempat tombol membuka route yang benar.
 • Given konteks Australia, then teks darurat menampilkan 000; given konteks Indonesia, then 119.
 • Mengubah /kb/AU/emergency.json mengubah nomor yang tampil tanpa mengubah kode.
 • Given user belum punya perlindungan, then tombol Siapkan klaim disabled dengan tooltip.
 • Tautan darurat terlihat tanpa scroll pada lebar layar 375 px.

**Dependencies:** US-05-01, W-12; screen tujuan dari fitur PM2 (US-06-01, US-07-01, US-08-01, US-09-01, US-14-01)

### US-06-01 — Ajukan pertanyaan tentang manfaat (P0, SC-06)

User bertanya tentang isi perlindungannya dengan bahasa sehari-hari (Bahasa Indonesia atau Inggris) di halaman /ask, dan bisa memilih polis yang ingin ditanyakan. Tujuannya agar user yang memegang polis berbahasa Inggris atau baru pertama kali punya asuransi bisa memahami haknya tanpa membaca seluruh policy booklet.
 
 Components:
 - Halaman /ask dengan area chat, input teks (maksimal 500 karakter), dan tombol "Kirim".
 - Dropdown "Tanya tentang": "Semua perlindungan saya" (default) atau satu polis tertentu (nama penyedia + jenis, contoh "OSHC – <penyedia>").
 - 3–4 chip contoh pertanyaan sesuai konteks negara dari basis pengetahuan. Contoh AU: "Periksa gigi ditanggung nggak?", "Kalau ke GP harus bayar dulu?". Contoh ID: "Konsultasi dokter kulit ditanggung kantor?".
 - Riwayat percakapan dalam sesi dan tombol "Mulai percakapan baru".
 - Teks kecil di bawah input: "Jawaban berdasarkan dokumen yang kamu unggah, bukan nasihat medis."
 - Empty state jika belum ada polis tersimpan: "Unggah polis dulu supaya aku bisa menjawab" dengan tombol ke SC-03.
 
 Constraint:
 - Input dan chip terkunci jika persetujuan process_documents atau external_ai belum aktif, dengan banner ke SC-12 (mengikuti US-01-03).
 - Setiap pertanyaan melewati triage_check (US-06-04) sebelum dikirim ke LLM.
 - Pertanyaan di luar urusan asuransi (diagnosis, pilihan obat, topik umum) dijawab dengan template penolakan sopan, tanpa jawaban polis. Untuk keluhan berobat, tampilkan tautan "Bandingkan jalur berobat" (SC-07).
 - Konteks percakapan memakai maksimal 10 giliran terakhir; pertanyaan lanjutan ("kalau rawat inap?") memakai polis yang sama.
 - Batas 20 pertanyaan per jam per user (hemat biaya AI) dengan pesan yang jelas saat batas tercapai.
 - Contoh pertanyaan diambil dari basis pengetahuan per negara, tidak ditulis di kode.
 - Isi pertanyaan di audit disimpan dalam bentuk tersamar (input_summary).
 
 Post Condition:
 Pertanyaan diteruskan ke orkestrator (US-06-02), atau dialihkan ke SC-08 jika terdeteksi tanda bahaya. Satu entri audit bertipe answer tercatat setelah jawaban selesai.

**Acceptance criteria:**

• Given user belum punya polis tersimpan, then empty state dan tombol ke SC-03 tampil, dan input disabled.
 • Given persetujuan external_ai belum aktif, then input terkunci dan banner ke SC-12 tampil.
 • Given konteks AU, then chip contoh berisi pertanyaan tentang OSHC/GP; given konteks ID, then chip berisi pertanyaan tentang BPJS/asuransi kantor.
 • Given user memilih satu polis di dropdown, then retrieval hanya memakai klausul dari polis tersebut.
 • Given pertanyaan "obat apa yang cocok untuk radang tenggorokan?", then agen menolak memberi nasihat medis dan menampilkan tautan ke SC-07.
 • Given pertanyaan ke-21 dalam satu jam, then pesan batas tampil dan pertanyaan tidak diproses.

**Dependencies:** US-01-03, US-03-03, US-06-04, W-05 (LLM client), W-12 (basis pengetahuan per negara)

### US-06-02 — Jawaban dengan kutipan klausul (P0, SC-06)

Agen menjawab berdasarkan klausul polis milik user dalam Bahasa Indonesia, dengan kutipan asli (bisa berbahasa Inggris) dan nomor halaman yang bisa diklik. Ini inti K2: jawaban bisa diperiksa sendiri dan tidak dikarang.
 
 Components:
 - Jawaban berbentuk poin (maksimal 5). Setiap poin berisi penjelasan Bahasa Indonesia, label kepastian (US-06-03), dan chip kutipan "<nama dokumen> · hal. <n>".
 - Klik chip kutipan membuka panel samping berisi potongan klausul asli (bahasa asli) dengan bagian relevan disorot, plus tombol "Buka dokumen" ke halaman sumber.
 - Istilah lokal ditampilkan asli dengan penjelasan dari glosarium, contoh "excess (biaya yang kamu tanggung sendiri per klaim)".
 - Blok "Tidak ditemukan di dokumen" jika klausul tidak ada, berisi langkah verifikasi dari /kb/{negara}/verification_steps.json (contoh: hubungi penyedia OSHC, tanya HR).
 - Tombol umpan balik per jawaban: "Membantu" / "Kurang tepat" (dengan pilihan alasan).
 
 Constraint:
 - Orkestrator wajib memanggil retrieve_clause (maksimal 5 potongan, lintas bahasa) hanya pada clause_chunks milik user. Pengetahuan umum tidak boleh disajikan seolah isi polis.
 - Policy layer membuang setiap poin tanpa minimal satu kutipan valid (doc, page, dan quote yang benar-benar ada di clause_chunks). Penolakan dicatat di audit sebagai guardrail subtipe uncited_answer.
 - Jika retrieve_clause kosong atau skor relevansi di bawah ambang, jawaban memakai template "Tidak ditemukan di dokumen", bukan "tidak ditanggung".
 - Kutipan ditampilkan verbatim tanpa diterjemahkan; penjelasan Bahasa Indonesia hanya ada di teks poin.
 - Tidak menjanjikan klaim pasti dibayar. Jika user bertanya "pasti dibayar?", jawaban menyebut keputusan ada di penyedia.
 - Output LLM berupa JSON {answer_points[{text, label, citations[]}]} yang divalidasi Zod. Gagal validasi → retry sekali → pesan "Belum bisa menjawab, coba ulangi".
 - Jawaban di-stream; token pertama tampil ≤ 5 detik pada data demo.
 
 Post Condition:
 Jawaban tersimpan di riwayat sesi, dan satu entri audit (event_type answer) mencatat tool yang dipanggil, jumlah kutipan, dan label.

**Acceptance criteria:**

• Given pertanyaan "Periksa gigi ditanggung nggak?" pada polis OSHC demo, then jawaban menyatakan perawatan gigi umum tidak termasuk, dengan kutipan klausul pengecualian dan halamannya.
 • Given jawaban tampil, then setiap poin memiliki minimal satu chip kutipan yang bisa dibuka ke potongan klausul asli.
 • Given respons LLM berisi poin tanpa kutipan, then poin tersebut dibuang dan audit guardrail uncited_answer tercatat.
 • Given pertanyaan tentang manfaat yang tidak ada di polis, then blok "Tidak ditemukan di dokumen" dan langkah verifikasi tampil, tanpa kata "tidak ditanggung".
 • Given klausul berbahasa Inggris, then kutipan tampil dalam bahasa asli dan penjelasan dalam Bahasa Indonesia.
 • Given JSON LLM tidak valid dua kali, then pesan "Belum bisa menjawab" tampil tanpa stack trace.

**Dependencies:** US-06-01, US-03-02 (clause_chunks), W-05, W-07 (policy layer), W-06 (audit logger)

### US-06-03 — Label kepastian dan angka dari rules engine (P0, SC-06)

Setiap poin jawaban diberi label kepastian, dan semua angka (limit, sisa limit, tanggal, persentase tanggungan, excess) diambil dari rules_engine, bukan dihitung LLM. User tahu mana yang pasti dari dokumen dan mana yang perlu dikonfirmasi.
 
 Components:
 - Badge per poin: "Dari dokumen" (hijau), "Estimasi" (kuning), "Perlu konfirmasi" (abu-abu), masing-masing dengan tooltip penjelasan.
 - Angka ditampilkan dalam mata uang asli dokumen (AUD/Rp) dengan ikon info "Dihitung sistem dari data polis kamu".
 - Kartu angka ringkas (jika relevan): Limit, Terpakai, Sisa, Berlaku sampai.
 
 Constraint:
 - Aturan label. Dari dokumen: poin didukung kutipan dan angkanya berasal dari field berstatus Ditemukan. Estimasi: angka hasil perhitungan rules_engine (misalnya perkiraan biaya pribadi) atau berasal dari field Belum terverifikasi. Perlu konfirmasi: klausul ambigu, bergantung pada kondisi yang tidak diketahui (misalnya jaringan provider), atau data Hilang.
 - Label ditentukan policy layer dari sumber angka dan status field. LLM hanya mengusulkan label, dan policy layer boleh menurunkannya.
 - Prompt tidak boleh meminta LLM menghitung. Angka di teks jawaban harus sama persis dengan output rules_engine; jika berbeda, angka diganti nilai rules_engine dan dicatat sebagai guardrail subtipe number_mismatch.
 - Sisa limit = limit_amount − used_amount pada periode berjalan. Jika used_amount tidak diketahui, tampilkan "Sisa: tidak diketahui" dengan label Perlu konfirmasi.
 - Nominal tidak dikonversi kurs.
 
 Post Condition:
 Setiap poin jawaban memiliki tepat satu label kepastian, dan semua angka dapat ditelusuri ke rules_engine.

**Acceptance criteria:**

• Given limit AUD 500 dan terpakai AUD 120 berstatus Ditemukan, then kartu menampilkan Sisa AUD 380 berlabel "Dari dokumen".
 • Given field limit berstatus Belum terverifikasi, then poin terkait berlabel "Estimasi".
 • Given used_amount tidak ada, then tampil "Sisa: tidak diketahui" berlabel "Perlu konfirmasi".
 • Given teks LLM menyebut angka yang berbeda dari rules_engine, then angka diganti nilai rules_engine dan audit guardrail number_mismatch tercatat.
 • Unit test rules_engine untuk sisa limit lulus pada tiga kasus: normal, used kosong, used > limit.
 • Nominal tampil dalam mata uang dokumen tanpa konversi.

**Dependencies:** US-06-02, W-11 (rules engine), W-07

### US-06-04 — Deteksi tanda bahaya di chat (P0, SC-06)

Sebelum pertanyaan diproses LLM, triage_check memeriksa apakah teks berisi tanda bahaya medis (contoh: sesak napas, nyeri dada). Jika ya, chat tidak menjawab apa pun tentang polis dan langsung mengalihkan user ke arahan darurat (SC-08). Ini guardrail keselamatan yang harus terlihat bekerja di demo.
 
 Components:
 - Redirect otomatis ke /emergency dengan parameter asal (from=ask).
 - Pesan singkat di riwayat chat: "Kamu menyebut gejala yang bisa darurat. Aku arahkan ke bantuan darurat dulu."
 - Tombol "Bukan darurat, kembali" di SC-08 (US-08-01) untuk kembali ke chat.
 
 Constraint:
 - triage_check berjalan di server sebelum panggilan LLM, berbasis /kb/{negara}/red_flags.json (US-08-02). Pencocokannya memakai kata kunci dan sinonim Bahasa Indonesia dan Inggris, tidak bergantung pada LLM.
 - Klasifikasi LLM (opsional) hanya boleh menjadi lapisan kedua yang menambah deteksi, tidak boleh membatalkan hasil kata kunci.
 - Jika terpicu, giliran itu tidak menampilkan jawaban polis, perbandingan, atau angka biaya.
 - Negasi ("tidak sesak napas") tetap dianggap pemicu, sesuai prinsip lebih aman.
 - Setiap pemicu dicatat di audit sebagai guardrail subtipe red_flag, berisi id tanda bahaya dan versi red_flags.json, tanpa isi pesan lengkap.
 
 Post Condition:
 User berada di SC-08 dengan nomor darurat sesuai negara, dan peristiwanya tampil di SC-11 sebagai sorotan guardrail.

**Acceptance criteria:**

• Given konteks AU dan user mengetik "aku sesak napas, ditanggung nggak?", then LLM tidak dipanggil dan user diarahkan ke SC-08 dengan nomor 000.
 • Given konteks ID dengan teks yang sama, then SC-08 menampilkan nomor 119.
 • Given teks berbahasa Inggris "chest pain", then pemicu tetap terdeteksi.
 • Given pemicu terdeteksi, then satu entri audit guardrail red_flag tampil di /audit?type=guardrail.
 • Given teks tanpa tanda bahaya ("periksa gigi ditanggung?"), then alur normal US-06-02 berjalan.
 • Test guardrail triase (W-43) lulus untuk minimal 10 frasa uji dari red_flags.json.

**Dependencies:** US-06-01, US-08-02, W-07, W-43 (test guardrail)

### US-07-01 — Ceritakan keluhan non-darurat (P0, SC-07)

User mengisi form singkat tentang kebutuhan berobat non-darurat agar agen bisa membandingkan jalur layanan yang tersedia di negaranya. Form dibuat sesingkat mungkin karena biasanya diisi saat sedang tidak enak badan.
 
 Components:
 - Halaman /pathways dengan judul "Mau berobat ke mana?" dan banner "Darurat? Hubungi <nomor>" (dari emergency.json) yang membuka SC-08.
 - Field "Ceritakan keluhanmu" (teks bebas, maksimal 300 karakter) dengan placeholder "Sakit tenggorokan 3 hari, demam ringan".
 - Chip jenis layanan dari /kb/{negara}/pathways.json. Contoh AU: Dokter umum (GP), Dokter spesialis, Gigi, Kesehatan mental. Contoh ID: Rawat jalan, Dokter spesialis, Rawat inap terencana.
 - Field Kota (terisi otomatis dari profil, bisa diubah).
 - Pilihan "Kapan ingin berobat?": Hari ini, Minggu ini, Belum tahu.
 - Tombol "Bandingkan jalur".
 
 Constraint:
 - Keluhan melewati triage_check sebelum diproses; tanda bahaya → SC-08 (sama dengan US-06-04).
 - Tombol "Bandingkan jalur" disabled sampai keluhan dan jenis layanan terisi.
 - Tidak ada pertanyaan riwayat penyakit, obat yang sedang diminum, atau data medis lain.
 - Keluhan hanya dipakai untuk memilih jalur. Agen tidak mendiagnosis dan tidak mengomentari gejala.
 - Keluhan disimpan tersamar (ringkasan maksimal 80 karakter) di claim_cases.complaint_summary dan audit.
 - Jenis layanan dan teks bantuan diambil dari basis pengetahuan negara, tidak ditulis di kode.
 
 Post Condition:
 Data form dikirim ke /api/pathways/compare dan hasil perbandingan tampil (US-07-02).

**Acceptance criteria:**

• Given konteks AU, then chip jenis layanan memuat GP dan berasal dari /kb/AU/pathways.json.
 • Given keluhan "sesak napas berat", then user diarahkan ke SC-08 tanpa menampilkan perbandingan.
 • Given keluhan atau jenis layanan kosong, then tombol Bandingkan jalur disabled.
 • Given form valid, then hasil perbandingan tampil (US-07-02).
 • Form tidak memiliki field riwayat penyakit atau obat.

**Dependencies:** US-02-01, US-08-02, W-12

### US-07-02 — Kartu perbandingan jalur (P0, SC-07)

Agen menampilkan 2–3 jalur layanan yang relevan dalam bentuk kartu yang mudah dibandingkan: langkah, syarat, perkiraan biaya pribadi, dan dokumen yang perlu disiapkan. Jalur diambil dari basis pengetahuan negara lalu dicocokkan dengan perlindungan aktif user.
 
 Components:
 - 2–3 kartu, berdampingan di desktop dan bertumpuk di mobile. Contoh AU: "Dokter umum (GP)", "Klinik urgent care", "IGD rumah sakit (jika memburuk)". Contoh ID: "BPJS (faskes 1 → rujukan)", "Asuransi kantor", "Polis pribadi".
 - Isi setiap kartu: nama jalur, perlindungan yang dipakai (contoh "OSHC – <penyedia>"), 3–5 langkah bernomor, syarat (rujukan, provider dalam jaringan, bayar dulu lalu klaim atau langsung ditagih ke penyedia), perkiraan biaya pribadi (rentang, label Estimasi), dokumen yang perlu disimpan, serta tautan sumber dan tanggal cek.
 - Badge "Paling sesuai prioritasmu" pada satu kartu, berdasarkan prioritas di profil, beserta alasannya.
 - Tombol "Pilih jalur ini" di setiap kartu (US-07-04).
 
 Constraint:
 - compare_paths membaca jalur dari /kb/{negara}/pathways.json; kode tidak berisi nama jalur.
 - Perkiraan biaya pribadi dihitung rules_engine dari benefits user (limit, excess, claim_mode) dan tarif acuan di pathways.json. LLM hanya merangkai kalimat.
 - Jalur yang tidak didukung polis user hanya boleh diberi keterangan "Tidak ditanggung polis yang kamu unggah" jika ada kutipan klausulnya. Jika tidak jelas, masukkan ke daftar "Belum pasti" (US-07-03).
 - Tidak menampilkan angka waktu tunggu; diganti langkah "Cek jadwal atau booking online".
 - Badge prioritas berbasis aturan prioritas profil, bukan penilaian medis.
 - Setiap perbandingan dicatat di audit dengan event_type compare.
 
 Post Condition:
 User melihat perbandingan jalur dan dapat memilih satu jalur.

**Acceptance criteria:**

• Given konteks AU, OSHC aktif, dan layanan GP, then minimal kartu GP dan urgent care tampil, masing-masing dengan langkah, syarat, perkiraan biaya (AUD, label Estimasi), dan dokumen.
 • Given konteks ID dengan BPJS dan asuransi kantor, then kartu BPJS dan asuransi kantor tampil.
 • Given prioritas "Biaya berobat rendah", then badge "Paling sesuai prioritasmu" ada di kartu dengan perkiraan biaya terendah, beserta alasannya.
 • Tidak ada angka waktu tunggu di kartu mana pun.
 • Mengubah /kb/AU/pathways.json mengubah isi kartu tanpa mengubah kode.
 • Setiap kartu memiliki tautan sumber dan tanggal cek.

**Dependencies:** US-07-01, US-03-03 (benefits), W-11, W-12

### US-07-03 — Daftar hal yang belum pasti (P0, SC-07)

Di bawah kartu jalur, agen menampilkan hal-hal yang belum bisa dipastikan dari dokumen, beserta cara memastikannya. Tujuannya agar user tidak mengira semuanya sudah pasti dan tidak kaget di klinik.
 
 Components:
 - Section "Belum pasti" berisi maksimal 5 item.
 - Setiap item berisi pernyataan singkat (contoh "Apakah klinik ini termasuk provider dalam jaringan OSHC-mu"), dampaknya ("Jika di luar jaringan, kamu mungkin bayar penuh dulu"), dan langkah memastikan (contoh "Tanya resepsionis: bisa direct billing ke <penyedia>?").
 - Tombol "Salin pertanyaan untuk klinik" yang menyalin daftar pertanyaan ke clipboard.
 - Tombol "Buat pengingat cek" yang membuat draf pengingat ke SC-10.
 
 Constraint:
 - Item berasal dari tiga sumber: field Hilang atau Belum terverifikasi yang memengaruhi jalur; syarat jalur yang tidak bisa dicek sistem (jaringan provider, status kepesertaan); dan kapj_status unknown pada konteks ID.
 - Langkah memastikan diambil dari /kb/{negara}/verification_steps.json, tidak dikarang LLM.
 - Pada konteks ID, koordinasi manfaat BPJS dan asuransi kantor (KAPJ) yang tidak tertulis di polis selalu muncul sebagai item "perlu dikonfirmasi".
 - Jika tidak ada hal yang belum pasti, tampilkan "Semua syarat utama sudah terverifikasi dari dokumenmu."
 - "Buat pengingat cek" hanya membuat draf berstatus Menunggu.
 
 Post Condition:
 User tahu apa saja yang harus dicek sebelum berangkat berobat.

**Acceptance criteria:**

• Given status jaringan provider tidak diketahui, then item "provider dalam jaringan" tampil dengan langkah cek dari verification_steps.json.
 • Given konteks ID dan kapj_status unknown, then item koordinasi BPJS–asuransi kantor tampil.
 • Given semua syarat terverifikasi, then pesan "Semua syarat utama sudah terverifikasi" tampil.
 • Given user menekan "Salin pertanyaan untuk klinik", then daftar pertanyaan tersalin ke clipboard.
 • Maksimal 5 item tampil.

**Dependencies:** US-07-02, US-04-02, US-10-01, W-12

### US-07-04 — Pilih jalur dan buat kasus klaim (P0, SC-07)

Setelah user memilih jalur, sistem membuat kasus klaim yang menyimpan jalur, perlindungan yang dipakai, dan ringkasan keluhan, lalu membuka Kesiapan Klaim. User tidak perlu mengulang input saat menyiapkan klaim.
 
 Components:
 - Tombol "Pilih jalur ini" di setiap kartu.
 - Dialog konfirmasi berisi ringkasan jalur, perlindungan yang dipakai, dan dokumen yang perlu disimpan, dengan tombol "Buat kasus klaim" dan "Batal".
 - Untuk jalur yang langsung ditagih ke penyedia (direct billing/cashless), dialog menambahkan catatan "Kamu mungkin tidak perlu klaim sendiri, tapi tetap simpan dokumen ini."
 - Toast "Kasus klaim dibuat" lalu redirect ke /claims/[id].
 
 Constraint:
 - Satu konfirmasi membuat satu kasus; tombol disabled selama proses untuk mencegah kasus ganda.
 - Kasus menyimpan country_code, path (id dari pathways.json), coverage_id, complaint_summary (tersamar), dan status Draft.
 - Kartu IGD tidak membuat kasus dari screen ini; tombolnya membuka SC-08.
 - Pembuatan kasus dicatat di audit (event_type action, subtipe claim_case_created).
 
 Post Condition:
 Kasus klaim berstatus Draft tercipta dan SC-09 terbuka dengan checklist jalur tersebut (US-09-01).

**Acceptance criteria:**

• Given user memilih kartu GP dan mengonfirmasi, then satu claim_case berstatus Draft tercipta dan /claims/[id] terbuka.
 • Given tombol ditekan dua kali dengan cepat, then hanya satu kasus tercipta.
 • Given user menekan Batal, then tidak ada kasus tercipta.
 • Given kartu IGD, then tombol membuka SC-08, bukan membuat kasus.
 • Entri audit claim_case_created tercatat.

**Dependencies:** US-07-02, W-03 (tabel claim_cases), W-06

### US-14-01 — Daftar kebutuhan perlindungan sesuai konteks (P0, SC-14)

User melihat daftar perlindungan yang wajib dan disarankan untuk situasinya (negara, status pelajar/pekerja, tanggungan), sehingga pertanyaan "aku butuh asuransi apa di sini?" terjawab di satu halaman.
 
 Components:
 - Halaman /coverage-needs dengan judul "Perlindungan yang kamu butuhkan di <negara>" dan badge konteks (contoh "Australia · Pelajar").
 - Dua grup: "Wajib" (contoh: OSHC untuk pemegang visa pelajar di Australia) dan "Disarankan" (contoh AU: extras gigi dan optik, asuransi perjalanan saat keluar Australia; contoh ID: BPJS Kesehatan, asuransi jiwa jika punya tanggungan).
 - Kartu kebutuhan: nama (istilah lokal dan penjelasannya), satu kalimat alasan, label Wajib/Disarankan, tautan sumber aturan dengan tanggal cek, dan status kepemilikan (US-14-02).
 - Ringkasan di atas halaman, contoh "2 dari 4 sudah punya".
 - Tombol "Ubah situasi saya" yang membuka edit profil (SC-02).
 
 Constraint:
 - Daftar kebutuhan berasal dari aturan di /kb/{negara}/coverage_needs.json berdasarkan status, tanggungan, dan visa. LLM tidak boleh menambah kebutuhan.
 - Label "Wajib" hanya boleh dipakai untuk kebutuhan yang memiliki source_url regulasi resmi.
 - Tidak merekomendasikan produk atau penyedia tertentu di P0; perbandingan produk ada di SC-17 (P1).
 - Teks dalam Bahasa Indonesia, dengan istilah lokal ditulis asli.
 - Negara selain AU dan ID ditandai "Segera hadir".
 
 Post Condition:
 User melihat semua kebutuhan sesuai konteksnya beserta status kepemilikan masing-masing.

**Acceptance criteria:**

• Given konteks AU dan status Pelajar, then OSHC tampil di grup Wajib dengan tautan sumber dan tanggal cek.
 • Given konteks AU dan status Pekerja, then daftar Wajib mengikuti aturan pekerja di coverage_needs.json, bukan aturan pelajar.
 • Given konteks ID, then daftar kebutuhan berasal dari /kb/ID/coverage_needs.json.
 • Mengubah coverage_needs.json mengubah daftar tanpa mengubah kode.
 • Tidak ada nama produk atau penyedia yang direkomendasikan.
 • Given user mengubah status di SC-02, then daftar kebutuhan diperbarui.

**Dependencies:** US-02-01, W-12, W-56 (konteks negara)

### US-14-02 — Status kepemilikan dan alasan tiap kebutuhan (P0, SC-14)

Setiap kebutuhan dicocokkan dengan perlindungan yang sudah dimiliki user, lalu diberi status Sudah punya · Belum punya · Perlu dicek beserta alasannya. Untuk kewajiban visa, hasil cek jeda antara masa cover dan masa visa ikut ditampilkan.
 
 Components:
 - Badge status di setiap kartu kebutuhan: Sudah punya (hijau), Belum punya (merah untuk Wajib, kuning untuk Disarankan), Perlu dicek (abu-abu).
 - Alasan satu kalimat, contoh "Ditemukan: Sertifikat OSHC <penyedia>, berlaku 01-02-2026 s.d. 31-03-2027" atau "Kategori gigi tidak ditemukan di polis yang kamu unggah".
 - Untuk OSHC: ringkasan hasil aturan visa dari SC-04 (contoh "Ada jeda 76 hari") dan tautan ke SC-04?task=visa_cover.
 - Tombol aksi per status. Belum punya → "Pelajari pilihan" (SC-17 jika tersedia, atau langkah dari verification_steps). Perlu dicek → "Cek sekarang" (SC-04/SC-03). Sudah punya → "Lihat polis" (SC-13).
 
 Constraint:
 - Pencocokan dilakukan rules_engine (kebutuhan ↔ coverages.type dan benefits.category), tanpa LLM.
 - Status Sudah punya hanya diberikan jika coverage aktif dan data kuncinya berstatus Ditemukan. Jika data kunci Belum terverifikasi atau Hilang, statusnya Perlu dicek.
 - Teks wajib membedakan "tidak ditemukan di dokumen" dan "dikecualikan di polis". "Dikecualikan" hanya dipakai jika ada kutipan klausul pengecualian.
 - Jeda visa memakai hasil rules_engine yang sama dengan SC-04, tidak dihitung ulang dengan cara lain.
 - Setiap hasil pencocokan dicatat di audit dengan event_type compare.
 
 Post Condition:
 User tahu kebutuhan mana yang sudah terpenuhi dan langkah berikutnya untuk yang belum.

**Acceptance criteria:**

• Given OSHC aktif dengan tanggal berstatus Ditemukan, then status OSHC "Sudah punya" dengan alasan berisi penyedia dan masa berlaku.
 • Given OSHC berakhir 31-03-2027 dan visa berakhir 15-06-2027, then kartu OSHC menampilkan "Ada jeda 76 hari" dengan tautan ke SC-04.
 • Given polis tidak memuat kategori gigi, then kebutuhan cover gigi berstatus "Belum punya" dengan alasan "tidak ditemukan di dokumen yang kamu unggah".
 • Given tanggal berakhir OSHC Belum terverifikasi, then statusnya "Perlu dicek".
 • Given data yang sama, then hasil jeda visa di SC-14 identik dengan SC-04.

**Dependencies:** US-14-01, US-04-02, US-03-03, W-11

### US-16-01 — Input perjalanan (P1, SC-16)

User memasukkan rencana perjalanan atau kepindahan (liburan, studi, atau kerja) agar agen bisa mengecek perlindungan yang sudah dimiliki dan kebutuhan di negara tujuan. Contoh skenario: mahasiswa di Australia yang akan liburan ke Eropa, atau karyawan di Indonesia yang akan pindah kerja ke negara lain.
 
 Components:
 - Form /travel dengan chip tujuan: Liburan/perjalanan singkat, Studi, Kerja.
 - Negara tujuan (multi-pilih untuk liburan, satu negara untuk studi/kerja), tanggal berangkat, dan tanggal kembali (opsional untuk studi/kerja).
 - "Berangkat dari", default negara konteks di profil.
 - Aktivitas khusus (opsional, chip): Olahraga berisiko (ski, diving), Menyetir kendaraan, Tidak ada.
 - Tombol "Cek perlindungan saya".
 - Daftar rencana tersimpan (maksimal 5) dengan tombol Edit dan Hapus.
 
 Constraint:
 - Tanggal kembali harus setelah tanggal berangkat; validasi tampil inline.
 - Tidak meminta nomor paspor, nomor visa, maupun data tiket.
 - Rencana disimpan per user (perlu tabel trips baru di Skema Data).
 - Untuk tujuan studi atau kerja ke negara yang belum punya basis pengetahuan, form tetap menerima input dan hasilnya memakai panduan umum (US-16-03).
 
 Post Condition:
 Rencana tersimpan, lalu hasil cek polis (US-16-02) dan kebutuhan di negara tujuan (US-16-03) tampil.

**Acceptance criteria:**

• Given tanggal kembali sebelum tanggal berangkat, then pesan validasi tampil dan tombol disabled.
 • Given tujuan Liburan, then form menerima lebih dari satu negara tujuan.
 • Form tidak memiliki field paspor, visa, atau tiket.
 • Given rencana disimpan, then rencana muncul di daftar dan bisa diedit atau dihapus.

**Dependencies:** US-02-01, W-03, W-12

### US-16-02 — Cek perlindungan yang ada (P1, SC-16)

Sistem mengecek apakah polis yang sudah dimiliki berlaku untuk wilayah dan tanggal perjalanan, lalu menandai celahnya.
 
 Components:
 - Tabel per polis: nama polis, "Berlaku di wilayah tujuan?" (Ya / Tidak / Perlu konfirmasi), "Menutup seluruh tanggal?" (Ya / Ada jeda <n> hari), dan kutipan klausul wilayah atau pengecualian.
 - Ringkasan di atas tabel, contoh "Perjalananmu belum sepenuhnya terlindungi: 2 celah".
 - Tombol "Lihat kebutuhan di negara tujuan" (US-16-03) dan "Bandingkan asuransi perjalanan" (SC-17).
 - Tombol "Buat pengingat sebelum berangkat" yang membuat draf ke SC-10.
 
 Constraint:
 - Cek tanggal dilakukan rules_engine (masa berlaku coverage vs tanggal perjalanan).
 - Cek wilayah memakai field wilayah hasil ekstraksi dan kutipan klausul. Status "Tidak" hanya boleh diberikan jika ada kutipan; tanpa kutipan, statusnya Perlu konfirmasi.
 - Aktivitas khusus dicocokkan ke klausul pengecualian bila ada, dengan label kepastian seperti di US-06-03.
 - Pengingat hanya dibuat sebagai draf berstatus Menunggu.
 
 Post Condition:
 User tahu polis mana yang berlaku untuk perjalanannya dan di mana celahnya.

**Acceptance criteria:**

• Given OSHC demo dengan klausul wilayah yang hanya berlaku di Australia dan rencana liburan ke Prancis, then baris OSHC berstatus "Tidak" dengan kutipan klausulnya.
 • Given polis perjalanan berakhir 3 hari sebelum tanggal kembali, then tampil "Ada jeda 3 hari".
 • Given klausul wilayah tidak ditemukan, then status "Perlu konfirmasi" dengan langkah verifikasi.
 • Given ada celah, then tombol ke US-16-03 dan SC-17 tampil.

**Dependencies:** US-16-01, US-03-02, W-11

### US-16-03 — Kebutuhan perlindungan di negara tujuan (studi/kerja/travel) (P1, SC-16)

Untuk rencana studi, kerja, atau perjalanan dengan syarat visa, agen menampilkan perlindungan yang wajib dan disarankan di negara tujuan. Fitur ini memakai mesin yang sama dengan Cek Kebutuhan Perlindungan (SC-14), hanya untuk negara tujuan. Ia menjawab pertanyaan seperti "aku mau kerja di <negara>, asuransi apa yang aku butuhkan?" tanpa merekomendasikan produk tertentu.
 
 Components:
 - Section "Yang kamu butuhkan di <negara tujuan>": grup Wajib dan Disarankan, masing-masing dengan alasan, sumber, dan tanggal cek.
 - Status kepemilikan terhadap polis yang dimiliki: Sudah punya / Belum punya / Perlu dicek.
 - Untuk negara yang belum punya basis pengetahuan: label "Panduan umum – belum spesifik negara" dengan checklist generik (kesehatan, perjalanan dan evakuasi medis, cek syarat asuransi di situs resmi imigrasi negara tujuan).
 - Tombol "Bandingkan produk" (SC-17) dan "Tanya agen" (SC-06 dengan konteks rencana).
 
 Constraint:
 - Kebutuhan diambil dari /kb/{negara_tujuan}/coverage_needs.json dengan logika yang sama seperti US-14-01 dan US-14-02 (dipakai ulang, bukan dibangun lagi).
 - Syarat visa hanya ditampilkan sebagai "Wajib" jika ada source_url resmi. Jika tidak ada, tampilkan "Cek ke situs resmi imigrasi negara tujuan".
 - Panduan umum tidak boleh menyebut angka minimum pertanggungan tanpa sumber.
 - Tidak merekomendasikan penyedia atau produk tertentu.
 - Di MVP, hanya AU dan ID yang spesifik; negara lain memakai panduan umum.
 
 Post Condition:
 User tahu perlindungan yang dibutuhkan di negara tujuan dan langkah berikutnya.

**Acceptance criteria:**

• Given rencana Studi ke Australia, then OSHC tampil sebagai Wajib dengan sumber resmi dan status kepemilikan.
 • Given rencana Kerja ke negara tanpa basis pengetahuan, then label "Panduan umum – belum spesifik negara" tampil tanpa angka nominal.
 • Status kepemilikan memakai fungsi yang sama dengan US-14-02 (dibuktikan unit test bersama).
 • Tidak ada nama produk atau penyedia yang direkomendasikan.

**Dependencies:** US-16-01, US-14-01, US-14-02, W-12

---

## APPENDIX B — EXACT VALEN SCREEN OWNERSHIP FROM PRD

- **SC-05 · Command Center · `/home` · P0**. Includes: Badge konteks; kartu ringkasan angka; maksimal 3 rekomendasi (termasuk kewajiban visa); pintasan; nomor darurat sesuai negara. Excludes: Chat (SC-06); perbandingan jalur (SC-07); kebutuhan perlindungan (SC-14); detail polis (SC-13).
- **SC-06 · Tanya Polis · `/ask` · P0**. Includes: Chat; jawaban dengan kutipan klausul dan halaman; label kepastian; deteksi tanda bahaya. Excludes: Membandingkan jalur layanan (SC-07); tampilan arahan darurat (SC-08).
- **SC-07 · Bandingkan Jalur Layanan · `/pathways` · P0**. Includes: Form keluhan non-darurat; kartu jalur dari basis pengetahuan negara (AU: GP vs urgent care vs IGD; ID: BPJS vs kantor vs pribadi); hal yang belum pasti; pilih jalur. Excludes: Checklist dan bukti klaim (SC-09); kebutuhan perlindungan (SC-14).
- **SC-14 · Cek Kebutuhan Perlindungan · `/coverage-needs` · P0**. Includes: Daftar kebutuhan dari basis pengetahuan negara (wajib visa, disarankan); status Sudah punya / Belum punya / Perlu dicek; alasan dan sumber aturan. Excludes: Kelengkapan data satu polis (SC-04); detail polis (SC-13); pembelian produk (di luar scope).
- **SC-16 · Perencana Perjalanan · `/travel` · P1**. Includes: Input perjalanan; cek wilayah dan tanggal berlaku polis yang ada. Excludes: Perbandingan produk (SC-17).

## APPENDIX C — VALEN API CONTRACT ROWS (PRD wording)

- **GET `/api/home/summary`** (SC-05). Request: `-`. Response: `{active, expiring_30d, needs_verification, recommendations[≤3]}`.
- **POST `/api/ask`** (SC-06). Request: `{question}`. Response: `stream: {answer_points[{text, label, citations[{doc, page, quote}]}]} atau {redirect: "emergency"}`.
- **POST `/api/pathways/compare`** (SC-07). Request: `{complaint, service_type, city}`. Response: `{paths[{name, steps, requirements, est_out_of_pocket, docs, uncertainties, sources}]} atau {redirect: "emergency"}`.
- **POST `/api/claims`** (SC-07). Request: `{path, coverage_id}`. Response: `{claim_case_id}`.
- **Tool `retrieve_clause · rules_engine · compare_paths · gap_matrix (P1)`** (SC-05, SC-06, SC-07, SC-14). Request: `pertanyaan / record / skenario`. Response: `JSON tervalidasi Zod`.

**Note:** These source rows cover only Valen owned operations. Cross-owned triage, action approval and claim case detail have to be integrated using their actual existing contracts.
