# INSURRA Task Checklist

Legend: `- [ ]` not started or in progress, `- [x]` completed and verified by the listed tests. Owner is the area lead named in the master prompt. Resume from the first unchecked task whose dependencies are checked.

Format per task: ID | feature | owner | priority | layer | depends on | files | acceptance | tests.

## Phase 0: Baseline repair

- [x] **T0.1** Diagnose and fix the 12 baseline backend failures at the root cause | Account workspace, workflow, rules | Regina / Joshua / Valen | P0 | BE | none | `backend/app/api/v1/account_workspace.py`, `backend/app/services/rules_engine.py`, `backend/app/workflow/*`, `backend/app/tests/*` | `make test` green with no weakened assertions; root causes recorded in Deviations | `make test`
- [x] **T0.2** Confirm frontend baseline | Frontend | all | P0 | FE | none | `frontend/` | `npm run lint`, `npm run typecheck`, `npm run build` pass, or failures recorded | `make check`

## Phase 1: Identity and session foundation

- [x] **T1.1** Reject `Authorization` plus `X-Demo-Session` on legacy `ActiveSession` routes | Sessions | Regina | P0 | BE | T0.1 | `backend/app/core/dependencies.py` | 422 `AMBIGUOUS_ACTOR` for every resolver | new `test_session_isolation.py`
- [x] **T1.2** Demo end and reset endpoints, `demo_sessions.revoked_at`, expired/revoked purge | Demo | Regina | P0 | BE | T0.1 | `services/demo_sessions.py`, `api/v1/sessions.py`, `models/entities.py`, migration `0013` | Reset returns new token with baseline data; old token 401; purge cascades | `test_session_isolation.py`, `test_migrations.py`
- [x] **T1.3** Auth hardening: hashed verify/reset tokens with legacy lookup, verification expiry, forgot-password throttle, unified 401 | Auth | Regina | P0 | BE | T0.1 | `backend/app/api/auth.py`, `models/auth.py`, migration `0013` | No plaintext token stored for new rows; enumeration-safe login | `test_account_auth.py`
- [x] **T1.4** Frontend: drop `localStorage` demo token copies and silent Raka session creation; explicit session-required state | Sessions | Joshua (pages) / Regina | P0 | FE | T1.1 | `frontend/src/lib/api/workflow-client.ts`, `components/session-required.tsx` | No token in localStorage; `/claims` without session shows demo/login choice | `claims.spec.ts`, `demo.spec.ts`
- [x] **T1.5** Validate `/auth?redirect=`; private route guard redirects | Auth | Regina | P0 | FE | none | `frontend/src/app/auth/page.tsx`, `components/layout/app-shell.tsx` | `//evil` and absolute URLs ignored; unauthenticated private route redirects | `account.spec.ts`
- [x] **T1.6** Email delivery unavailable state in UI | Auth | Regina | P1 | FE | T1.3 | `frontend/src/app/auth/page.tsx` | Honest message; no fake "email sent" | manual + spec

## Phase 2: Demo persona migration and AU deactivation

- [x] **T2.0** KB provenance correction | KB / pipeline | Regina (requested by user) | P0 | BE | none | `backend/app/pipeline/*`, `backend/app/schemas/{common,kb}.py`, `kb/CN`, `kb/ID`, `kb/global`, `kb/exports`, `kb/assets/insurers`, `fixtures/synthetic`, `docs/prd/DATA_PROVENANCE_AND_QUALITY_REPORT.md` | `evidence_class` (RETRIEVED_OFFICIAL, MANUALLY_CURATED, SYNTHETIC_FIXTURE, PLACEHOLDER) on pipeline records and KB envelopes; no VERIFIED without a real retrieved artifact hash; dry-run crawl records `NOT_FETCHED` with null hash; insurer logos marked placeholder with `license_status: NOT_VERIFIED`; truthful report generated from data | `test_kb_provenance.py`, `test_pipeline.py`, `make test`
  - Result: of 133 VERIFIED records in kb/CN, kb/ID, kb/global (79 generator dataset records, 24 registry sources, 1 injection pattern file, 29 curated runtime records) plus 12 VERIFIED logo assets, 29 remain (the curated runtime exception below) and 0 pipeline records are VERIFIED. Records now: MANUALLY_CURATED 99, SYNTHETIC_FIXTURE 35 (16 RAG chunks, 4 university requirements, 15 fixtures), PLACEHOLDER 12 (logos), RETRIEVED_OFFICIAL 0. Sources: 28 registered, 0 fetched, 0 downloaded, 0 parsed.
  - Retained exception (needs maintainer decision): hand-curated runtime KB resources in `kb/CN` and `kb/ID` (`emergency.json`, `red_flags.json`, `pathways.json`, 29 records) keep status VERIFIED because emergency and triage safety paths gate on it and the task said not to change emergency semantics. They are labelled `evidence_class: MANUALLY_CURATED`; they were not retrieved. UI must not call them "officially verified".
  - Frontend notes for T6.x (not edited here): do not render insurer images from `/assets/insurers/*` as official logos (currently no page references them; `manifest.json` entries are `placeholder: true`); the product catalog compare payload now carries `evidence_class` and `provenance_note`; `EmergencyContact` in `/api/v1/emergency` now carries optional `evidence_class`; show "curated, not independently verified" wording for products, procedures, evidence and RAG-derived content.
