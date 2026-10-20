# INSURRA Implementation Plan: Accounts, Context, Demo Personas, Agentic Integration

Status: planning approved for execution on 2026-10-19. Branch `feat/figma-redesign-my-protection-screens`, head `be9077b`.
Companion files: [ARCHITECTURE.md](ARCHITECTURE.md) (target design) and [TASKS.md](TASKS.md) (checklist and progress state). A resumed session reads all three and continues from the first unchecked dependency-ready task in TASKS.md.

## 1. Objective

Make INSURRA a coherent product with three explicit experiences (public visitor, isolated interactive demo, real account), with China (CN) and Indonesia (ID) as the only active insurance knowledge markets. Deliver real authentication, persisted onboarding, a profile screen, notifications driven by actual events, a functional Settings and Privacy screen, and two demo personas (Raka in Shenzhen, Sinta in Jakarta) that flow through the existing Home, My Protection, Documents, Ask INSURRA, Care Pathways, Claims, Actions and Audit modules.

## 2. Inputs and missing inputs

| Input | State |
| --- | --- |
| `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md` | Read. Several lines are stale relative to the code (see section 6). |
| Local PRD CSVs (`docs/prd/*.csv`) | **Missing on this machine.** `make check-prd-source` cannot run. Tracked derivatives (`API_CONTRACT_MANIFEST.json`, `SCREEN_ROUTES.md`, `DECISIONS.md`, `COUNTRY_INTEGRATION.md`, traceability files) are used instead. |
| "Updated CN/ID PRD" | **Not found in the repository.** The master prompt itself is used as the CN/ID product specification. |
| `kb/CN`, `kb/ID`, `kb/global`, `kb/exports`, `kb/assets/insurers` | Present and audited (section 3.4). |
| `fixtures/raka`, `fixtures/sinta`, `fixtures/synthetic` | Present and audited (section 3.5). |

## 3. Current implementation inventory (audited 2026-10-19)

### 3.1 Baseline health

- `make test`: **284 passed, 12 failed** before any change in this plan. Failures: 9 in `test_account_workspace.py` (completeness `coverage_continuity` returns null, policy wallet, audit timeline, guardrail subtypes, action approve/execute), `test_api.py::test_records_and_assessments[raka]`, two `test_coverage_needs.py` 76-day cases, `test_rules_and_guards.py::test_new_country_requires_only_configuration`. They appear to be fallout from merge `be9077b`. Phase 0 restores a green baseline before feature work.
- Uncommitted user edit in `frontend/src/app/protection/page.tsx` is preserved and not staged by this work unless the user asks.

### 3.2 Authentication and sessions

| Capability | Location | State |
| --- | --- | --- |
| Google OAuth (PKCE S256, state cookie, verified email only, fixed redirect, token in URL fragment) | `backend/app/api/auth.py:147-287` | Live |
| Email/password register, login, verify, resend, forgot, reset | `backend/app/api/auth.py:295-466` under `/api/v1/account/auth/*` | Live, but no email is ever delivered; verification and reset tokens stored in plaintext; verification token never expires; forgot-password unthrottled; login distinguishes unknown (401) from locked (423) |
| Shadow `/api/v1/auth/{register,...}` | `backend/app/api/v1/foundation.py:54-76` | 501 contract stubs |
| Account sessions (sha256 hash, 7 day TTL, revocable) | `models/auth.py:47-57`, `services/account_access.py` | Live |
| Demo sessions (`secrets.token_urlsafe(32)`, sha256 at rest, 24 h, per-session copy of persona data with remapped UUIDs) | `services/demo_sessions.py`, `api/v1/sessions.py` | Live. No end, reset, revocation or expired-row cleanup |
| Ambiguous credentials | `workflow/owner.py:101` (400) and `services/workspace.py:32` (422) reject both headers | Live. Legacy `ActiveSession` routes (`core/dependencies.py:37`) silently ignore `Authorization` |
| Frontend tokens | `sessionStorage` per tab (`lib/session.tsx`, `lib/auth.tsx`) | Live. `lib/api/workflow-client.ts:66-71` also copies the demo token into `localStorage` and silently creates a `raka` session on `/claims`, `/actions`, `/audit`, `/employer-benefits` |
| Route guarding | `components/layout/app-shell.tsx` | No redirect for unauthenticated private pages; `/auth?redirect=` is not validated (open redirect) |

### 3.3 Profile, onboarding, consent, privacy

