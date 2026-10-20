# P0 implementation verification — 19 October 2026

Branch: feat/valen-p0-command-policy-pathways. Started from clean, refreshed master 3fa80ce. Resume fetch still resolves origin/master to 3fa80ce; its KB has AU and ID only, no CN changes. No merge, push, deployment or Travel implementation was performed.

P0 is **not acceptance-complete**: 41 criteria PASSED, 27 PARTIAL, 5 BLOCKED. All 85 verbatim criteria, including 12 gated P1 criteria, have individual results in [VALEN_TRACEABILITY.md](../../prd/VALEN_TRACEABILITY.md). Synthetic dependency fixtures establish code behavior, never real medical, regulatory, policy or tariff facts.

## Completed implementation

- SC-05: account/demo context, original-country labels, inclusive local-date counts, configured top-three recommendations, seven-day dismissals, non-dismissable visa warnings and an above-fold safe emergency fallback.
- SC-06: owned retained-page retrieval (top five), exact source validation, structured gateway output with one retry, deterministic financial facts, 20/hour persistent limit, ten-turn history, JSON/SSE, source drawer, cancellation/retry and feedback. Live processing fails closed before AI because reviewed triage is unavailable.
- SC-07: KB service choices/procedures, scoped active coverage matches, conservative null costs, sourced Decimal estimate rules, max-five verification questions/copy, confirmed idempotent owned DRAFT case creation and masked audit. Unavailable SC-09/10 are explicit states.
- SC-14: contextual requirements/recommendations, verified-source boundary, reviewed active ownership, unknown/not-found distinction and the same visa interval calculation used by SC-04.
- Resume fixes: canonical PERSONAL_HEALTH/EMPLOYER references, country labels, KB reference validation, ID source currency, empty-state and 375px browser coverage.
- Responsibility names replace developer-based code organization: models/workspace_state.py, schemas/workspace.py, api/v1/workspace.py, components/workspace and domain-named tests/fixtures. Existing ClaimCaseRow and account-field benefit authority remain single definitions. All 27 table DDL definitions, constraints and owner relationships are identical across the naming refactor; no unnecessary model split.

## Verification performed

| Command/check | Result |
| --- | --- |
| Locked setup before implementation: npm_config_cache=/private/tmp/insurra-npm-cache make setup | Passed; lockfiles unchanged. Not repeated on resume. |
| Focused domain tests after rename | 116 passed. |
| make test after model/import refactor | 262 passed. Includes account/demo, scope/consent, source/AI fixtures, concurrent case creation and fresh/populated migration regressions. |
| make check | Ruff check/format, ESLint, strict TypeScript and production build passed. |
| make generate-types; make check-contracts | Passed. Naming refactor changes five OpenAPI tags to Workspace; generated TS shape unchanged by rename. |
| make check-prd-source | All 21 operations matched immutable local API CSV. |
| make test-client | 11 passed, including SSE framing/error/cancel tests. |
| Full production browser suite before naming refactor | 22 workspace cases passed; four unchanged legacy demo cases failed on removed selector. No tests skipped or assertions removed. |
| Focused production browser suite after rename/readiness correction | 22 passed (desktop/mobile); fresh configured production servers. |
| Fresh temporary database: make migrate; make seed; make seed | Head 0008; inserts 2 then 0; no foreign-key violations. |
| SQLAlchemy metadata before/after rename | Same 27 SQLite/PostgreSQL table DDL definitions; no duplicate registrations. |
| actionlint .github/workflows/foundation-ci.yml | Passed; workflow untouched, uv caching remains disabled in both jobs. |
| Preservation | All five original PRD CSV hashes and released migrations 0001–0007 match preflight. Original fixtures, both lockfiles, legacy browser tests and framework-generated AGENTS block preserved. |

Browser command: `cd frontend && CI=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/insurra-browsers npm run test:e2e`. Focused command adds `-- tests/workspace.spec.ts`. The renamed spec remains registered alongside demo.spec.ts. API/source ownership and account login use the real local backend; provider/triage-dependent UI branches use explicit synthetic mocks. A test helper now waits for restored account/home state before initiating another full-page navigation; assertions/timeouts are not relaxed.