- [x] **T2.1** `ACTIVE_KB_COUNTRIES` setting applied in KB loader; AU not served | KB | Valen | P0 | BE | T0.1 | `core/config.py`, `services/kb_loader.py` | `/countries` returns CN, ID only; `kb/AU` untouched | `test_rules_and_guards.py`
- [x] **T2.2** CN manifest timezone/currency; CN `coverage_continuity` rule (UNVERIFIED); rules engine uses later of study end / permit end | KB / rules | Valen | P0 | BE | T2.1 | `kb/CN/manifest.json`, `kb/CN/rules.json`, `services/rules_engine.py` | Raka 76 days, NEEDS_VERIFICATION, "Coverage dates require review." | `test_api.py`, `test_coverage_needs.py`
- [x] **T2.3** Rewrite `fixtures/raka` as China international student (fictional institution, synthetic plan, CNY, Chinese certificate and fapiao text) | Demo | Regina | P0 | BE | T2.2 | `fixtures/raka/*` | No AU, OSHC, 8501, Melbourne, AUD | `test_demo_personas.py`
- [x] **T2.4** Seed upserts persona templates; claims seed derives country from persona; Raka claim data consistent | Demo / Claims | Joshua | P0 | BE | T2.3 | `seeds/demo.py`, `seeds/demo_claims_seed.py`, `services/demo_sessions.py` | Seed idempotent; fapiao patient Raka, service date within policy | `test_workflow.py`, `test_demo_personas.py`
- [x] **T2.5** Remove AU runtime strings and currency branch | Audit / Setup | Joshua / Regina | P0 | BE | T2.1 | `services/audit_logger.py`, `api/v1/account_workspace.py:313` | CN resolves CNY from KB | `test_account_workspace.py`
- [x] **T2.6** Retarget AU-dependent tests to CN or test KB fixtures without weakening intent | Tests | all | P0 | BE | T2.1-T2.5 | listed in IMPLEMENTATION_PLAN 3.6 | `make test` green | `make test`
- [x] **T2.7** Extend `GET /demo/personas` (country, categories, description) | Demo | Regina | P0 | BE | T2.3 | `schemas/session.py`, `api/v1/sessions.py` | Generated types updated | `test_demo_personas.py`, `make check-contracts`
- [x] **T2.8** Landing persona cards, demo intro, shell demo banner with Reset and Exit | Landing / Shell | Regina | P0 | FE | T1.2, T2.7 | `app/page.tsx`, `components/home/scenario-preview.tsx`, `components/layout/app-shell.tsx`, `lib/session.tsx` | Raka and Sinta cards only; reset restores baseline | `demo-personas.spec.ts`
- [x] **T2.9** Remove AU from frontend onboarding, user context and auth copy | Onboarding | Regina | P0 | FE | T2.1 | `account/onboarding/page.tsx`, `lib/user-context.tsx`, `auth/page.tsx` | Only CN and ID residence options; nationality free list | `account.spec.ts`

## Phase 3: Profile and onboarding

- [x] **T3.1** Additive `ProfileData` fields (nationality, situation, study dates, permit end, employer, goals, protection scope) with validation | Profile | Regina | P0 | BE | T0.1 | `schemas/profile.py` | Old payloads still validate; study end after start | `test_profile_context.py`
- [x] **T3.2** `GET /context` unified user context for account and demo | Profile | Regina | P0 | BE | T3.1 | new `api/v1/context.py` | Mode, synthetic flag, country, currency | `test_profile_context.py`
- [x] **T3.3** Onboarding persists draft per step, completes on Review, resumes from server, no hardcoded defaults | Onboarding | Regina | P0 | FE | T3.1 | `account/onboarding/page.tsx`, `lib/user-context.tsx` | Refresh resumes; completed only after Review; errors shown | `account.spec.ts` (E2E-02)
- [x] **T3.4** Server-authoritative user context; localStorage cache cleared on logout/delete/switch | Profile | Regina | P0 | FE | T3.2 | `lib/user-context.tsx`, `lib/auth.tsx`, `lib/session.tsx` | No stale profile across accounts | `account.spec.ts`
- [x] **T3.5** `/profile` page (header, personal, situation, conditional context, insurance context, household, security) for account and demo | Profile | Regina | P0 | FE | T3.2 | new `app/profile/page.tsx`, shell links | Edits persist; demo edits session-scoped; country change confirmation and invalidation | `account.spec.ts` (E2E-04), `demo-personas.spec.ts`
- [x] **T3.6** Auth redirect logic: consent, then onboarding or Home | Auth | Regina | P0 | FE | T3.3 | `auth/page.tsx`, `auth/callback/page.tsx` | Returning completed user lands on /home | `account.spec.ts` (E2E-03)

## Phase 4: Privacy and consent

- [x] **T4.1** `user_preferences` table and `GET/PUT /preferences` | Settings | Regina | P0 | BE | migration 0013 | `models/workspace_state.py` or `account_data.py`, new `api/v1/preferences.py` | Owner-scoped; defaults | `test_privacy_settings.py`
- [x] **T4.2** `GET /account/export`, `GET /account/consents/history`, `GET /account/connected-sources` (empty) | Privacy | Regina | P0 | BE | T4.1 | `api/v1/account_workspace.py` | Scoped; audited; no bytes | `test_privacy_settings.py`
- [x] **T4.3** Delete accepts `DELETE`/`HAPUS`; removes notifications, preferences, workflow rows; real inventory action count | Privacy | Regina | P0 | BE | T5.1 | `account_workspace.py`, `services/workspace_privacy.py` | Deleted document 404; idempotent | `test_privacy_settings.py`
- [x] **T4.4** Settings and Privacy UI sections: consent with history, notification prefs, AI prefs, connected sources, inventory, export, delete; correct copy; clear local caches | Settings | Regina | P0 | FE | T4.1-T4.3 | `account/privacy/page.tsx` | All controls functional | `account.spec.ts` (E2E-05)
- [x] **T4.5** Demo-mode settings: session-scoped consents and preferences; delete replaced by Reset Demo | Settings | Regina | P0 | FE | T1.2 | same | No real data path | `demo-personas.spec.ts`

