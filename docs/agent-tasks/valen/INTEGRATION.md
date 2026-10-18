# Valen P0 integration decisions

Inspected baseline: `3fa80ce`; origin/master refreshed on 18 October 2026. Clean working tree before creating `feat/valen-p0-command-policy-pathways`. The user explicitly authorizes the four P0 product surfaces despite older foundation-only guidance. Existing Rere/Joshua routes and migrations remain intact.

## Milestones and dependencies

| Stories | Implementation | Existing integration |
| --- | --- | --- |
| US-05-01..03 | Home counts, context, recommendations, emergency fallback | AccountProfileRow/AccountCoverageRow/AccountFieldRow, demo record, zoneinfo, versioned KB |
| US-14-01..02 | Contextual needs/ownership and shared visa gaps | Same coverage adapter; RulesEngine and SC-04 dates; no second interval formula |
| US-06-01..04 | Scoped retrieval, deterministic money, citation policy, guarded SSE | Existing bearer/demo authentication, current consent tables, account pages/fields, ResponsesGateway; triage seam |
| US-07-01..03 | KB-driven forms/cards, uncertainties/costs | Same coverage/benefit adapter; verified triage; no diagnosis or unsourced costs |
| US-07-04 | Idempotent DRAFT case creation only | Existing demo claim_cases; additive account ownership; Joshua claim/action interfaces preserved |
| US-16-01..03 | Gated P1 | Must not start while P0 acceptance dependencies are blocked |

## Baseline findings

- 145 backend tests pass; one existing test fails: test_openapi_snapshot_matches_python_contract. Generated API artifacts are stale relative to current account endpoints; regenerate from Python, retaining these endpoints.
- Canonical Valen operations currently return demo-session-only 501. Rere's account endpoints are under /api/v1/account and use opaque bearer sessions. New canonical Valen routes must resolve either authenticated accounts or demo sessions, rejecting ambiguous credentials.
- No account benefits, chunks, claim cases, chat/rate-limit or recommendation-dismissal tables exist. Demo claim_cases already exists and must be extended, not duplicated. Reuse AccountFieldRow rather than extracting benefits again.
- Account document ingestion stores pages even when original-file retention is off; revocation removes original bytes only. Valen will not persist or consume derived raw content without approved retained material. Content-free chunk offsets/hashes can point into retained pages. Revocation/deletion must invalidate those references/history; never resurrect them on regrant. This is a narrow integration hook, not a rewrite of ingestion.
- red_flags is empty/UNVERIFIED and emergency phone numbers are null/UNVERIFIED. POST /triage is 501. SC-08 /emergency, SC-10 /actions and SC-09 /claims/[id] do not exist. Valen must fail closed before Q&A/care, expose an honest fallback and test integration with explicitly synthetic reviewed fixtures. Do not activate guessed medical data or emergency numbers.
- Pathway sources, tariffs, steps and verification steps are absent/unverified. Null estimates and visible missing-source states are required until authentic data is available. No synthetic cost may be presented as a real tariff.
- Existing Raka fixtures are explicitly metadata placeholders, not clauses. Do not relabel them as dental exclusion evidence. New policy-clause tests must use separately identified fictional policy fixtures.
- All 16 Valen stories/85 criteria from the provided brief match local Requirement CSV. Local CSVs and existing migration bytes are hashed externally for preservation checks.

## Compatibility

Pydantic remains the domain authority. Extend HomeSummary/AskRequest/AskAnswer/PathwayComparison/CoverageNeed additively, preserving required PRD fields. Only Valen canonical operations become live; no parallel auth or /api layer. Existing demo dashboards and account workspaces stay reachable. No claim submission, checklist generation, emergency-screen implementation or action execution belongs in this change.

Where a 501 route is now implemented, update its old stub-specific expectation to the exact new behavior and add security/domain regressions. Keep every existing test; never relax a security assertion or claim an unavailable dependency passed.

## Policy Q&A implementation boundary

Canonical `/api/v1/ask` now supports bearer accounts and demo sessions, JSON or named SSE (`progress`, `answer_point`, `complete`, `redirect`, `error`, with comment heartbeats). Additive fields carry conversation IDs, context country, deterministic numeric facts and verification steps. Source/history/feedback helpers live beneath `/ask`; none provides authentication or bypasses ownership. The existing `/chat/ask` stub remains unchanged.

Every proposed point is revalidated against owned retained page text. Numeric facts are recomputed from existing fields and separated by policy; unverified/corrected field provenance lowers certainty. No embeddings are required: a bounded ID/EN lexical reader returns at most five excerpts. A failed/no-match response does not become a coverage denial. Current reviewed red-flag content is unavailable, so the live chat is locked and its API returns TRIAGE_UNAVAILABLE before any provider call. Provider calls use the existing configured gateway, store=false, bounded transport timeout, SDK retries disabled and at most one structured-output retry. CI uses in-memory provider and triage fixtures only.

Raw pages are only retained with retention consent. Source/history access rechecks current grants; document deletion or purpose revocation clears derived chunks/history. Account source pages receive stable page anchors so existing document views can open the exact cited page. Frontend-only production deployments without NEXT_PUBLIC_API_BASE_URL show BACKEND_NOT_CONFIGURED and never silently call localhost.

Explicit optional connectivity check (one provider call, never CI): `cd backend && ../.tools/bin/uv run python ../scripts/check_live_ai.py --live`. It uses server OPENAI_API_KEY/OPENAI_MODEL and sends a synthetic schema check only. It is not a test of real insurance answers, source adequacy or a hosted deployment. Not run during this implementation.

Remaining source dependency: the shipped extraction templates are empty. Valen's normalized benefit/date reader can only use coverage-linked reviewed fields already supplied by Rere's interface. It never fills missing fields or associates country-free manual values with arbitrary policies. Missing data remains visible and blocks ownership/cost certainty. Original Raka/Sinta files remain metadata placeholders, not dental policy evidence.
