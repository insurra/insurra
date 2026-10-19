# Feature Gap Analysis: Valen, Joshua and Agentic PBIs

Audit date: 2026-10-19. Branch `feat/figma-redesign-my-protection-screens`, head `85c3bbd`, with a large uncommitted working tree from the parallel Account/Demo plan (see [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) Part A). Method: code reading of frontend page, client, FastAPI route, service, KB and model for each screen, plus targeted test runs. Read-only KB loads were used to confirm triage availability. No production code was changed during this audit.

Companion documents: [AGENTIC_AI_ARCHITECTURE.md](AGENTIC_AI_ARCHITECTURE.md), [INTEGRATION_CONTRACTS.md](INTEGRATION_CONTRACTS.md), [DEMO_ACCEPTANCE_PLAN.md](DEMO_ACCEPTANCE_PLAN.md).

## 0. Classification vocabulary

| Label | Meaning |
| --- | --- |
| VERIFIED WORKING | Code path reads real owned data, has passing tests, no fabricated output. |
| IMPLEMENTED BUT INCOMPLETE | Real backend logic exists, but required behavior is missing or not reachable from the UI. |
| OBSOLETE RULES | Depends on Australian OSHC, visa 8501, AUD, Melbourne or `visa_cover`. |
| STATIC OR HARDCODED | UI or service shows literals instead of backend data. |
| SANDBOX ONLY | Works only against the internal simulated sandbox. |
| SOURCE UNVERIFIED | Facts are developer-authored or registered but never retrieved. |
| PLACEHOLDER | Output imitates a capability that does not exist. |
| MISSING | No route, service or page. |
| BLOCKED BY DEPENDENCY | Correct code fails closed because an upstream input is unavailable. |

## 1. Prior "100% complete" claims versus evidence

| Screen | Prior claim | Audit verdict |
| --- | --- | --- |
| SC-05 Home | Complete | IMPLEMENTED BUT INCOMPLETE backend; STATIC OR HARDCODED frontend |
| SC-06 Ask | Complete | IMPLEMENTED BUT INCOMPLETE; BLOCKED BY DEPENDENCY (triage fails closed for every country) |
| SC-07 Care Pathways | Complete | IMPLEMENTED BUT INCOMPLETE; BLOCKED BY DEPENDENCY; CN PLACEHOLDER (no service types) |
| SC-14 Coverage Needs | Complete | Logic VERIFIED WORKING; content OBSOLETE RULES (AU only rule); CN/ID SOURCE UNVERIFIED |
| SC-16 Travel | Not started | MISSING (confirmed) |
| SC-08 Emergency | Complete | STATIC OR HARDCODED engine (ignores KB red flags); contacts partly KB-backed |
| SC-09 Claims | Complete | IMPLEMENTED BUT INCOMPLETE; UI evidence upload broken; SANDBOX ONLY |
| SC-10 Actions | Complete | Core hash-bound path VERIFIED WORKING (workflow); duplicate legacy system; UI collapses approve and execute |
| SC-11 Audit | Complete | IMPLEMENTED; real backend events mixed with seeded and on-read demo strings |
| SC-15 Employer | Read-only | STATIC OR HARDCODED coordination copy; SOURCE UNVERIFIED |
| SC-17 Compare | Read-only | SOURCE UNVERIFIED data presented as "Regulatory Verified" |
| SC-19 Proof | Hashing | Local hash VERIFIED; anchoring PLACEHOLDER (fabricated Sepolia tx hash); no page |

The 20-question-per-hour limit, SHA-256 canonical payloads, internal sandbox execution, Pydantic to OpenAPI to TypeScript generation, and backend audit writes are real. "Source-grounded answers" are real at the substring level only (no entailment). "Registered official data sources" are registered, not retrieved. "Prompt injection filters" are regex-only.

## 2. Screen matrix

### SC-05 Command Center (`/home`), Valen, P0