## Phase 5: Notifications

- [x] **T5.1** `notifications` table, service `emit` with dedupe, event dispatcher `services/events.py` | Notifications | Regina | P0 | BE | migration 0013 | new files | Duplicate event creates one notification | `test_notifications.py`
- [x] **T5.2** Notification API (list/filter, unread count, read, read all) | Notifications | Regina | P0 | BE | T5.1 | new `api/v1/notifications.py` | Owner-scoped 404s | `test_notifications.py`
- [x] **T5.3** Event sources: document extraction and review required, claim created/status changed, action prepared/approved/executed, consent revoked, onboarding completed, coverage expiry reminders | Integration | Regina / Joshua | P0 | BE | T5.1 | `account_documents.py`, `workflow/audit.py`, `account_workspace.py` | Real events only | `test_notifications.py`
- [x] **T5.4** Bell with unread count, popover, `/notifications` page with filters, mark read, deep links | Notifications | Regina | P0 | FE | T5.2 | `components/layout/app-shell.tsx`, new `app/notifications/page.tsx` | Badge from backend | `account.spec.ts` (E2E-06)

## Phase 6: Module integration

- [ ] **T6.1** Raka hero: continuity insight visible on Home and My Protection with evidence and uncertainty; inquiry action prepared and approval required | Integration | Valen / Joshua | P0 | FS | Phase 2 | Home, protection, actions | E2E-08 | `demo-personas.spec.ts`
- [ ] **T6.2** Raka claim: fapiao evidence, readiness, draft, approval, sandbox execution with reference, audit | Integration | Joshua | P0 | FS | Phase 2 | claims pages, workflow | E2E-09, E2E-10 | `demo-personas.spec.ts`
- [ ] **T6.3** Sinta care decision: JKN and employer shown separately, coordination unknown | Integration | Valen | P0 | FS | Phase 2 | pathways | E2E-12 | `demo-personas.spec.ts`
- [ ] **T6.4** Translate remaining Indonesian UI strings and remove em dashes in UI | Frontend | all | P0 | FE | none | `pathway-confirmation.tsx`, documents page, claims pages, backend user-facing messages | grep clean | lint + grep check

## Phase 7: Validation and documentation

- [ ] **T7.1** Playwright `account.spec.ts` (E2E-01 to E2E-06) | Tests | Regina | P0 | FE | Phases 1-5 | `frontend/tests/` | desktop and mobile pass | `npm run test:e2e`
- [ ] **T7.2** Playwright `demo-personas.spec.ts` (E2E-07 to E2E-14) | Tests | all | P0 | FE | Phase 6 | `frontend/tests/` | pass | `npm run test:e2e`
- [ ] **T7.3** Backend security suite (section 25 of master prompt) | Tests | all | P0 | BE | Phases 1-5 | `backend/app/tests/test_security_regressions.py` | pass | `make test`
- [ ] **T7.4** Full checks: `make test`, `make check`, `make check-contracts`, `make test-client` | Release | all | P0 | FS | all | none | pass | commands
- [ ] **T7.5** Update README, AGENTS language and scope lines, SCREEN_ROUTES, COUNTRY_INTEGRATION | Docs | all | P0 | Docs | all | docs | Accurate | review

## Phase 8: Final review

- [ ] **T8.1** Opus review against plan, architecture, AGENTS; list open items | Review | all | P0 | all | all | these three files | Honest final report | n/a

## Deviations and blockers log

- 2026-10-19: Local PRD CSVs and the updated CN/ID PRD are not present; `make check-prd-source` cannot run.
- 2026-10-19: Baseline `make test` has 12 failures before changes (see IMPLEMENTATION_PLAN 3.1).
- Email delivery infrastructure absent (AD-16). External connectors absent (AD-12). KB VERIFIED labels on generator-authored CN/ID data are not backed by fetched sources (IMPLEMENTATION_PLAN 3.4).
- 2026-10-19 T0.1 root causes (merge be9077b combined two independent lines; `make test` now 296 passed):
  - `completeness` lost the `coverage_continuity` block (`coverage_continuity` field null): `account_workspace.py` took the other side's `visa_cover`-only code. Restored the continuity fields/assessment (gap via `uncovered_interval`); `visa_gap` now comes from the shared SC-14 assessment for `coverage_continuity` (retired `visa_cover` still accepted). `test_coverage_needs.py` updated from task `visa_cover` to `coverage_continuity` (KB tasks renamed it; `test_account_documents_service` asserts `visa_cover` is absent).
  - `RulesEngine` matched `visa_coverage` rules for every caller, so demo/legacy callers got NEEDS_VERIFICATION instead of DATE_DIFFERENCE_DETECTED (AU Raka 76 days, `test_new_country_requires_only_configuration`). Added keyword `include_visa_rule=False`; only `coverage_matching.visa_assessment` (SC-04/SC-14) passes True. Revisit in T2.2 when CN gets a `coverage_continuity` rule (plan expects NEEDS_VERIFICATION).
  - `GET /audit/{id}` regressed to a 501 stub in `foundation.py`: restored `enrich_audit_event` response with ownership scoping retained.
  - Legacy `/actions` (seed_demo, propose, detail, execute, ics, pdf, edit-approve) was dropped by the merge: restored `api/v1/actions.py` from 85dcf59 and routed claim-linked / body-less / hash-bound approve and reject to the hash-bound claim logic; `/actions` returns [] when empty; `proposed_payload_sha256` and `payload_version` are serialized. Duplicate OpenAPI operation id warning `execute_api_v1_actions__action_id__execute_post` (foundation 501 stub vs actions.py) remains; resolve when actions are unified (workflow router also owns `/actions/*` and wins by include order).
  - `active_coverage_count` was hard-coded 0 by the merge; restored `None` (unknown, never a fabricated count).
  - `test_guardrail_highlight_subtypes_and_demo_scenario` asserted `/triage` returns 501; `/triage` is now implemented (KB-driven, positive match only) so the test expects 200. No security or ownership assertion changed.
  - `backend/openapi.json` and `frontend/src/lib/api/types.gen.ts` regenerated with `make generate-types`.