- One canonical account profile (`AccountProfileRow`, JSON payload validated by `ProfileData` in `schemas/profile.py`) and one per-demo-session profile (`ProfileRow`). Both use the same schema. Good foundation, reused.
- `ProfileData` lacks nationality, study start/end, permit end (only `visa_expiry_date`), employer, goals (only `priorities` max 2) and a self-employed situation.
- Onboarding UI (`frontend/src/app/account/onboarding/page.tsx`, 1862 lines, six steps already matching the requested flow) keeps most answers in `localStorage["insurra.active-profile"]`, calls `PUT /account/profile` on every step (which marks the profile `completed=True` at step 1), swallows errors, never reads the server profile, never uses the existing `PUT /account/profile/draft`, and hardcodes Shenzhen University / Ping An defaults plus Australian options.
- Consent: three independent purposes for accounts (`account_consents`) and demo (`purpose_consents`). Enforcement via `require_grants` and `require_account_purposes`. No history table; changes are audit events.
- Privacy: `GET /account/inventory` (action count hardcoded 0), `DELETE /account/data` (confirm literal `HAPUS`). No export. Frontend copy claims consent records are purged although they are revoked. The localStorage profile is never cleared on deletion or logout.
- No `/profile` page, no `/notifications` page. Sidebar "Notifications" links to `/dashboard` with a hardcoded red dot; header bell is a static div.

### 3.4 Knowledge base and pipeline

- `kb/AU` (17 files, version 0.3.0), `kb/CN` and `kb/ID` (27 files each, CN 0.2.0, ID 0.3.0), `kb/global` (taxonomy with 7 categories in en/zh/id, extraction schemas). The KB loader auto-discovers every `kb/*/manifest.json`, so **AU is still served by `/api/v1/countries`**.
- `kb/CN/rules.json` and `kb/ID/rules.json` are empty. The only interval rule is AU `student-insurance-interval-v1`. CN/ID deterministic rules exist only in `backend/app/pipeline/generators/rules_data.py` and `kb/exports/joshua_data_package.json`.
- Pipeline: 28 registered sources (CN 15, ID 13). Default run is a dry run: `source_crawler.py:96-108` records `CACHED_OR_DRY_RUN` with `sha256: "simulated_sha256_hash"`. **No source has been fetched or parsed into the KB.** KB "VERIFIED" content in CN/ID companies, products, regulations, rag_chunks and `university_requirements.json` was produced by hand-written generators, and `university_requirements.json` is a bare list without the 1.5 envelope. `DATA_PROVENANCE_AND_QUALITY_REPORT.md` does not distinguish registered from fetched.
- Insurer "official" logos in `kb/assets/insurers` are placeholder SVGs generated in `pipeline/brand_assets/collector.py`, not official marks.

### 3.5 Fixtures and personas

- `fixtures/raka`: AU, Melbourne, OSHC, AUD, coverage 2026-07-01 to 2027-04-15, visa 2027-06-30 (76-day potential interval). No CN version exists.
- `fixtures/sinta`: ID, Jakarta, employee, BPJS + EMPLOYER policies in IDR, UNVERIFIED. Compatible.
- `backend/app/seeds/demo_claims_seed.py` (770 lines) seeds CN claims for Raka via `country_code="CN" if profile.country_code in ("CN","AU") else "ID"` in `demo_sessions.py:89`. So Raka today is an AU profile with CN claims.
- `fixtures/synthetic` (15 pipeline scenarios) and `test-documents/shenzhen_hospital_medical_fapiao.pdf` exist but use other names (John Doe, Budi Santoso) and 2024 dates.

### 3.6 Australian legacy runtime dependencies

`kb/AU` auto-discovery; `fixtures/raka`; `demo_sessions.py:89`; `api/v1/account_workspace.py:313` (`AUD if AU else IDR`, so CN gets IDR); `services/audit_logger.py:481-612` demo strings (OSHC, RULE-AU-OSHC-500); frontend onboarding AU options and 8501 copy (`account/onboarding/page.tsx:41,62,83,342,442-448,540,757-869,1154-1169`); `lib/user-context.tsx:40,68,78,169,184`; `auth/page.tsx:370`. Tests loading `kb/AU` directly: `test_rules_and_guards.py`, `test_alignment.py`, `test_coverage_needs.py`, `test_payload_contracts.py`, `test_pathway_cases.py`, `test_policy_qa.py`, `test_country_context.py`, `test_command_center.py`, `workspace_fixtures.py`.

### 3.7 Team modules to integrate, not rebuild

