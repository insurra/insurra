# Valen P0 integration decisions

Inspected baseline: `3fa80ce`; origin/master refreshed on 18 October 2026. Clean working tree before creating `feat/valen-p0-command-policy-pathways`. The user explicitly authorizes the four P0 product surfaces despite older foundation-only guidance. Existing Rere/Joshua routes and migrations remain intact.

## Milestones and dependencies

| Stories | Implementation | Existing integration |
| --- | --- | --- |
| US-05-01..03 | Home counts, context, recommendations, emergency fallback | AccountProfileRow/AccountCoverageRow/AccountFieldRow, demo record, zoneinfo, versioned KB |
| US-14-01..02 | Contextual needs/ownership and shared visa gaps | Same coverage adapter; RulesEngine and SC-04 dates; no second interval formula |
| US-06-01..04 | Scoped retrieval, deterministic money, citation policy, guarded SSE | Existing bearer/demo authentication, current consent tables, account pages/fields, GeminiGateway; triage seam |
| US-07-01..03 | KB-driven forms/cards, uncertainties/costs | Same coverage/benefit adapter; verified triage; no diagnosis or unsourced costs |
| US-07-04 | Idempotent DRAFT case creation only | Existing demo claim_cases; additive account ownership; Joshua claim/action interfaces preserved |
| US-16-01..03 | Gated P1 | Must not start while P0 acceptance dependencies are blocked |

## Baseline findings

- 145 backend tests pass; one existing test fails: test_openapi_snapshot_matches_python_contract. Generated API artifacts are stale relative to current account endpoints; regenerate from Python, retaining these endpoints.
- Canonical Valen operations currently return demo-session-only 501. Rere's account endpoints are under /api/v1/account and use opaque bearer sessions. New canonical Valen routes must resolve either authenticated accounts or demo sessions, rejecting ambiguous credentials.
- No account benefits, chunks, claim cases, chat/rate-limit or recommendation-dismissal tables exist. Demo claim_cases already exists and must be extended, not duplicated. Reuse AccountFieldRow rather than extracting benefits again.
- Account document ingestion stores pages even when original-file retention is off; revocation removes original bytes only. Valen will not persist or consume derived raw content without approved retained material. Content-free chunk offsets/hashes can point into retained pages. Revocation/deletion must invalidate those references/history; never resurrect them on regrant. This is a narrow integration hook, not a rewrite of ingestion.
- The earlier AU/ID baseline added source-backed red-flag drafts and candidate emergency numbers as `UNVERIFIED`. On the current CN/ID target, AU remains inactive and its candidates are not exposed; ID's new unverified rules are skipped while existing reviewed ID rules remain active. `POST /triage` is still 501. See [TRIAGE_REVIEW.md](TRIAGE_REVIEW.md) for the sources and maintainer checklist; do not activate new drafts before approval.
- Pathway sources, tariffs, steps and verification steps are absent/unverified. Null estimates and visible missing-source states are required until authentic data is available. No synthetic cost may be presented as a real tariff.
- Existing Raka fixtures are explicitly metadata placeholders, not clauses. Do not relabel them as dental exclusion evidence. New policy-clause tests must use separately identified fictional policy fixtures.
- All 16 Valen stories/85 criteria from the provided brief match local Requirement CSV. Local CSVs and existing migration bytes are hashed externally for preservation checks.

## Compatibility

Pydantic remains the domain authority. Extend HomeSummary/AskRequest/AskAnswer/PathwayComparison/CoverageNeed additively, preserving required PRD fields. Only Valen canonical operations become live; no parallel auth or /api layer. Existing demo dashboards and account workspaces stay reachable. No claim submission, checklist generation, emergency-screen implementation or action execution belongs in this change.

Where a 501 route is now implemented, update its old stub-specific expectation to the exact new behavior and add security/domain regressions. Keep every existing test; never relax a security assertion or claim an unavailable dependency passed.

## Policy Q&A implementation boundary

Canonical `/api/v1/ask` now supports bearer accounts and demo sessions, JSON or named SSE (`progress`, `answer_point`, `complete`, `redirect`, `error`, with comment heartbeats). Additive fields carry conversation IDs, context country, deterministic numeric facts and verification steps. Source/history/feedback helpers live beneath `/ask`; none provides authentication or bypasses ownership. The existing `/chat/ask` stub remains unchanged.

Every proposed point is revalidated against owned retained page text. Numeric facts are recomputed from existing fields and separated by policy; unverified/corrected field provenance lowers certainty. No embeddings are required: a bounded ID/EN lexical reader returns at most five excerpts. A failed/no-match response does not become a coverage denial. The earlier pre-master baseline locked chat because no reviewed red-flag resource was available. The current target preserves reviewed CN and ID rules; missing or resource-level unverified safety data still returns `TRIAGE_UNAVAILABLE` before any provider call. Provider calls use Google's Chat Completions compatibility endpoint with Pydantic structured parsing, bounded transport timeout, SDK retries disabled and at most one structured-output retry. CI uses in-memory provider and triage fixtures only.