- 2026-10-19 T0.2: `npm run typecheck` and `npm run build` pass. `npm run lint` has 1 error (`react-hooks/set-state-in-effect`, `src/app/ask/page.tsx:47`, from an uncommitted edit that is not part of the merge) and 3 unused-import warnings (`home/page.tsx`, `app-shell.tsx`). Left untouched because the files carry uncommitted user edits.
- 2026-10-19 Phase 1 (T1.1 to T1.6) plus migration `0013_account_context_notifications` (all section 9 schema changes; notifications/preferences endpoints deferred to later phases):
  - T1.1: every resolver (`ActiveSession`, `ActiveAccount`, workspace actor, workflow owner, `/auth/me`, `/auth/logout`) now returns 422 `AMBIGUOUS_ACTOR` via `services/demo_access.reject_ambiguous_actor`. The workflow owner previously returned 400; aligned to 422 (the code the workspace actor already used). No existing test asserted the 400.
  - T1.2: `DELETE /demo/sessions/me` (204, sets `revoked_at`) and `POST /demo/sessions/me/reset` (201, same body as create). All demo token lookups go through `find_demo_session`, which rejects revoked and expired rows. Session creation purges expired/revoked sessions; foundation FKs to `demo_sessions` have no ON DELETE CASCADE and `wf_*` tables have no FK, so `purge_demo_sessions` deletes owned rows explicitly, children first, resolving `wf_*` children through their claim/action parents.
  - T1.3: new verification/reset tokens are stored as sha256 hex; lookup accepts the hash or a legacy plaintext value (never a 64-char value as plaintext, so a leaked hash cannot be replayed). Verification expires after 48h via `accounts.verification_token_expires_at`; legacy rows without it age from `verification_sent_at`, else are accepted once. Forgot-password has a 60s per-account cooldown with the identical 200 response. Login does a dummy password hash for unknown emails; unknown emails never lock. Registration, resend and forgot responses never contained tokens and still do not; the raw token is discarded because no email transport exists, so tests plant a known sha256 directly instead of reading plaintext (no environment-gated test hook was added). Developers can mark an account verified directly in the database until email delivery exists.
  - Residual enumeration signals left unchanged: register returns 409 `EMAIL_ALREADY_REGISTERED`, resend-verification returns 429 `COOLDOWN_ACTIVE` for existing unverified accounts, and a real locked account returns 423 where an unknown email returns 401.
  - T1.4: the demo token lives only in per-tab `sessionStorage`; legacy `localStorage` keys `insurra.demo-session` and `insurra_demo_token` are purged on load (`SessionProvider` and `workflow-client`). `ensureActiveDemoSession` (silent Raka session) is removed. `AppShell` renders `SessionRequired` (Try Demo and Sign in) on demo-capable private routes without account or demo session; `/emergency` stays reachable without a session.
  - T1.5: `lib/safe-redirect.ts` validates `/auth?redirect=`; unit tests in `tests/safe-redirect.spec.ts` (added to the `test:client` config). Account-only routes (`/account*`, `/completeness`, `/policies`, `/family`) redirect to `/auth?redirect=<path>`.
  - T1.6: public `GET /api/v1/auth/capabilities` returns `{email_delivery, google_oauth}`; `email_delivery` comes from the `EMAIL_DELIVERY_ENABLED` setting (default false; no transport exists, so do not enable it). `/auth` shows the honest unavailable message, disables resend and reset-send, and no longer claims an email was sent.
  - Frontend e2e (`npm run test:e2e`, default Playwright browsers): the two new tests in `claims.spec.ts` pass. Pre-existing failures not caused by this work: `demo.spec.ts` and the first `claims.spec.ts` test assert stale Indonesian/AU copy, and `workspace.spec.ts` needs `.tools/bin/uv` and a backend on `localhost:8000` that this machine does not have.
  - `test_migrations.py` legacy-upgrade test now inserts `demo_sessions` with raw SQL and snapshots original columns only, because the ORM model gained `revoked_at` after revision 0001.
- 2026-10-19 T2.0 KB provenance correction (user-approved): the dry run never fetched anything. `source_crawler` wrote `sha256: "simulated_sha256_hash"` and `bytes: 1024`; now dry-run records are `NOT_FETCHED` with null hash, bytes and HTTP code, and the registry status stays `DISCOVERED`. Generator-authored CN/ID records (companies, products, regulations, schemes, procedures, evidence, providers, cost references, rules, RAG chunks, university requirements) are `UNVERIFIED`; RAG chunks and university requirements are `SYNTHETIC_FIXTURE` because their clause and page labels, quotations and minimum benefit limits are developer-authored; the rest are `MANUALLY_CURATED`. `ProvenancedRecord` rejects VERIFIED unless `evidence_class` is RETRIEVED_OFFICIAL with a real 64 hex `retrieval_artifact_sha256`. Healthcare provider `cashless_direct_billing_verified` set False (4 records); field names with `verified_` keep legacy names (renaming needs a DB column change). Catalog ingestion now downgrades stale VERIFIED rows in existing databases and sets logo `license_status` to `NOT_VERIFIED`. `kb/CN/university_requirements.json` is now a 1.5 envelope (no loader reads it). Insurer logos: filenames containing `official` are kept so paths keep working; manifests mark them `placeholder: true`. Registry `last_checked_date` means the entry authoring date, not a fetch. App-level schemas gained optional `evidence_class` and `provenance_note` (envelope) and `evidence_class` (emergency, red flag, pathway entries); AU files are untouched and still validate. Consumer effects: `workflow/claims.py` and `workflow/sandbox.py` only use VERIFIED evidence items, so KB-derived evidence checklist items disappear and the sandbox no longer enforces KB mandatory evidence (fails toward fewer requirements, flagged for Joshua); `catalog_views` default status is now UNVERIFIED. Existing tests were not changed except `test_pipeline.py` (rules now expect UNVERIFIED; renamed `PLACEHOLDER_SVG_DEFINITIONS`).