- Valen: `/home` (`services/command_center.py`), `/ask` (`services/policy_qa.py`), `/pathways` (`services/care_pathways.py`, `pathway_cases.py`), `/coverage-needs` (`services/coverage_matching.py`), `workspace_state.py`.
- Joshua: `backend/app/workflow/*` (claims, evidence, actions, approvals, sandbox, audit, reminders, agent events), `/claims`, `/claims/[id]`, `/actions`, `/emergency`, `/audit`, `/employer-benefits`.
- Regina: account auth, onboarding, documents (`account_documents.py`, 1990-line documents page), completeness, policies, family, privacy.

## 4. Scope and exclusions

In scope: identity and demo isolation hardening, Raka China migration, AU deactivation, canonical profile and onboarding persistence, `/profile`, `/notifications` with real event sources, `/settings/privacy` completion (preferences, export, honest connected sources), integration hooks into existing modules, tests and documentation.

Excluded (documented, not faked): real email delivery (no infrastructure), push/email notifications, real insurer APIs, live source fetching and re-verification of KB facts, replacing placeholder insurer logos, external connectors (no connector exists, so Connected Sources shows an honest empty state), Travel/Product comparison/Blockchain proof features, reassigning or rewriting Valen/Joshua engines.

## 5. Architecture decisions

| ID | Decision | Rationale |
| --- | --- | --- |
| AD-01 | Keep the two existing stores: `account_profiles` (accounts) and `profiles` (demo sessions), sharing one Pydantic `ProfileData`. Extend `ProfileData` additively. No new profile table. | Avoid competing profile systems; JSON payload means no migration for new optional fields. |
| AD-02 | Add optional profile fields: `nationality`, `situation` (`STUDENT`, `EMPLOYEE`, `SELF_EMPLOYED`, `OTHER`, mapped to existing `occupation`), `study_start_date`, `study_end_date`, `permit_end_date`, `employer_name`, `goals` (max 8), `protection_scope`. `visa_expiry_date` remains and is mirrored from `permit_end_date` for existing rules consumers. | Additive and backward compatible with Valen's readers. |
| AD-03 | Onboarding saves via `PUT /account/profile/draft` per step and `PUT /account/profile` only on Review. Server profile is the source of truth; `localStorage` becomes a non-authoritative display cache cleared on logout, delete and account switch. | Fixes premature `completed=True` and lost fields. |
| AD-04 | Active KB markets are configured by `ACTIVE_KB_COUNTRIES` (default `CN,ID`) in settings, applied in `kb_loader`. `kb/AU` stays on disk, untouched, inactive. No country-name branches in services. | Removes AU from runtime without deleting data; AGENTS forbids country conditionals. |
| AD-05 | Raka keeps `persona_id="raka"` and is migrated to CN Shenzhen, Indonesian nationality, international student, CNY, `INTERNATIONAL_STUDENT`. Institution is the explicitly fictional "Shenzhen Demo International University (synthetic)". Insurer is "Synthetic Student Health Plan (demo)". | No verified, fetched institution evidence exists; the KB `university_requirements` entries were generator-authored and cannot back a requirement. |
| AD-06 | Raka dates: study 2026-09-01 to 2027-06-30, coverage 2026-09-01 to 2027-04-15. Deterministic inclusive interval 2027-04-16 to 2027-06-30 = 76 days, status `NEEDS_VERIFICATION`, message "Coverage dates require review." | Preserves the documented 76-day regression without any visa claim. |
| AD-07 | Add a generic `coverage_continuity` rule to `kb/CN/rules.json` (UNVERIFIED, null source, applies to `INTERNATIONAL_STUDENT` policies against `study_end_date` / `permit_end_date`). `RulesEngine` compares against the later of the declared period ends. Never emits a legal or visa breach. | Prompt requirement; reuses existing `coverage_continuity` kind. |
| AD-08 | Persona templates are upserted by seed when the fixture content changes. Existing demo sessions keep their copied rows (no data rewrite); they expire within 24 h. | No destructive migration of live rows. |
| AD-09 | Demo reset = revoke current session and create a fresh session for the same persona, returning a new token. Demo end = revoke. New column `demo_sessions.revoked_at`. Expired and revoked sessions are purged opportunistically on session creation (cascade deletes per-session rows). | Reset by construction returns baseline; no shared mutable fixtures. |
| AD-10 | Every actor resolver rejects requests carrying both `Authorization` and `X-Demo-Session`, including legacy `ActiveSession` routes (`422 AMBIGUOUS_ACTOR`). Frontend never sends both and never persists demo tokens in `localStorage`; pages no longer auto-create a Raka session. | A demo token can never override or coexist with a real identity. |
| AD-11 | Notifications: new owner-scoped table `notifications` (account_id XOR session_id), unique `(owner, dedupe_key)`. A single `services/notifications.py` `emit()` is called by an in-process event dispatcher `services/events.py` that also records `wf_agent_events`. Reminder-type notifications (policy expiry) are derived deterministically on read from owned coverage dates with date-stamped dedupe keys. | Real events only, idempotent, no new worker infrastructure. |
| AD-12 | Preferences: new owner-scoped table `user_preferences` (notification toggles, display language). Connected Sources: no connector exists, so the API returns an empty list and the UI says so. | No fictional connections. |
| AD-13 | Privacy export: `GET /api/v1/account/export` returns a JSON bundle of the caller's own profile, consents, preferences, documents metadata, reviewed fields, coverages, claim cases, actions and notifications. Original document bytes excluded (listed by id). Audited. | Authorized, scoped export without new storage. |
| AD-14 | Delete confirmation accepts `DELETE` (English UI) and legacy `HAPUS`. Deletion also removes notifications and preferences and owner-scoped `wf_*` rows; audit rows are kept with redacted metadata. | English UI, idempotent cleanup. |
| AD-15 | Verification and reset tokens are stored as sha256 going forward; lookup accepts legacy plaintext rows once. Verification tokens expire after 48 h. Forgot-password throttled. Login returns the same 401 for unknown email and wrong password; lockout still enforced. No tokens are logged. | Security hardening without invalidating existing users. |
| AD-16 | Email delivery stays unavailable: UI states "Email delivery is not configured on this server" when no `SMTP_*` settings exist. Documented blocker. | Never fake an email send. |
| AD-17 | `/auth?redirect=` accepts only same-origin relative paths starting with `/` and not `//`. Private routes redirect unauthenticated visitors to `/auth?redirect=...` (account routes) or the landing demo picker (demo-only routes). | Closes open redirect; consistent guards. |
| AD-18 | TASKS.md lists the area lead per the master prompt (Regina: account and privacy; Valen: home, ask, pathways, coverage needs; Joshua: claims, actions, audit). Code modules keep responsibility names. | The user supplied ownership explicitly; AGENTS forbids developer names in modules only. |

