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

1. Shared reviewed red_flags/emergency resources and SC-08: currently empty/unverified/null. Zero-AI fail-closed behavior is tested; real number/redirect acceptance is blocked.
2. SC-09 detail/checklist, SC-10 reminders/actions and account SC-11 audit presentation: case rows/events are real, but these downstream workflows remain unavailable. No fake reminder, claim readiness or submission was added.
3. Existing ingestion/review must supply coverage-linked normalized benefit/date fields and retained exact source pages. Extraction templates/task matrices are empty; original Raka/Sinta placeholders are not policy clauses. Reviewed field provenance cannot be manufactured.
4. GP/employer sources, worker requirements and reference tariffs remain unverified/missing. Only narrow UCC/JKN descriptive sources were checked. Numeric costs stay null until all source/eligibility inputs are valid.
5. Legacy demo consent routing/test expectations require the decision described above. Current persona launch itself works.
6. No CN changes were found on shared master. Future CN content must supply the complete sixteen-resource envelope set, canonical vocabulary, timezones and reviewed sources. Existing AU student/visa logic and account onboarding AU/ID presets cannot be relabeled to establish CN support. Review that snapshot before integrating; no merge was attempted.

No live OpenAI call, real provider integration, hosted CI, PostgreSQL migration or deployment was run. PostgreSQL DDL compilation is not a live database check. The opt-in synthetic provider connectivity script is documented in INTEGRATION.md and never runs in CI. Starlette/httpx emits its existing deprecation warning.

The remaining work depends on reviewed shared content and teammate interfaces. Allow roughly 2–4 hours for connecting supplied compatible dependencies and rerunning affected acceptance checks; creating/reviewing those dependencies has a separate, team-dependent schedule. Travel remains gated.