A reused production build without NEXT_PUBLIC_API_BASE_URL correctly refused API calls. Verification was rerun using fresh servers configured by Playwright. One subsequent browser attempt exposed a fixture navigation race (aborted auth restoration), fixed by waiting for the actual home heading, without changing account authentication behavior.

## Legacy Playwright investigation

Both legacy tests, on desktop and mobile, stop at getByRole(button, name=Mulai demo Raka), lines 9 and 98 of demo.spec.ts. The current baseline landing uses Check Demo → Next → Next → Explore Live Dashboard and opens /dashboard directly. Dashboard and consent copy are now English. Landing/onboarding/dashboard and these old tests have no diff from baseline 3fa80ce. Updating selectors alone would not validate the old consent journey.

A real-browser probe of the current wizard confirmed Raka launch, the original 76-day potential gap, Sinta launch/NOT_APPLICABLE and distinct persona sessions. It also confirmed a separate **existing consent navigation regression**: with demo process_documents granted, /onboarding renders AccountOnboarding, and the Revoke Consent control count is zero. The routing condition includes data.consent.processing_consent and bypasses the demo revoke branch. This requires coordination with the existing onboarding/privacy implementation; no teammate screen was rewritten to hide a failing test. The four legacy tests are preserved.

## Remaining coordination and limits

1. Shared reviewed red_flags/emergency resources and SC-08: AU/ID now contain source-backed drafts and `000`/`119` candidates, all UNVERIFIED and hidden. Zero-AI fail-closed behavior is tested; real number/redirect acceptance is blocked pending review.
2. SC-09 detail/checklist, SC-10 reminders/actions and account SC-11 audit presentation: case rows/events are real, but these downstream workflows remain unavailable. No fake reminder, claim readiness or submission was added.
3. Existing ingestion/review must supply coverage-linked normalized benefit/date fields and retained exact source pages. Extraction templates only allow UNVERIFIED provider/date candidates; task matrices are empty. Original Raka/Sinta placeholders are not policy clauses. Reviewed field provenance cannot be manufactured.
4. GP/employer sources, worker requirements and reference tariffs remain unverified/missing. Only narrow UCC/JKN descriptive sources were checked. Numeric costs stay null until all source/eligibility inputs are valid.
5. Legacy demo consent routing/test expectations require the decision described above. Current persona launch itself works.
6. No CN changes were found on shared master. Future CN content must supply the complete sixteen-resource envelope set, canonical vocabulary, timezones and reviewed sources. Existing AU student/visa logic and account onboarding AU/ID presets cannot be relabeled to establish CN support. Review that snapshot before integrating; no merge was attempted.

At this 19 October checkpoint, no live provider call, hosted CI, PostgreSQL migration or deployment had been run. PostgreSQL DDL compilation is not a live database check. The later synthetic Gemini calls are recorded below and do not establish real-policy accuracy. Starlette/httpx emits its existing deprecation warning.

The remaining work depends on reviewed shared content and teammate interfaces. Allow roughly 2–4 hours for connecting supplied compatible dependencies and rerunning affected acceptance checks; creating/reviewing those dependencies has a separate, team-dependent schedule. Travel remains gated.

## Gemini resume verification — 20 October 2026

Current worktree branch: `feat/gemini-e2e-smoke`. The inherited Gemini migration and local changes were preserved.