Raw pages are only retained with retention consent. Source/history access rechecks current grants; document deletion or purpose revocation clears derived chunks/history. Account source pages receive stable page anchors so existing document views can open the exact cited page. Frontend-only production deployments without NEXT_PUBLIC_API_BASE_URL show BACKEND_NOT_CONFIGURED and never silently call localhost.

Explicit live checks, never CI: `cd backend && uv run python ../scripts/check_live_ai.py --live` sends one synthetic schema request. `INSURRA_LIVE_GEMINI=1 uv run pytest app/tests/test_live_gemini_workflow.py -q` sends a synthetic PDF through upload, extraction and streamed Q&A using an isolated database and test-only triage fixture. Neither check promotes the fixture to production KB data or validates real insurance policy accuracy.

Remaining source dependency: versioned policy templates allow extraction of provider and coverage dates only; candidates stay `UNVERIFIED` until account owners review them. Valen's normalized benefit/date reader can only use coverage-linked reviewed fields already supplied by Rere's interface. It never fills missing fields or associates country-free manual values with arbitrary policies. Missing data remains visible and blocks ownership/cost certainty. Original Raka/Sinta files remain metadata placeholders, not dental policy evidence.

## Care comparison boundary

`POST /api/v1/pathways/compare` consumes current processing consent and the same reviewed triage seam, with no model call. It accepts the existing complaint/service/city contract plus an optional timeframe. Symptoms are neither persisted in comparisons nor audit. Two or three configured procedure cards retain null costs whenever reference prices, current-period benefit amounts, currency, excess/rate, network, referral or claim mode cannot be established. Cost calculations use Decimal and no conversion; the priority badge requires comparable sourced estimates. Synthetic tariffs are refused for authenticated accounts.

The response includes a short-lived owned comparison proof bound to current profile, policy fields and KB. Case creation uses that proof without retaining complaint text. Uncertainties and questions come from country verification configuration and are capped at five. Reminder creation remains visibly unavailable while SC-10 is absent. Reviewed descriptive pathway sources are recorded in KB_SOURCES.md; unchecked sources never receive invented dates or payment assurances.

## DRAFT case creation

Canonical `POST /api/v1/claims` now creates real account/demo-owned rows in the existing claim_cases table. The optional contract field `comparison_id` and `Idempotency-Key` header are required by the implemented creation service after coverage ownership checks. A comparison expires after 15 minutes and is bound to the current profile, policy fields and KB. A changed choice with the same key or comparison is a 409 conflict; identical retries return the same case ID. Database uniqueness protects simultaneous confirmations, and the audit event commits with the case.

Only a generic masked complaint summary is stored, never the original symptoms. The confirmation dialog shows documents, direct-billing caveats and the SC-09 limitation. Cancellation sends no POST; retries reuse the key. Emergency options never create cases. The real created ID is shown with an honest unavailable-checklist message because SC-09 is absent. No claim readiness, action queue, submission or execution was implemented. Existing GET claim/detail/evidence/draft contracts and Joshua's ownership boundaries remain unchanged.


## Resume integration review

Canonical policy vocabulary references and original-country display labels were corrected in 467e23f. The responsibility-based naming refactor is b924568: workspace_state models, workspace schemas/API/UI components, domain test names and unchanged table DDL. Current shared master remains 3fa80ce with AU/ID only; no CN content was merged or substituted. Full verification, the baseline demo consent navigation issue, and all acceptance blockers are recorded in VERIFICATION.md and VALEN_TRACEABILITY.md.

## Target-master integration update — 20 October 2026

The target advanced to `16d3472` and now sets `ACTIVE_KB_COUNTRIES=CN,ID`; the AU/ID-only statements above describe the earlier baseline. The maintainer confirmed keeping the target's CN/ID scope. This integration keeps the runtime allowlist unchanged, leaves AU Healthdirect rules and `000` inactive/unverified, and preserves the current master CN rules and ID emergency directory. Four additional ID rules from the 2019 Kemenkes call-center guideline remain per-rule `UNVERIFIED` and are skipped by strict screening until approved. Existing reviewed ID rules remain active. See [TRIAGE_REVIEW.md](TRIAGE_REVIEW.md).

The current master already contains Joshua's triage/safety screen and emergency contact implementation. This branch integrates Gemini behind those existing consent, source, and country-safety gates; test-only triage remains limited to synthetic live tests. Rere's account authentication and upload interfaces are also present in the target. Production still requires approval of the ID draft rules, host/database setup, migrations, exact CORS/frontend URLs, server-side Gemini credentials, and Google OAuth credentials/callback if account login is enabled.