## 6. Conflicts resolved with existing guidance

| Existing guidance | Master prompt | Resolution |
| --- | --- | --- |
| `frontend/AGENTS.md`: "Indonesian labels" | All UI text English | The code was already localized to English in `be9077b`. AGENTS language lines are updated to English UI. Remaining Indonesian islands (pathway confirmation dialog, `HAPUS`, document kind labels, backend error messages shown in UI) are translated. |
| `backend/AGENTS.md`: unchanged Raka 76-day result | Raka must move to China | 76 days preserved on CN dates (AD-06). Wording changes from visa to coverage continuity. |
| `frontend/AGENTS.md`: "no new profile wizard" | Full onboarding and profile | Superseded by the user's explicit request. AGENTS updated. |
| Root AGENTS: no ownership assignment | TASKS owner column | AD-18. |
| README: claim/action routes 501 | Joshua's workflow is live | Documentation updated to current state. |

## 7. Dependencies between teams

| Producer | Consumer | Interface | Change in this plan |
| --- | --- | --- | --- |
| Profile (Regina) | Home, Coverage Needs, Ask (Valen) | `ProfileData` via `account_profiles` / `profiles` | Additive fields only. Valen readers unchanged. |
| Documents (Regina) | Ask, Coverage (Valen); Claims evidence (Joshua) | `account_documents`, `account_fields`, `account_coverages` | Emit `document.extraction.completed` event. |
| Protection insights (Valen) | Actions (Joshua) | Home recommendations, pathway cases | Read-only integration. |
| Claim status, actions (Joshua) | Home (Valen), Notifications, Audit | `wf_claim_cases`, `wf_actions`, `workflow/audit.agent_event` | Event dispatcher hook emits notifications. |
| Consent (Regina) | All AI and action services | `require_grants`, `require_account_purposes` | Unchanged semantics; revocation emits event and notification. |

## 8. Implementation phases