| Field | Finding |
| --- | --- |
| Existing behavior | `GET /api/v1/home/summary` (`api/v1/workspace.py:36`) and `POST /home/recommendations/decision` (`:41`). `services/command_center.py:83-235` selects up to 3 recommendations from KB `recommendation_rules`, visa gap via `coverage_matching.visa_assessment`. Dismiss persisted in `recommendation_states` for 7 days; visa items need confirmation (`:238`). |
| Evidence | `test_command_center.py` (7 tests, AU and ID fixtures, Melbourne at `:48`). |
| Missing | CN has 0 recommendation rules and no timezone or official hosts in manifest. No protection insight entity, no event refresh, no pending approvals or claims attention from backend, no agent activity feed, no context provenance per fact. |
| Obsolete assumptions | Recommendation language around visa obligations; AU fixtures in tests. |
| Frontend gaps | `frontend/src/app/home/page.tsx` (uncommitted redesign) hardcodes hero copy "Potential coverage gap detected" (`:150`), fallback date (`:90-107`), `openClaimsCount ?? 1` (`:95`), a fake pending action (`:99-101`), placeholder next steps (`:264-290`), fake activity with "2 hours ago" (`:322-376`), and emergency numbers `AU 000 / ID 119 / default 120` (`:111-121`, ID KB says 112). Ignores `needs_verification`, `expiring_30d`, `warnings`, `triage_available`. |
| AI capability | None required on Home. |
| Agentic capability | None. "Agent Workspace" only stores a prompt in sessionStorage and redirects to `/ask`. |
| Security gaps | Showing unsourced emergency numbers; fabricated counts. |
| Recommended change | Add persisted `protection_insights` produced by the deterministic insight engine and refreshed by events. Home summary gains `insights`, `attention` (claims needing evidence, pending approvals from `wf_actions`), `recent_activity` (from `wf_audit_logs`), `next_actions` (typed, linking to workflows). Replace every literal in `home/page.tsx` with API data or explicit "Not available". Emergency shortcut uses `GET /workflow/emergency/contacts` only. |
| Priority | P0 |

### SC-06 Ask INSURRA (`/ask`), Valen, P0