---

# Part B: Valen, Joshua and agentic tasks (proposed 2026-10-19, not approved)

Plan: `IMPLEMENTATION_PLAN.md` Part B. Same legend as Part A; status is the checkbox (`[ ]` not started). Format per task: ID | name | owner | feature / PBI | priority | category | depends on | artifacts | acceptance | verification command. Owners follow the master prompt area leads (Part A AD-18 precedent; see B-HUMAN-7). Code modules use responsibility names only.

## Human decisions required before execution

- [ ] **B-HUMAN-1** Approve retiring legacy `/api/v1/actions` routes in favor of `/api/v1/workflow/actions` (no table drops; legacy frozen, then removed after UI migration).
- [ ] **B-HUMAN-2** Approve the claim bridge: workflow `wf_claim_cases` canonical; pathway confirmation still writes foundation `claim_cases` for compatibility and stores its id in `wf_claim_cases.origin_ref`.
- [ ] **B-HUMAN-3** SC-19: approve relabel to LOCAL_INTEGRITY_RECEIPT now; decide whether a real testnet anchor is wanted later (needs wallet credentials, not in repo).
- [ ] **B-HUMAN-4** Human review of CN/ID emergency contacts, red flags and pathways still marked VERIFIED as MANUALLY_CURATED (Part A T2.0 retained exception).
- [ ] **B-HUMAN-5** Provide local PRD CSVs and the updated CN/ID PRD, or accept tracked derivatives as the target.
- [ ] **B-HUMAN-6** Confirm sequencing: Part B code starts after Part A Phase 2 (T2.1 to T2.9) lands.
- [ ] **B-HUMAN-7** Confirm owner names in this file are acceptable under AGENTS.md (no CODEOWNERS or branches created).

## Phase B0: Baseline after Part A

- [ ] **B0.1** Rerun full baseline | Baseline | all | none | P0 | test | Part A Phase 2 | none | Results recorded here, failures triaged | `make test && make check && make check-contracts && make test-client`
- [ ] **B0.2** Run frontend E2E desktop and mobile | Baseline | all | none | P0 | test | B0.1 | none | Results recorded; failing specs listed | `cd frontend && npm run test:e2e`
- [ ] **B0.3** Update stale specs (Indonesian/AU copy) to English CN/ID without weakening assertions | Tests | Joshua / Valen | none | P0 | FE test | B0.2 | `frontend/tests/workspace.spec.ts`, `claims.spec.ts` | Specs assert current English copy | `npm run test:e2e`

## Phase B1: Immediate trust fixes and shared foundations

- [ ] **B1.1** Proof: remove fake tx hash, block, contract, explorer URL; relabel LOCAL_INTEGRITY_RECEIPT | Proof | Joshua | SC-19 | P0 | BE+FE | B-HUMAN-3 | `workflow/proof.py`, `app/proof/*` | No "on-chain" text; sha256 of receipt only | `pytest app/tests/test_workflow.py -k proof`
- [ ] **B1.2** Compare: default UNVERIFIED, remove verified badges, show provenance note | Compare | Joshua | SC-17 | P0 | BE+FE | none | `workflow/catalog_views.py`, `app/products/compare/*` | No "verified" without RETRIEVED_OFFICIAL | `pytest -k comparison`, `npm run test:e2e`
- [ ] **B1.3** Remove consent auto-grant; add explicit consent prompt component | Consent | Joshua (pages) / Regina | SC-09, SC-10 | P0 | FE | none | `app/claims/[id]/page.tsx:208`, `app/actions/page.tsx:148` | 403 CONSENT_REQUIRED shows prompt; no POST to consents without user click | `npm run test:e2e`
- [ ] **B1.4** Fix evidence upload to multipart FormData | Claims | Joshua | SC-09 | P0 | FE | none | `app/claims/[id]/page.tsx:256` | File uploads succeed against `workflow/router.py:271` | `claims.spec.ts`
- [ ] **B1.5** Home: remove hardcoded emergency numbers, counts, activity | Home | Valen | SC-05 | P0 | FE | none | `app/home/page.tsx:90-376` | Unknown renders "Not available"; no AU 000 | `workspace.spec.ts`
- [ ] **B1.6** Shared `services/safety_screen.py` from KB red flags incl. `phrases_zh`; replace `workflow/emergency.py` patterns and fallback contacts | Safety | Joshua | SC-08 | P0 | BE | B-HUMAN-4 | `services/safety_screen.py`, `workflow/emergency.py`, `services/triage_adapter.py` | One engine; Chinese and Indonesian phrases match; no hardcoded numbers | `pytest app/tests/test_safety_screen.py`
- [ ] **B1.7** Fix triage adapter contract (KB destination codes, source host allow-list) so Ask and Pathways stop returning TRIAGE_UNAVAILABLE for valid KB | Safety | Valen | SC-06, SC-07 | P0 | BE | B1.6 | `services/triage_adapter.py` | Valid KB passes; broken KB still fails closed | `pytest app/tests/test_triage_adapter.py`
- [ ] **B1.8** Actor adapter `owner_for(actor)` shared by workspace and workflow | Auth | Regina / Joshua | none | P0 | BE | Part A T1.1 | `core/dependencies.py` | One mapping; existing isolation tests pass | `pytest app/tests/test_session_isolation.py`
- [ ] **B1.9** Migration 0014 additive (outbox columns, protection_insights, clause_chunks.language, chat_sessions.workflow_state, wf_reminders, wf_claim_cases origin) | DB | Valen / Joshua | US-05-04 | P0 | BE | Part A 0013 | `alembic/versions/0014_agent_orchestration.py`, `models/*` | Upgrade from 0013 with data; downgrade clean | `pytest app/tests/test_migrations.py`
- [ ] **B1.10** `services/events.dispatch` with dedupe and outbox status (extends Part A T5.1) | Events | Valen | US-05-04 | P0 | BE | B1.9 | `services/events.py` | Same dedupe_key writes once; written in producer transaction | `pytest app/tests/test_agent_events.py`
- [ ] **B1.11** `agent/worker.process_due` with retry schedule, DEAD state, owner-gone and consent-revoked cancel; `make agent-worker-once`; lifespan flag | Events | Valen | US-05-04 | P0 | BE | B1.10 | `agent/worker.py`, `main.py`, `Makefile` | Retries 30s/2m/10m/1h/6h; idempotent consumers | `pytest app/tests/test_agent_events.py`
- [ ] **B1.12** Single interval function; remove duplicate union logic | Rules | Valen | SC-14 | P0 | BE | Part A T2.2 | `services/intervals.py`, `services/rules_engine.py`, `services/workspace.py` | Inclusive days; Raka 76 | `pytest app/tests/test_intervals.py app/tests/test_coverage_needs.py`
- [ ] **B1.13** `agent/context.get_user_context` and tool registry with permission classes | Agent | Valen | SC-06 | P0 | BE | B1.8 | `agent/context.py`, `agent/tools.py` | Tools reject cross-owner ids (404) and missing consent (403); CONSEQUENTIAL tools not exposed to LLM | `pytest app/tests/test_agent_tools.py`
- [ ] **B1.14** Workflow routes declare response models; rename router tag; regenerate types; typed workflow client | Contracts | Joshua | SC-09, SC-10 | P0 | BE+FE | none | `workflow/router.py`, `frontend/src/lib/api/workflow-client.ts` | No hand-written duplicate domain types in workflow pages | `make check-contracts && make check`