| Phase | Goal | Exit criteria |
| --- | --- | --- |
| 0 | Restore green baseline | 12 failing tests fixed at the root cause, no assertion weakened |
| 1 | Identity and session foundation | AD-09, AD-10, AD-15, AD-17 implemented and tested |
| 2 | Demo persona migration and AU deactivation | AD-04 to AD-08; landing persona cards; demo intro; reset/end UI |
| 3 | Profile and onboarding | AD-01 to AD-03; `/profile`; context change confirmation |
| 4 | Privacy and consent | AD-12 to AD-14; settings sections; consent history view |
| 5 | Notifications | AD-11; bell, popover, page, filters, deep links |
| 6 | Module integration | Persona consistency across Home, Protection, Ask, Pathways, Claims; events wired from documents, claims, actions, consent |
| 7 | End-to-end validation and docs | E2E-01 to E2E-14 and security suite; `make test`, `make check`, `make check-contracts`, `make test-client`, `npm run test:e2e` |
| 8 | Final architecture review | Plan, tasks and docs match the code; open items listed honestly |

## 9. Database and migration plan

Single additive revision `0013_account_context_notifications` (down_revision `0012`):

1. `demo_sessions.revoked_at` nullable timestamp.
2. `notifications` table: id, account_id, session_id (owner XOR check, cascade), type, category, priority, title, body, entity_type, entity_id, deep_link, event_source, dedupe_key, created_at, read_at; unique `(account_id, dedupe_key)` and `(session_id, dedupe_key)`; index on owner plus `read_at`.
3. `user_preferences` table: id, account_id, session_id (owner XOR), notification settings JSON, display_language, updated_at; unique per owner.
4. `accounts.verification_token_expires_at` nullable timestamp.

No column drops, renames, or status rewrites. Tests: fresh upgrade, populated upgrade from 0012, SQLite and PostgreSQL-portable types.

## 10. API plan (all under `/api/v1`, generated into OpenAPI and `types.gen.ts`)

| Method and path | Actor | Purpose |
| --- | --- | --- |
| `POST /demo/sessions/me/reset` | demo | Revoke and recreate same persona; returns new session token |
| `DELETE /demo/sessions/me` | demo | End demo session (204) |
| `GET /demo/personas` | public | Extended with country, categories, description |
| `GET /account/profile`, `PUT /account/profile/draft`, `PUT /account/profile` | account | Existing; additive fields; final PUT only on Review |
| `GET /profile`, `PUT /profile` | demo | Existing; additive fields; session-scoped edits |
| `GET /context` | account or demo | Unified user context (profile summary, mode, synthetic flag, active country, currency) |
| `GET /notifications?filter=&limit=&offset=` | account or demo | List |
| `GET /notifications/unread-count` | account or demo | Count |
| `POST /notifications/{id}/read`, `POST /notifications/read-all` | account or demo | Read state |
| `GET /preferences`, `PUT /preferences` | account or demo | Notification and AI preferences |
| `GET /account/connected-sources` | account | Honest empty list |
| `GET /account/export` | account | Scoped JSON export |
| `GET /account/consents/history` | account | Consent change history from audit events |
| `DELETE /account/data` | account | Accepts `DELETE` or `HAPUS` |

## 11. Demo persona migration plan

1. Rewrite `fixtures/raka/*` to CN (profile, insurance record with one `INTERNATIONAL_STUDENT` policy in CNY, documents list with a Chinese-language synthetic certificate text and a synthetic fapiao text for Raka dated 2026-10-12, evidence placeholders). All values labeled synthetic.
2. Align `demo_claims_seed.py` Raka data (patient name Raka, dates inside the policy period, CNY) and derive country from the persona profile without the AU mapping.
3. Replace AU demo strings in `audit_logger.py` with CN equivalents.
4. Add CN `coverage_continuity` rule, CN `default_timezone` `Asia/Shanghai`, CN currency resolution from KB manifest (`default_currency`), removing `AUD if AU else IDR`.
5. Seed upserts persona templates; `make seed` remains idempotent.
6. Retarget AU-loading tests to CN or to a test-only KB fixture directory, keeping each test's intent.
7. Sinta: preserve fixtures; verify JKN and employer coverage stay separate, coordination remains unknown, no remaining balances.

## 12. Security and privacy plan

See ARCHITECTURE.md sections 6, 11 and 13. Key controls: hashed opaque tokens only; ambiguity rejection everywhere; owner-scoped repositories (404 for foreign and missing); purpose grants rechecked per call; notifications carry no medical detail; export and delete audited with redacted metadata; same-origin redirect validation; rate limits on auth endpoints; no tokens in logs, URLs (except the existing OAuth fragment, removed immediately) or `localStorage`.

## 13. Frontend design and navigation plan