| Field | Finding |
| --- | --- |
| Existing behavior | `POST /api/v1/ask` JSON or SSE (`api/v1/policy_qa.py:41`), session read/delete/feedback, source page fetch. Rate limit 20/h in `ask_limits` (`policy_qa.py:70-106`). Retrieval is lexical `\w+` tokens with KB alias groups, top 5 clauses (`retrieval.py:40-128`). Citations must quote at least 15 characters that are a substring of an owned, retained, completed, non-injected page (`policy_qa.py:137-243`, `evidence.py:30-38`). Numbers in model text cause replacement by deterministic `financial_facts` (`:225`). Chat turns stored only with retention grant (`:432-458`). One structured `responses.parse` call, `store=False`. |
| Evidence | `test_policy_qa.py` (15 tests) using in-memory provider and an in-memory reviewed triage fixture that covers AU and ID only. |
| Blocked | `triage_adapter.py:28` requires `destination_code == "emergency"` but KB uses `medical` and `safety_support`; red-flag source host `who.int` is not in any manifest `official_source_hosts`; `phrases_zh` ignored (`:27`). Result: `TRIAGE_UNAVAILABLE` for every country in production; chat is locked. |
| Missing | Intent routing, tool selection, action proposals, approval handoff, workflow state across turns, entailment check, CJK tokenization, CN `retrieval_terms`, chunk language metadata, demo-session Mandarin policy document, English instructions (prompt and warnings are hardcoded Indonesian). |
| Obsolete assumptions | Fixture policy text in AUD (`workspace_fixtures.py:19`). |
| Frontend gaps | Emergency redirect shows an error instead of navigating to `/emergency` (`ask/page.tsx:156-162`). No context indicator, no tool progress, no action cards. Lint error `react-hooks/set-state-in-effect` (`ask/page.tsx:47`). `workspace.spec.ts` expects Indonesian strings. |
| AI capability | Grounded single-shot answer with substring citation validation. |
| Agentic capability | None. |
| Security gaps | Regex-only injection filter; KB `injection_patterns.json` loaded but unused in this path; number guard is post-hoc; citation laundering possible (true quote, unsupported conclusion). |
| Recommended change | Fix triage via the shared safety screen (Section 4). Add deterministic intent router plus LLM structured intent classification restricted to an enum, a typed tool registry, structured facts before narrative generation, a support-check step (quote must contain the claim's key terms and polarity), CJK bigram tokenizer, and `ActionProposal` cards that create `wf_actions` drafts only. Persist conversation workflow state (proposed action ids, pending step). |
| Priority | P0 |

### SC-07 Care Pathways (`/pathways`), Valen, P0

| Field | Finding |
| --- | --- |
| Existing behavior | `POST /api/v1/pathways/compare` (`workspace.py:53`), `care_pathways.compare()` (`:165-300`): triage, then 2 to 3 KB pathways, matches owned active coverage by country and kind, costs only from verified tariff plus fully found benefit fields in Decimal, otherwise null. Decision persisted in `pathway_decisions` with context fingerprint. `POST /api/v1/claims` creates an idempotent DRAFT in foundation `claim_cases` using a 15-minute comparison proof (`pathway_cases.py:42-129`). |
| Evidence | `test_care_pathways.py` (8), `test_pathway_cases.py` (5), AU and ID fixtures. |
| Blocked | Same triage failure as Ask. No tariffs in any KB. CN `pathways.json` has 0 service types and 0 steps, so CN requests fail. |
| Missing | CN public hospital, international clinic, emergency department options with conditional direct billing and fapiao guidance; ID JKN referral logic beyond KB text; link from emergency card to `/emergency` (`pathways/page.tsx:358-362`); insurer inquiry action; handoff of DRAFT case into Joshua's workflow claim system. |
| Obsolete assumptions | `kb/AU/pathways.json` OSHC GP and urgent care. |
| Agentic capability | Persisted decision and DRAFT case only. Case lands in foundation `claim_cases`, not in `wf_claim_cases` that Claims Center reads. |
| Recommended change | Shared safety screen; CN pathways content marked UNVERIFIED with explicit verification steps; pathway confirmation calls the workflow claim creation contract (Section 5 of INTEGRATION_CONTRACTS); "Prepare insurer inquiry" produces a `policy_clarification_inquiry` action draft. |
| Priority | P0 |

### SC-14 Coverage Needs (`/coverage-needs`), Valen, P0

| Field | Finding |
| --- | --- |
| Existing behavior | `GET /api/v1/coverage-needs`; `coverage_matching.match_needs()` (`:22-152`) with OWNED only for active verified coverage; REQUIRED downgraded without official source. `visa_assessment()` calls `RulesEngine.assess_visa_coverage(include_visa_rule=True)` (uncommitted change). |
| Evidence | `test_coverage_needs.py` (6) including the 76-day example. |
| Obsolete | Only rule is AU `student-insurance-interval-v1` (`visa_coverage`). `kb/AU/coverage_needs.json` marks OSHC REQUIRED and VERIFIED. Frontend heading "Mandatory / Visa Requirements" (`coverage-needs/page.tsx:91`). |
| Missing | CN/ID `coverage_continuity` rules (rules.json empty), the five result states as named in the PRD target (Have Coverage, Missing Evidence, Potential Gap, Needs Verification, Not Applicable), separation of applicability from evidence completeness in the response, agentic actions (request evidence, renewal inquiry, reminder, comparison). |
| Correctness risk | Two interval formulas: `RulesEngine` union (`rules_engine.py:127-149`) and `uncovered_interval()` (`:10-28`) used by SC-04 (`account_workspace.py:521,581`). They can disagree with multiple policies. |
| Recommended change | One interval function in `rules_engine.py`, used by SC-04, SC-14, Home insights and renewal reminders. Rename user-facing semantics to coverage continuity. Response adds `applicability` and `evidence_state` axes. |
| Priority | P0 |

### SC-16 Travel Planner (`/travel`), Valen, P1

MISSING: no route, service, page or table; only `travelDestination` in `lib/user-context.tsx:32`. Plan: P1, gated behind P0 acceptance (TASKS Phase B7). Territory and date checks against owned policy fields only; non-CN/ID destination requirements always `UNVERIFIED` with an official verification step.

### SC-08 Emergency Guidance (`/emergency`), Joshua, P0

| Field | Finding |
| --- | --- |
| Existing behavior | `GET /workflow/emergency/contacts`, `POST /workflow/emergency/triage` (`workflow/router.py:606,611`). Contacts read `kb/{CN,ID}/emergency.json` (CN 120/110/119, ID 112/119/110/113, source URLs, VERIFIED). |
| Hardcoded | Fallback contacts (`workflow/emergency.py:132-205`) add CN 122 and ID 115 marked `verified: True` without source; mental-health lines `010-82951332` and `119 ext 8` unsourced, rendered as non-dialable `tel:119 ext 8` (`emergency/page.tsx:205`). Red-flag patterns hardcoded (`emergency.py:10-122`); `kbdata.red_flags` has no callers. |
| Duplication | Three triage engines: workflow hardcoded (used by `/emergency`), KB-driven `POST /api/v1/triage` (`foundation.py:138`, tested by `test_emergency_guidance.py`), and `services/triage_adapter.py` (Valen, always fails closed). |
| Missing | Audit of guardrail triggers (privacy-safe, no symptom text); routing from Ask and Pathways; Home shortcut uses hardcoded numbers. Chinese phrase coverage is thin (one phrase each for chest pain and breathing). |
| Recommended change | One `services/safety_screen.py` (domain name) built from the KB-driven foundation implementation, consumed by all three surfaces; delete-in-place the hardcoded fallbacks (behind tests); unsourced lines shown as "Not available" with a generic "Call local emergency services" instruction. |
| Priority | P0 |

### SC-09 Claim Readiness and Tracking (`/claims`, `/claims/[id]`), Joshua, P0

| Field | Finding |
| --- | --- |
| Existing behavior | 31 workflow endpoints (`workflow/router.py:70-386`): overview, list, create, detail, patch, multipart evidence upload, evidence confirm, draft create/patch/confirm, send-to-approval, sync-status, acknowledge-check. Owner-scoped 404s. Checklist from VERIFIED KB `claim_evidence` only (`claims.py:167`); deterministic readiness (`:384-507`) and checks (`checks.py:63`: claimant, service date in policy, amounts, provider, currency, filing deadline, duplicate invoice). Deterministic draft (`claims.py:865`). Status machine `states.py:41`. |
| Evidence | `test_workflow.py` (8 tests, pass in isolation). `test_claim_cases_live.py` covers the legacy foundation `/api/v1/claims`, not the workflow. |
| Broken | UI evidence upload posts JSON `content_text` (`claims/[id]/page.tsx:243-258`) to a multipart `UploadFile` endpoint (`router.py:271`): always 422. |
| Consent | Evidence OCR runs without purpose check. Frontend silently POSTs `/api/v1/consents {granted:true}` before confirm (`claims/[id]/page.tsx:208`) and before approve (`actions/page.tsx:148`), defeating the consent gate. |
| Data | With the working-tree KB downgrade, no CN document evidence items are VERIFIED, so checklists contain only policy, date, provider and form rows. Seeded cases CLM-2024-* have `sandbox_ref` without `wf_sandbox_claims` rows (sync fails). Seeded actions carry hashes that do not match payloads. Non-CN seed branch uses SGD and "HealthPlus Clinic". |
| Missing | UI for case edit, evidence confirm, acknowledge-check, draft edit, sync; claim cancel; account-actor parity tests; Indonesian evidence procedures; real fapiao authenticity (out of scope; must stay "format checked only"). |
| Recommended change | Fix upload to multipart; add consent prompts in place of auto-grant; require `process_documents` (and `external_ai` when OCR uses AI) on evidence routes; reseed with consistent hashes and sandbox rows; checklist uses UNVERIFIED KB items as "Insurer requirement unverified" rather than dropping them. |
| Priority | P0 |

### US-09-05 Closed-loop Claim Follow-up, Joshua, P0

IMPLEMENTED BUT INCOMPLETE. `followup.sync_claim` (`followup.py:125`) runs only on manual `POST .../sync-status`. Sandbox progress is time-simulated lazily (`sandbox.advance`, `sandbox.py:185`, 10 s steps). Backoff, poll limit and consent stop exist. On ADDITIONAL_INFO it creates a CLAIM_TASK reminder and a `claim_follow_up_message` action requiring approval. `poll_due` (`:212`) is dead code; `set_monitoring`, `cancel_policy_reminders`, `sandbox.operator_decision` are unreachable. No tests. Overview GET writes reminders without commit (`router.py:74`). UI copy claims "automated polling" (`claims/page.tsx:472`). Plan: worker loop (AGENTIC_AI_ARCHITECTURE Section 8) invokes `poll_due` and outbox processing; tests for every transition.

### SC-10 Action Approval and Execution (`/actions`), Joshua, P0

| Field | Finding |
| --- | --- |
| Existing behavior | Workflow queue, detail, approve, reject, cancel, patch, execute, receipt (`router.py:403-512`). Canonical hash over full payload excluding `_execution_meta` (`services/approval.py:7`). Edit increments `payload_version` and invalidates approvals (`actions.py:574`). Approve checks status, 24 h expiry, client hash, version, recomputed hash; mismatch audited and 409. Execute re-verifies approval, hash, version, type, destination allow-list, expiry, consent; 10/min rate limit; idempotency key `exec:{action}:{approval}` unique; replay returns existing receipt; HMAC-signed receipts. Claim changes invalidate pending actions (`claims.py:522`). |
| Gaps | Client `payload_version` defaults to 1 and the UI never sends it. UI approves and executes in one click (`actions/page.tsx:140`). No ICS/mailto/PDF executors in the workflow system. Action types limited to claim submission, follow-up, manual handoff, internal reminder. |
| Duplication | Legacy `api/v1/actions.py` with `ActionRow`, its own hash checks, artifact executors, `simulate_failure` flag, fabricated `SBX-` references, AU templates (`:247-330`). |
| Recommended change | Workflow `wf_actions` is the single canonical action system. Port artifact executors as `MANUAL_HANDOFF` variants whose receipts say "Draft created, not sent". Freeze then retire legacy routes after the frontend stops calling them (no table drop). Separate approve and execute; require `payload_version`. Add action types: `renewal_inquiry`, `policy_servicing_request`, `policy_clarification_inquiry`, `employer_benefit_inquiry`. Reusable Action Review drawer. |
| Priority | P0 |

### SC-11 Activity and Audit (`/audit`), Joshua, P0

Real `wf_audit_logs` writes from claims (9 types), actions (9), follow-up (6), servicing (1), proof (1) with allow-list masking. Mixed with seeded fake events (`demo_claims_seed.py:700-790`) and on-read `DEMO_GUARDRAIL_SCENARIOS` with Indonesian OSHC strings (`audit_logger.py:541`) in the legacy `audit_events` and `account_audit_events` tables. Emergency triage never audited. Free-text titles can embed client strings (`proof.py:76`). Recommended: seeded audit rows labeled `synthetic=true` and generated by replaying real service calls during seeding, on-read fabricated scenarios removed from real accounts, guardrail events emitted by the shared safety screen and the ask pipeline, audit timeline unified as a read model over the three tables (no table merge). P0.

### SC-15 Employer Benefits, Joshua, P1

STATIC OR HARDCODED. `GET /workflow/employer-benefits/overview` uses KB schemes and `employer_group` products plus declared policies; coordination text hardcoded per country (`catalog_views.py:58-73`) citing Permenkes 16/2017 without source or status. Recommended: coordination enum `PRIMARY | SECONDARY | UNKNOWN | NOT_APPLICABLE` from documented evidence only, default UNKNOWN; "Prepare HR inquiry" action. Nested under My Protection.

### SC-17 Product Comparison (`/products/compare`), Joshua, P1

SOURCE UNVERIFIED shown as verified: missing `verification_status` defaults to `VERIFIED` (`catalog_views.py:179`); page hardcodes "Regulatory Verified" (`products/compare/page.tsx:200`) and "zero commercial affiliation" (`:194`). Reads KB JSON, not the catalog tables. Recommended: default UNVERIFIED, badges from data, commission disclosure field nullable and shown as "Not disclosed", no ranking by commission, context filter by identified needs. P1, but the false badge removal is a P0 safety fix.

### SC-19 Document Integrity Proof (`/proof`), Joshua, Bonus

Local SHA-256 verify is real (`proof.py:21`). `POST /workflow/proof/anchor` generates a random `tx_hash`, made-up block number, fixed contract and Etherscan URL, and states the digest is stored on-chain (`proof.py:45-65`); route does not commit its audit row. No page. Recommended P0 safety fix: relabel as `LOCAL_INTEGRITY_RECEIPT`, remove tx hash and explorer URL. Real testnet anchoring stays Bonus and requires human approval for wallet credentials.

## 3. New and revised PBIs

| PBI | Current | Gap | Priority |
| --- | --- | --- | --- |
| US-05-04 Event-driven orchestration | `wf_agent_events` insert-only (`workflow/audit.py:101`), no reader, no dispatcher, no worker. Account plan T5.1 plans `services/events.py` for notifications. | Outbox semantics, consumers, insight refresh, stale invalidation, retries, dead-letter, consent at processing. | P0 |
| US-03-05 Auto-discovery | Not implemented (Regina). | Downstream contract only: candidate policy event consumed by insights and claims. | P1 |
| US-10-05 Renewal and anti-lapse | `sync_policy_reminders` writes `wf_reminders` from overview GET without commit; no due processing. | H-30/H-7/H-1 deterministic schedule in owner timezone, dedupe, cancellation on verified update, renewal inquiry action, notification. | P0 |
| US-10-06 Policy servicing | `workflow/servicing.py` (172 lines) exists with one audit event type; not wired to Ask or UI. | Typed request kinds, draft, approval, manual handoff receipt. | P1 |
| US-09-05 Follow-up | See above. | Worker, tests, UI. | P0 |

## 4. Cross-cutting gaps

| Area | Finding | Recommended change |
| --- | --- | --- |
| Actor types | Four resolvers, two actor types (`Actor` kinds `DEMO_SESSION/AUTHENTICATED_ACCOUNT`; `Owner` kinds `DEMO/ACCOUNT`), two consent-check paths. | One resolution core (`services/demo_access.py`, `services/account_access.py`) with an adapter `owner_for(actor)`. No table rewrites. |
| Claim systems | Foundation `claim_cases` (Valen pathway cases, legacy routes) and workflow `wf_claim_cases` (Claims Center). | Workflow is canonical for claim lifecycle. Pathway confirmation creates the workflow case; foundation row kept for compatibility. |
| Action systems | Legacy `actions` versus `wf_actions`. | Workflow canonical; legacy frozen then retired. |
| Triage engines | Three. | One shared safety screen. |
| Audit tables | Three. | Unified read model; writers unchanged. |
| Frontend types | Workflow pages use hand-written domain types (`claims/page.tsx:23,55`, `claims/[id]/page.tsx:24-76`, `actions/page.tsx:23,46,56`, `audit/page.tsx:20,35`, `emergency/page.tsx:20-41`). | Typed workflow client from `types.gen.ts`. Requires workflow routes to declare response models. |
| Naming | Workflow router tag "Joshua Workflow" violates AGENTS module naming rule. | Rename tag to "Claims and Actions Workflow" (OpenAPI regeneration). |
| Background work | No scheduler or worker anywhere. | In-process worker loop plus CLI (AGENTIC_AI_ARCHITECTURE Section 8). |
| Data trust | 0 retrieved artifacts. Generator-authored records were labeled VERIFIED at HEAD; the parallel session is downgrading them. Emergency and red flags remain VERIFIED via manual official-page checks without a recorded review artifact. Logos are placeholders. | Source verification plan (IMPLEMENTATION_PLAN Part B section B6). |
| Tests | Frontend `workspace.spec.ts` and `claims.spec.ts` expect Indonesian strings removed by the English redesign. Backend suite: 321 passed at 19:05 WIB on the current working tree; an earlier run during concurrent edits showed transient errors (see IMPLEMENTATION_PLAN B3.1). Frontend E2E not run in this audit. | Phase B0 re-baselines after the Account/Demo branch lands. |