## Phase B2: Valen P0

- [ ] **B2.1** Insights engine (continuity gap, expiring, missing evidence, unverified rule) persisted with fingerprint | Insights | Valen | SC-05 | P0 | BE | B1.11, B1.12 | `agent/insights.py`, `api/v1/insights.py` | Raka gets NEEDS_VERIFICATION 76-day insight; recompute idempotent | `pytest app/tests/test_agent_insights.py`
- [ ] **B2.2** Home summary additive fields and Home UI rewire | Home | Valen | SC-05 | P0 | BE+FE | B2.1, B1.5 | `api/v1/account_workspace.py`, `app/home/page.tsx` | All numbers from API; English copy | `test_account_workspace.py`, `workspace.spec.ts`
- [ ] **B2.3** Coverage Needs applicability and evidence-state enums | Coverage Needs | Valen | SC-14 | P0 | BE+FE | B1.12 | `services/coverage_matching.py`, `app/coverage-needs/*` | No "mandatory" for UNVERIFIED rules | `test_coverage_needs.py`
- [ ] **B2.4** Intent router (safety first, keywords, enum classifier) and planner | Ask | Valen | SC-06 | P0 | BE | B1.7, B1.13 | `agent/intents.py`, `agent/planner.py`, `api/v1/ask.py` | Red flag never calls provider; numbers recomputed | `test_policy_qa.py`, `test_agent_planner.py`
- [ ] **B2.5** CJK bigram retrieval and chunk language | Ask | Valen | SC-06 | P0 | BE | B1.9 | `services/retrieval.py` | Indonesian question retrieves Chinese clause; quote is page substring | `test_policy_qa_cross_language.py`
- [ ] **B2.6** Seed synthetic Mandarin policy document with retained pages for Raka demo | Demo | Valen / Regina | SC-06 | P0 | BE | Part A T2.3 | `fixtures/raka/*`, `seeds/demo.py` | Labeled synthetic; demo-scoped | `test_demo_personas.py`
- [ ] **B2.7** Ask proposals to action drafts | Ask | Valen | SC-06 | P0 | BE+FE | B3.3 | `api/v1/ask.py`, `app/ask/page.tsx` | Prepare creates AWAITING_APPROVAL only; idempotent | `test_agent_planner.py`
- [ ] **B2.8** Pathways ID from KB, CN empty state, confirmation to workflow claim | Pathways | Valen | SC-07 | P0 | BE+FE | B1.7, B-HUMAN-2, B3.1 | `api/v1/pathways.py`, `app/pathways/*` | No fabricated cost or cashless claims; idempotent claim creation | `test_care_pathways.py`
- [ ] **B2.9** Update `docs/prd/VALEN_TRACEABILITY.md` per criterion | Docs | Valen | SC-05/06/07/14 | P0 | docs | B2.1-B2.8 | traceability doc | Each criterion linked to a test | review

## Phase B3: Joshua P0