- Keep the existing shell and eight-item sidebar (already correct). Bottom entries: Notifications (`/notifications`, backend unread badge) and Profile (`/profile`).
- Header bell opens a recent-notifications popover; header avatar links to `/profile`.
- Brand: keep the existing tokens in `globals.css` and the kangaroo mascot assets in `frontend/public`. Use mascot in landing, onboarding, empty states only. No new palette.
- Landing: keep layout; persona section shows two cards (Raka, Sinta) with country, categories, description and Start Demo, plus a short synthetic-data notice. Primary CTAs: Get Started and Try Interactive Demo.
- Demo banner in the shell: "Synthetic demo: Raka" with Reset Demo and Exit Demo.
- English copy only; no em dashes; empty placeholders use "Not available".

## 14. End-to-end test strategy

Backend pytest suites per phase (security, migration, persona, notifications, privacy). Playwright desktop and mobile specs: `account.spec.ts` (E2E-01 to E2E-06 using the email/password route with a test-only verification helper reading the DB through a test fixture endpoint gated by `ENVIRONMENT=test`), `demo-personas.spec.ts` (E2E-07 to E2E-14). Existing `demo.spec.ts`, `claims.spec.ts`, `workspace.spec.ts` must keep passing.

## 15. Risks and blockers

| Risk | Mitigation |
| --- | --- |
| Baseline red suite hides regressions | Phase 0 first |
| Retargeting AU tests could weaken coverage | Keep assertions; move to CN or test KB fixture |
| Joshua pages relied on silent Raka session creation | Replace with explicit session-required state linking to demo picker; update `claims.spec.ts` |
| KB "VERIFIED" labels on generator-authored data | Not consumed by the Raka scenario; recorded as an external verification need; not silently relabeled in other teams' data |
| No email infrastructure | Honest unavailable state; E2E verifies via test-only path |
| Large frontend files (onboarding 1862 lines, documents 1990 lines) | Targeted edits; no rewrite |

## 16. Definition of Done

Matches master prompt Part XXI. Each checklist item in TASKS.md is checked only after its tests pass. Unfinished items stay unchecked and are listed in the final report.

---

# Part B: Valen, Joshua and agentic architecture plan

Status: proposed, awaiting approval (planning session 2026-10-19). Part A above is unchanged. Part B builds on Part A and is sequenced after Part A Phase 2 (Raka in CN, AU inactive). Detailed content lives in:

- `docs/FEATURE_GAP_ANALYSIS.md` (evidence, file:line)
- `docs/AGENTIC_AI_ARCHITECTURE.md` (agent, tools, events, worker, insights)
- `docs/INTEGRATION_CONTRACTS.md` (cross-team interfaces)
- `docs/DEMO_ACCEPTANCE_PLAN.md` (Raka and Sinta walkthroughs)
- Tasks: `TASKS.md` Part B (B0 to B9)

## B1. Executive summary

The workspace and workflow surfaces exist but several prior "completed" claims do not hold: Ask and Pathways fail closed because the triage adapter rejects the KB (`services/triage_adapter.py:28`), Home is hardcoded, the proof screen fabricates an on-chain transaction (`workflow/proof.py:45-65`), product comparison shows unverified data as verified, claim evidence upload is broken (JSON sent to a multipart endpoint), and two pages silently grant consent. The action approval core (hash, versioning, idempotent sandbox execution, HMAC receipts) is real and is kept. Part B adds one bounded in-process agent (typed tools, deterministic computation, approval-gated actions), a transactional outbox plus worker for event orchestration, persisted protection insights, and fixes the trust defects first.

## B2. Existing implementation status

See `docs/FEATURE_GAP_ANALYSIS.md` Section 2. Summary: SC-05 hardcoded UI, SC-06/SC-07 blocked by triage, SC-14 logic works with AU-era rules, SC-16 missing, SC-08 hardcoded engine, SC-09 incomplete, SC-10 core verified with a duplicate legacy system, SC-11 mixed real and seeded events, SC-15 hardcoded, SC-17 false verification badges, SC-19 fabricated anchoring.

## B3. Verified and unverified features

- B3.1 Baseline: backend `make test` (pytest) 321 passed at 19:05 WIB on the working tree. An earlier run during concurrent edits by the Part A session showed 2 failed and 77 errors from mid-edit files; `test_workflow.py` passed 8/8 alone. Treat the baseline as unstable until Part A lands; B0.1 reruns it.
- Not run in this audit: `make check`, `make check-contracts`, `make test-client`, `npm run test:e2e`. Part A notes record stale E2E specs.
- No KB fact is retrieval-verified (Part A T2.0).