- The live configured model `gemini-3.5-flash-lite` returned valid structured output for the synthetic connectivity check. The former checked-in default `gemini-3.8-flash` returned a masked `AI_UNAVAILABLE`; settings and `.env.example` now default to the working configured model.
- Limited versioned extraction templates now permit provider and coverage dates for policy booklets and insurance cards (plus AU OSHC certificates). These candidates remain `UNVERIFIED`; no policy benefit, eligibility, or regulatory facts were added.
- OCR selects installed `eng`/`ind` language packs and falls back to installed `eng`. Poppler was installed locally so the synthetic PDF test could exercise the real PDF parser.
- `INSURRA_LIVE_GEMINI=1 uv run pytest app/tests/test_live_gemini_workflow.py -q`: **1 passed** using two real Gemini calls. In a temporary migrated database it exercised an authenticated account, all three grants, synthetic PDF upload, persisted extraction candidates/pages, streamed Q&A with a validated page 1 citation, and an unsupported question that returned `no_match` without a third provider call. This test uses a test-only triage fixture and does not change shipped KB data.
- `INSURRA_LIVE_GEMINI=1 npm run test:e2e -- --config=playwright.live-gemini.config.ts`: **1 passed**. The browser logged in, granted the three separate purposes, uploaded the synthetic PDF through the real UI, received Gemini extraction and Q&A, opened a validated page 1 citation, then displayed `no_match` for an unsupported coverage question. The live browser test made two provider calls; its temporary SQLite database is unique per run.
- The browser run exposed and fixed `/api/v1/account/setup/{country_code}` returning 500 because `AccountSetup` modeled KB `aliases` arrays as strings. The response now reuses the versioned KB vocabulary/document/task models, and an AU/ID regression test covers the list shape. Generated OpenAPI and TypeScript types were regenerated.
- `uv run python ../scripts/check_live_ai.py --live`: **passed**, one synthetic structured response, zero answer points.
- Earlier `make test`: **284 passed, 1 skipped**. The current integration run is **290 passed, 1 skipped** (the live test is opt-in by default). `make test-client`: **11 passed**. Current `make generate-types`, `make check-contracts` (21 PRD operations), and `make check` including the production frontend build: **passed**.
- SC-06 Playwright subset on isolated test services: **4 desktop + 4 mobile passed**. Auth, owned source pages and page anchors use the real local backend; the browser answer stream uses the existing explicit synthetic provider mock.

Reproduce the live API checks from `backend/` with `GEMINI_API_KEY` configured in the root `.env`. Reproduce the SC-06 browser checks from `frontend/` with `npx playwright install chromium`; use the exact commands in the README to run on isolated ports 8001/3001 when the normal dev servers occupy 8000/3000.

Production Q&A and care remain blocked by the shipped AU/ID red-flag resources being unverified. The API and frontend correctly fail closed with `TRIAGE_UNAVAILABLE`; no real provider-backed answer was run through the shipped KB. The live backend test proves extraction/retrieval/citation behavior behind an explicitly test-only triage seam, not production medical safety or real-policy accuracy. No deployment, push, or merge was performed.

## Triage review preparation — 20 October 2026

Added source-backed AU/ID red-flag drafts and emergency-number candidates in the existing KB schema. Resource envelopes and nested emergency metadata remain `UNVERIFIED`; the source check date is not approval. Country resources advanced from `0.3.0` to `0.3.1`. `triage_check` still rejects both countries before any Gemini call, and command-center output still hides the candidate numbers. Exact references, draft rules, schema limits and maintainer decisions are listed in [TRIAGE_REVIEW.md](TRIAGE_REVIEW.md).

`cd backend && uv run pytest app/tests/test_triage_adapter.py app/tests/test_policy_qa.py app/tests/test_command_center.py::test_home_is_live_for_accounts_and_preserves_original_countries -q`: **53 passed**. Coverage includes explicitly reviewed synthetic rules, populated-but-unverified production drafts, empty red-flag resources, emergency redirection before AI, and hidden unverified emergency numbers. The earlier real Gemini API/browser results above remain preserved and were not rerun for this content-only milestone.

## Target-master integration update — 20 October 2026

Target master advanced to `16d3472` with active country scope CN/ID and an existing reviewed safety screen. The maintainer confirmed retaining that scope. This merge preserves CN safety data and existing ID emergency contacts; AU remains inactive. Four new ID rules from the Kemenkes 2019 guideline are individually `UNVERIFIED` and are skipped until reviewed; existing verified ID rules remain active. Focused tests cover reviewed CN emergency escalation, unverified ID rules, missing resources, invalid sources/destinations, and AU's inactive draft. The pre-merge GitHub `checks` job passed; `browser-smoke` failed with 11 assertions against stale branch selectors and the prior account helper. The target-master Playwright configuration and helper are retained, and the browser suite will be rerun after merge resolution.