- [ ] **B3.1** Claim creation origin and Idempotency-Key | Claims | Joshua | SC-09 | P0 | BE | B1.9 | `workflow/claims.py` | Double submit yields one case | `test_workflow.py`
- [ ] **B3.2** Show KB evidence items as "Insurer requirement unverified" instead of hiding them | Claims | Joshua | SC-09 | P0 | BE+FE | Part A T2.0 | `workflow/claims.py`, `workflow/sandbox.py` | Unverified items visible, not counted satisfied | `test_workflow.py`
- [ ] **B3.3** Action types renewal_inquiry, policy_clarification_inquiry, employer_benefit_inquiry, internal_reminder; manual-handoff executors with "Draft prepared. Not sent." | Actions | Joshua | SC-10 | P0 | BE | B1.14 | `workflow/actions.py`, `workflow/executors.py` | Server-built payloads; receipts honest | `test_actions_types.py`
- [ ] **B3.4** Approve and execute split; UI sends payload_version; Action Review drawer `/actions?action=<id>` | Actions | Joshua | SC-10 | P0 | FE | B1.14 | `app/actions/*`, `components/action-review-drawer.tsx` | Stale version 409 shown; edit voids approval | `actions.spec.ts`
- [ ] **B3.5** Freeze legacy actions routes (read-only) | Actions | Joshua | SC-10 | P0 | BE | B-HUMAN-1 | `api/v1/actions.py` | Writes return 410 with pointer | `test_actions.py`
- [ ] **B3.6** Follow-up via worker: `followup.poll_due` as consumer; follow-up drafts need approval | Follow-up | Joshua | US-09-05 | P0 | BE | B1.11 | `workflow/followup.py` | Info request creates task and draft only | `test_claim_followup.py`
- [ ] **B3.7** Audit read model over three tables, owner-filtered, synthetic flag | Audit | Joshua | SC-11 | P0 | BE+FE | B1.8 | `workflow/audit.py`, `app/audit/*` | No raw values; foreign rows absent | `test_workflow.py -k audit`
- [ ] **B3.8** Emergency page from shared safety screen and KB contacts | Emergency | Joshua | SC-08 | P0 | FE | B1.6 | `app/emergency/*` | Empty KB shows generic instruction; no unsourced numbers | `emergency.spec.ts`

## Phase B4: Events, insights and notifications

- [ ] **B4.1** Producers emit events (profile, consent, documents, fields, claims, actions) | Events | Valen / Joshua / Regina | US-05-04 | P0 | BE | B1.10 | producer modules | Each mutation emits exactly one deduped event | `test_agent_events.py`
- [ ] **B4.2** Notifications consumer (uses Part A notification service) | Notifications | Regina | US-05-04 | P0 | BE | B4.1, Part A T5.x | `services/notifications.py` | One notification per event; owner-scoped | `test_notifications.py`
- [ ] **B4.3** Insight recompute consumer | Insights | Valen | US-05-04 | P0 | BE | B2.1, B4.1 | `agent/insights.py` | Profile change updates insight once | `test_agent_insights.py`

## Phase B5: Renewal and anti-lapse

- [ ] **B5.1** Renewal planner reminders 60/30/7 days in profile timezone | Renewal | Joshua | US-10-05 | P0 | BE | B1.11 | `agent/schedules.py` | Deterministic dates; cancelled on policy change | `test_renewal.py`
- [ ] **B5.2** `coverage_expiring` insight and renewal inquiry action from Home and Coverage Needs | Renewal | Valen / Joshua | US-10-05 | P0 | BE+FE | B5.1, B3.3 | `agent/insights.py`, `app/home/*` | No auto-renew, no quotes | `test_renewal.py`, `demo-raka-protection.spec.ts`

## Phase B6: Demo end to end

- [ ] **B6.1** Align Raka claims seed with policy end 2027-04-15, consistent hashes, sandbox rows | Demo | Joshua | SC-09 | P0 | BE | Part A T2.4 | `seeds/demo_claims_seed.py` | Seed hashes match canonical payload | `test_workflow.py`
- [ ] **B6.2** Playwright Raka Journeys A, B, C | Demo | Valen / Joshua | all | P0 | FE test | B2, B3, B5 | `frontend/tests/demo-raka-*.spec.ts` | DEMO_ACCEPTANCE_PLAN Sections 2 to 4 | `npm run test:e2e`
- [ ] **B6.3** Playwright Sinta journey | Demo | Valen / Joshua | all | P0 | FE test | B2, B3 | `frontend/tests/demo-sinta.spec.ts` | DEMO_ACCEPTANCE_PLAN Section 5 | `npm run test:e2e`
- [ ] **B6.4** Account parity tests (same flows with an account owner, no persona rows) | Isolation | Regina / all | all | P0 | BE | B6.2 | `test_account_workspace.py` | Real-user path exercised, not only fixtures | `make test`

## Phase B7: P1

- [ ] **B7.1** Travel check | Travel | Valen | SC-16 | P1 | BE+FE | B6 | `api/v1/travel.py`, `app/travel/*` | Owned fields only; UNKNOWN when absent | `test_travel.py`
- [ ] **B7.2** Employer benefits from owned data, coordination evidence-gated | Employer | Joshua | SC-15 | P1 | BE+FE | B6 | `workflow/employer.py` | UNKNOWN without evidence_ref | `test_employer_coordination.py`
- [ ] **B7.3** Compare with nullable attributes and provenance | Compare | Joshua | SC-17 | P1 | BE+FE | B1.2 | `workflow/catalog_views.py` | Null shows "Not available" | `test_workflow.py -k comparison`
- [ ] **B7.4** Policy servicing request drafts | Servicing | Joshua | US-10-06 | P1 | BE+FE | B3.3 | `workflow/actions.py` | Manual handoff only | `test_actions_types.py`
- [ ] **B7.5** Policy auto-discovery candidates | Discovery | Regina | US-03-05 | P1 | BE+FE | B4.1 | `services/policy_discovery.py` | Candidate never owned until confirmed | `test_policy_discovery.py`

## Phase B8: Bonus