## B4. Target architecture

`ARCHITECTURE.md` Part B diagrams. One FastAPI process: routers, then `agent/` (context, intents, planner, tools, insights, worker, schedules), then services (rules, intervals, retrieval, safety screen, events, notifications), then SQLAlchemy. The LLM is used only for intent classification fallback, grounded explanation and draft wording through the existing Responses gateway with structured output. No LLM tool calling for consequential tools.

## B5. Agentic system design

`docs/AGENTIC_AI_ARCHITECTURE.md`. Permission classes: READ_USER_CONTEXT, READ_PUBLIC_KNOWLEDGE, DETERMINISTIC_COMPUTE, INTERNAL_STATE_UPDATE, DRAFT_PREPARATION, SAFETY_ROUTING, CONSEQUENTIAL_EXTERNAL (never offered to the model; only `actions.execute` after approval).

## B6. Event and workflow orchestration (US-05-04)

Transactional outbox on `wf_agent_events` (extended additively). Producers write events in the same transaction. `agent/worker.process_due()` claims due rows, runs consumers idempotently, retries 30s/2m/10m/1h/6h, DEAD after 5. Runs in app lifespan behind `AGENT_WORKER_ENABLED` (default false in tests), via `make agent-worker-once`, and directly in tests. Consumers: insights recompute, notifications, reminders, claim follow-up (`followup.poll_due`, currently never called).

## B7. Valen feature plans

- SC-05 Home: replace hardcoded hero, counts, activity and emergency numbers with `home/summary` additive fields and `/insights`. Unknown counts render "Not available".
- SC-06 Ask: single safety screen first; intent router; owned-document retrieval with CJK bigram tokenizer and `clause_chunks.language`; citations quote original text; proposals create action drafts only.
- SC-07 Pathways: fix triage adapter contract (KB destination codes, `phrases_zh`, source host allow-list) with tests; ID pathways from KB; CN pathways empty means "Not available", not fabricated.
- SC-14 Coverage Needs: applicability and evidence-state enums; single interval function replacing the duplicated union in `rules_engine` and `uncovered_interval()`; CN continuity rule (Part A AD-07, UNVERIFIED) yields Raka's 76 days as NEEDS_VERIFICATION.
- SC-16 Travel (P1): territory/date/exclusion check from owned policy fields only.

## B8. Joshua feature plans

- SC-08 Emergency: KB-driven contacts only, shared `services/safety_screen.py` replaces the three triage engines; remove hardcoded fallback numbers marked verified.
- SC-09 Claims: fix multipart upload; show KB evidence items as "Insurer requirement unverified" instead of hiding them (Part A T2.0 made them disappear); idempotent creation; pathway origin.
- US-09-05 Follow-up: worker drives sandbox status and follow-up tasks; messages are drafts needing approval.
- SC-10 Actions: split approve and execute; UI sends `payload_version`; reusable Action Review drawer at `/actions?action=<id>`; new manual-handoff action types; port legacy ICS/mailto/PDF executors with "not sent" receipts.
- SC-11 Audit: read model over the three audit tables, owner-filtered; seeded rows labeled synthetic.
- SC-15 Employer (P1), SC-17 Compare (P1), SC-19 Proof (Bonus): see B13.

## B9. New PBI plans

- US-05-04 event orchestration (P0): B6 above.
- US-10-05 renewal and anti-lapse (P0): deterministic planner creates POLICY_EXPIRY reminders at 60/30/7 days (offsets configurable, timezone from profile); insight `coverage_expiring`; `renewal_inquiry` action draft. No auto-renewal, no premium quotes.
- US-10-06 policy servicing (P1): `policy_servicing_request` drafts (address change, beneficiary, document copy) as manual handoff.
- US-03-05 auto-discovery (P1, Regina): policy candidates from uploaded documents; never owned coverage until user confirms.

## B10. Regina integration

`docs/INTEGRATION_CONTRACTS.md` Section 2. Part B consumes profile, consent, coverages, documents and notifications from Part A; it does not change account auth or onboarding.

## B11. Raka demo plan

`docs/DEMO_ACCEPTANCE_PLAN.md` Journeys A, B, C. Requires Part A T2.3 fixture move and B6.1 claims seed alignment (seed policy end 2027-08-31 must become 2027-04-15).

## B12. Sinta demo plan

`docs/DEMO_ACCEPTANCE_PLAN.md` Section 5. JKN and employer cards separate; coordination UNKNOWN; employer benefit inquiry draft.

