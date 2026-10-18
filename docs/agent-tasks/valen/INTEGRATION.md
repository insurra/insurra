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