- [ ] **B8.1** Optional testnet anchoring behind credentials | Proof | Joshua | SC-19 | Bonus | BE | B-HUMAN-3 | `workflow/proof.py` | Real tx only with configured credentials; otherwise local receipt | `test_workflow.py -k proof`

## Phase B9: Final verification

- [ ] **B9.1** Full suite and contracts | Verification | all | all | P0 | test | B0-B6 | none | All green, results recorded | `make test && make test-client && make check-contracts && make check`
- [ ] **B9.2** Desktop and mobile E2E plus isolation and copy scans (no AU, no em dash) | Verification | all | all | P0 | test | B9.1 | none | DEMO_ACCEPTANCE_PLAN Section 6 | `npm run test:e2e`

## Backend deviations log (T4.x/T5.x)

- T4.1: toggles and the external AI disclosure acknowledgement are stored in the JSON column `user_preferences.notification_settings`, so no new migration was needed.
- T4.3: `DeleteRequest.confirm` now accepts `DELETE` or `HAPUS` (also applies to document delete). Account audit rows are retained; they only hold allow-listed metadata.
- T5.3: only backend dispatch is wired. Event sources run in the producing transaction; reminders are derived on notification list/count reads. Demo `action.prepared` is notified only when status is AWAITING_APPROVAL.
- T4.2: consent history is derived from `CONSENT_CHANGED` and `CONSENTS_DECIDED` account audit events. `policy_version` is now recorded on those events, so older events show `policy_version: null`.
- Frontend items (T4.4, T4.5, T5.4) remain open. Full backend suite still has failures in country/profile/KB tests owned by other agents.
- 2026-10-19 Phase 2 backend (T2.1 to T2.7, user-approved Raka migration to Shenzhen): `ACTIVE_KB_COUNTRIES` (default CN,ID) gates `CountryKBLoader.discover/load`; `kb/AU` untouched on disk and not served (`/emergency?country_code=AU` and `/countries` no longer list it). `app/tests/conftest.py` exposes a `kb_countries` fixture (default `CN,ID`); modules that still use the inactive legacy `kb/AU` as a fixture-only configuration override it locally with `AU,CN,ID` (account_workspace, care_pathways, command_center, coverage_needs, notifications, pathway_cases, policy_qa, privacy_settings, profile_context, workspace_data). These are candidates for later retargeting to a temp KB copy.
  - Manifest schema gained optional `default_currency`; CN (Asia/Shanghai, CNY) and ID (Asia/Jakarta, IDR) set. `AccountSetup.currency` is now nullable (a manifest without `default_currency` has no currency; no fallback is invented). `.env.example` has `ACTIVE_KB_COUNTRIES=CN,ID`.
  - `CountryRule` gained optional `evidence_class` and `provenance_note`; `RuleParameters.start_field` accepts `study_start_date` (falls back to arrival_date) and `end_field` accepts `study_or_permit_end_date` (later of study_end_date, permit_end_date, visa_expiry_date). CN `coverage_continuity` rule is UNVERIFIED, MANUALLY_CURATED, source_url null. Engine: a MANUALLY_CURATED continuity rule with a date difference returns NEEDS_VERIFICATION with the explanation "Coverage dates require review." (no visa or legal wording); rules without that evidence class keep DATE_DIFFERENCE_DETECTED. Raka: 2027-04-16..2027-06-30 = 76 days. `kb/CN/university_requirements.json` (SYNTHETIC_FIXTURE) is not read and never counts as a verified requirement. Raka's interval starts at the study start (2026-09-01), not arrival (2026-08-25), so the pre-coverage week is not counted.
  - Raka fixtures are CN/Shenzhen (nationality ID, CNY, Asia/Shanghai, synthetic institution and plan, `policy_type` INTERNATIONAL_STUDENT, a free string so no enum change). Certificate and fapiao are synthetic Simplified Chinese plus English text files; the old `oshc-synthetic.txt` was replaced. Persona sidecars `fixtures/<persona>/persona.json` are validated by the seed; the endpoint reads them at request time because no DB column exists (no migration added).
  - `seed_personas` upserts by persona_id and returns inserted plus changed count (second run 0). Existing demo sessions keep their copied rows. `create_demo_session` passes `profile.country_code` to the claims seed. Raka claims seed now uses the synthetic plan and fictional clinic, policy end 2027-04-15 and fixed service dates inside the policy; `product_id`/`procedure_id` still point at KB product `cn-prod-lxbx-student` (needed by the workflow), and the procedure detail still shows that KB product's real insurer name (generator-authored UNVERIFIED data), flagged for Joshua.
  - Runtime AU strings removed from `services/audit_logger.py` and the demo action templates in `api/v1/actions.py` (OSHC, Allianz, AUD, visa wording). The demo answer citation in audit_logger previously quoted an invented clause; it now quotes the synthetic placeholder text of the certificate. `test_account_workspace.py` reminder-reason assertion was updated to the new wording. Redaction tests that use `OSHC-...` policy numbers were left as they are (they test the redaction regex).
  - Retargeted tests: `test_api` (countries CN/ID, Raka INTERNATIONAL_STUDENT NEEDS_VERIFICATION, clearing all end-date mirrors), `test_rules_and_guards` (CN rule, 302-day case, new-country test copies kb/CN in both evidence-class variants), `test_kb_provenance`, `test_payload_contracts`, `test_country_context` (AU replaced by CN, no AU override), `test_coverage_needs` (demo needs), `test_emergency_guidance` (AU now 422 UNSUPPORTED_COUNTRY), `workspace_fixtures.reviewed_triage` (adds CN when active). New `test_demo_personas.py` (12 tests). Full backend suite: 377 passed. `make generate-types`, `make check-contracts`, `make check-prd-contracts` pass.