## B13. Data and source verification plan

- Every exposed fact carries provenance (origin, evidence_ref, verification_status).
- Products default UNVERIFIED; remove "verified" badges from SC-17 until retrieval artifacts exist.
- SC-19 relabeled LOCAL_INTEGRITY_RECEIPT: sha256 over the receipt, no tx hash, block, contract or explorer link. A real testnet anchor needs credentials and approval (B-HUMAN-3).
- Emergency numbers and red flags stay KB-only and need human sign-off (B-HUMAN-4).

## B14. Database changes

Proposed additive migration `0014_agent_orchestration` (after Part A `0013`):
- `wf_agent_events`: `dedupe_key` (unique per owner), `status`, `attempts`, `next_attempt_at`, `processed_at`, `error_code`, `schema_version`.
- New `protection_insights` (XOR owner columns, kind, severity, status, input_fingerprint, facts JSON, timestamps; unique owner+kind+subject).
- `clause_chunks.language` nullable.
- `chat_sessions.workflow_state` JSON nullable.
- `wf_reminders`: `fire_at`, `cancelled_at`, `dedupe_key` if absent.
- `wf_claim_cases`: `origin`, `origin_ref` nullable.
No drops, no rewrites of released revisions, SQLite and PostgreSQL portable. Upgrade test from 0013 with existing rows.

## B15. API changes

`docs/INTEGRATION_CONTRACTS.md` Sections 3 and 4. New: `/insights`, `/insights/{id}/decision`, `/ask/proposals/{id}/prepare`, `/workflow/reminders`, `/travel/checks` (P1). Extended additively: `/home/summary`, `/ask`, `/coverage-needs`, `/workflow/claims`, `/workflow/actions`. All workflow routes declare response models so generated types replace hand-written frontend types. Router tag "Joshua Workflow" renamed to a responsibility name.

## B16. Frontend changes

Typed workflow client from `types.gen.ts`; remove consent auto-grant (`claims/[id]/page.tsx:208`, `actions/page.tsx:148`) in favor of an explicit consent prompt; Action Review drawer; Home rewired; sidebar stays at the 8 items (Part A owns the shell). English copy, no em dashes, existing tokens.

## B17. Security and privacy controls

Actor XOR, owner scoping before every lookup, consent rechecked per call and at execute time, no raw values in logs or audit metadata, document text treated as untrusted, rate limits on Ask and action preparation, destination allow-list for drafts.

## B18. Testing strategy

Per task in TASKS.md. Required new suites: `test_safety_screen.py`, `test_triage_adapter.py`, `test_agent_events.py` (outbox, retry, dedupe, owner purge), `test_agent_insights.py`, `test_intervals.py`, `test_policy_qa_cross_language.py`, `test_actions_types.py`, `test_renewal.py`, migration upgrade for 0014. Playwright specs listed in DEMO_ACCEPTANCE_PLAN Section 7.

## B19. Implementation phases

B0 baseline after Part A lands; B1 shared contracts, safety screen, outbox (plus immediate trust fixes); B2 Valen P0; B3 Joshua P0; B4 events, insights, notifications; B5 renewal; B6 demo E2E; B7 P1; B8 bonus proof; B9 final verification.

## B20. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Concurrent Part A session edits the same files | Start B1 code only after Part A Phase 2 lands; small PR-sized tasks |
| Duplicate claim and action systems | Workflow canonical; legacy frozen then retired with no table drops (B-HUMAN-1, B-HUMAN-2) |
| Worker in-process loses jobs on restart | Outbox rows persist; `process_due` resumes |
| Unverified KB drives user-facing guidance | Labels everywhere; fail closed for triage; human sign-off |
| LLM misuse | No consequential tools exposed; structured output; deterministic numbers |
| Stale E2E specs mask regressions | B0.3 updates specs before feature work |

## B21. Definition of Done

Every P0 acceptance criterion in TASKS.md Part B checked with a passing test; `make test`, `make check`, `make check-contracts`, `make test-client` green; desktop and mobile `npm run test:e2e` green for demo specs; `docs/prd/VALEN_TRACEABILITY.md` updated; no fabricated data on any screen.

## B22. Rollback strategy

Feature flags: `AGENT_WORKER_ENABLED`, `INSIGHTS_ENABLED`. Migration 0014 is additive; downgrade drops only new columns and the new table. Legacy routes stay until B-HUMAN-1 approval. Each task is a separate Conventional Commit and can be reverted alone.
