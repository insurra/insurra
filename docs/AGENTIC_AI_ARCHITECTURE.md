# INSURRA Agentic AI Architecture

Status: proposed (planning, 2026-10-19). Nothing in this document is implemented unless marked "exists". Implementation tasks: [TASKS.md](../TASKS.md) Part B. Current-state evidence: [FEATURE_GAP_ANALYSIS.md](FEATURE_GAP_ANALYSIS.md).

INSURRA is one bounded insurance agent, not a set of per-screen chatbots. Every surface (Home, Ask, Pathways, Coverage Needs, Claims, Notifications) uses the same context loader, the same deterministic engines, the same tool registry and the same approval boundary.

```text
User interaction or domain event
  -> Intent and trigger router
  -> Authorized context loader          (actor, consent, owned data only)
  -> Policy and knowledge retrieval     (owned documents, versioned CN/ID KB)
  -> Applicable rules engine            (deterministic)
  -> Evidence and confidence assessment
  -> Decision and recommendation layer  (protection insights)
  -> Action planner                     (draft actions only)
  -> Human approval boundary            (hash-bound, versioned)
  -> Authorized tool execution          (sandbox or manual handoff)
  -> Receipt, audit and notification
  -> Context refresh and reassessment   (events)
```

## 1. Design principles

1. One canonical user context, rebuilt from owned rows per request. No agent memory store separate from domain tables.
2. One coverage source of truth per actor: account `account_coverages` + reviewed `account_fields`; demo `insurance_records` (exists). Public catalog products never become owned coverage.
3. Deterministic code computes dates, intervals, money (Decimal), completeness, applicability, state transitions, authorization, approval validity, idempotency and reminder schedules. The LLM never produces a number that is shown as fact.
4. LLM duties: intent classification (enum output), explanation of structured facts, drafting text for user review, summarizing validated citations.
5. Every tool is typed, owner-scoped, consent-checked and classified. There is no generic SQL, HTTP or shell tool.
6. Consequential effects require a persisted approval bound to `payload_sha256` and `payload_version` (exists in `workflow/actions.py`).
7. Retrieved text, OCR output and policy wording are untrusted data. They never change tool permissions or instructions.
8. Honest uncertainty: unknown stays unknown; UNVERIFIED rules can raise "Needs verification", never a legal conclusion.
9. No new framework is introduced for agent orchestration. The orchestrator is plain Python in the FastAPI backend.

## 2. Module layout (proposed, domain names only)

| Module | Responsibility | Reuses |
| --- | --- | --- |
| `backend/app/agent/context.py` | `build_user_context(db, actor) -> UserContext` | `ProfileData`, coverage adapters in `services/workspace.py`, `workflow/owner.py` policy view |
| `backend/app/agent/tools.py` | Tool registry: `ToolSpec(name, permission_class, input_model, output_model, required_purposes, handler)` | Existing service functions |
| `backend/app/agent/intents.py` | Deterministic keyword router plus LLM enum classifier | `ai_gateway.ResponsesGateway` |
| `backend/app/agent/planner.py` | Maps intent + context to an ordered tool plan; never calls consequential tools | |
| `backend/app/agent/insights.py` | Protection insight engine (pure functions) and persistence | `rules_engine`, `coverage_matching`, `command_center` |
| `backend/app/agent/worker.py` | Outbox consumer and due-job runner (`process_due`) | `workflow/followup.poll_due`, reminders |
| `backend/app/services/events.py` | `dispatch()` producer API (planned by Account plan T5.1, extended here) | `wf_agent_events`, `notifications` |
| `backend/app/services/safety_screen.py` | Single red-flag and emergency engine | `POST /api/v1/triage` logic in `foundation.py:138` |

## 3. Canonical context model

`UserContext` is a Pydantic v2 model returned by `GET /api/v1/context` (Account plan T3.2 creates the endpoint; this plan extends the payload additively).

| Group | Fields | Source |
| --- | --- | --- |
| identity | `actor_kind` (`AUTHENTICATED_ACCOUNT` or `DEMO_SESSION`), `synthetic` (bool), `persona_id` (demo only) | actor resolver |
| situation | `residence_country`, `city`, `nationality`, `situation`, `institution_name`, `employer_name`, `study_start_date`, `study_end_date`, `permit_end_date`, `timezone`, `currency`, `goals`, `household` | `ProfileData` (+ Account plan AD-02 fields) and KB manifest |
| consent | `process_documents`, `external_ai`, `retention` (current rows) | `account_consents` / `purpose_consents` |
| coverages | list of `CoverageFact` | owned coverages and reviewed fields |
| claims | `open_claims`, `claims_needing_evidence` | `wf_claim_cases` |
| operations | `pending_actions`, `due_reminders`, `unread_notifications` | `wf_actions`, `wf_reminders`, `notifications` |
| kb | `kb_country`, `kb_version`, `kb_active` | `kb_loader` with `ACTIVE_KB_COUNTRIES` |

`CoverageFact` and every material fact carry provenance:

```text
Provenance {
  origin: DOCUMENT_EXTRACTED | USER_DECLARED | USER_CONFIRMED | KB_PUBLIC | SYNTHETIC_FIXTURE | COMPUTED
  evidence_ref: { document_id, page, field_id } | { kb_country, kb_file, record_id, kb_version } | null
  verification_status: VERIFIED | USER_CONFIRMED | NEEDS_REVIEW | UNVERIFIED | SYNTHETIC | UNAVAILABLE
  updated_at, jurisdiction, policy_version (nullable)
}
```

Rules: a catalog product is `KB_PUBLIC` and is never placed in `coverages`. A self-reported policy is `USER_DECLARED` and never `VERIFIED`. A brochure limit is attached to a user policy only when the owned document identifies the same product version (field-level evidence).

## 4. Intent routing and trigger taxonomy

Triggers: `USER_MESSAGE` (Ask), `USER_ACTION` (button on Home, Pathways, Claims), `DOMAIN_EVENT` (outbox), `SCHEDULE` (reminder due, follow-up poll).

Order of evaluation for `USER_MESSAGE`:

1. Safety screen (deterministic, multilingual). Positive match returns `EmergencyRedirect` or `SelfHarmSupport` before anything else. No match is never clearance.
2. Rate limit (exists, 20 per hour).
3. Deterministic intent rules (keyword lists in KB `retrieval_terms`, zh/id/en).
4. If ambiguous and `external_ai` granted: LLM structured classification to `Intent` enum only.
5. Planner builds a tool plan for the intent.

| Intent | Example | Tool plan (in order) | Ends with |
| --- | --- | --- | --- |
| `POLICY_QUESTION` | "What does my student insurance cover?" | get_user_coverages, retrieve_applicable_policy_clauses, get_policy_benefits | Grounded answer |
| `COVERAGE_STATUS` | "Why is my coverage flagged?" | get_protection_insights, evaluate_coverage_continuity | Explanation of insight |
| `CLAIM_HELP` | "Help me prepare a reimbursement claim." | get_user_coverages, get_claim_requirements, get_claim_evidence | Link or `start_claim` proposal |
| `REMINDER_REQUEST` | "Remind me before this policy expires." | get_user_coverages, schedule_coverage_reminder (proposal) | Action card |
| `SERVICING_REQUEST` | "Request another insurance certificate." | get_policy_evidence, prepare_policy_servicing_request | Action card |
| `CARE_NAVIGATION` | "Where should I go for a fever?" | safety screen, compare_supported_care_pathways | Link to `/pathways` with context |
| `OUT_OF_SCOPE` / `MEDICAL_ADVICE` | diagnosis request | none | Refusal with safe next step |

## 5. Tool registry and permission classes

| Class | Effect | Approval | Examples |
| --- | --- | --- | --- |
| `READ_USER_CONTEXT` | Reads owned rows | No | get_authorized_user_context, get_user_coverages, get_policy_evidence, get_policy_benefits, get_claim_evidence, get_claim_status, get_execution_receipt |
| `READ_PUBLIC_KNOWLEDGE` | Reads active CN/ID KB | No | get_applicable_country_rules, get_claim_requirements, get_care_pathway_options, get_relevant_insurance_products, get_verified_emergency_guidance |
| `DETERMINISTIC_COMPUTE` | Pure functions | No | evaluate_coverage_continuity, calculate_protection_insights, validate_claim_evidence, compare_supported_care_pathways |
| `INTERNAL_STATE_UPDATE` | Writes owned non-external state | No (user-initiated) | record_audit_event, mark insight corrected, cancel_coverage_reminder |
| `DRAFT_PREPARATION` | Creates draft rows, no external effect | No; result is reviewable | prepare_claim_draft, prepare_action, prepare_claim_follow_up, prepare_policy_servicing_request, schedule_coverage_reminder (creates `internal_reminder` action) |
| `CONSEQUENTIAL_EXTERNAL` | Leaves the system or simulates insurer contact | Yes, hash-bound | execute_approved_sandbox_action |
| `SAFETY_ROUTING` | Overrides normal flow | No | safety screen |

Registry rules:

- `ToolSpec.required_purposes` checked against current consent rows at call time. Any tool that sends document content to a provider needs `process_documents` and `external_ai`.
- Every handler receives the resolved `Owner`, never a caller-supplied owner id. Object ids in inputs are re-resolved through owner-scoped lookups (404 for foreign and missing).
- The LLM sees only tools of classes `READ_*`, `DETERMINISTIC_COMPUTE` and `DRAFT_PREPARATION`. `CONSEQUENTIAL_EXTERNAL` is never exposed to the model; only the Action Review UI calls execute.
- Tool outputs passed back to the LLM are structured facts with provenance; raw document text is limited to validated excerpts.
- Each call writes a compact audit record (`tool`, outcome, entity refs, no inputs containing questions or document values).

## 6. Workflow state

Reuse existing state carriers instead of a generic agent-run table where they already exist:

| Workflow | State carrier |
| --- | --- |
| Claim lifecycle | `wf_claim_cases` + `wf_claim_status_events` (exists) |
| Action lifecycle | `wf_actions`, `wf_action_approvals`, `wf_action_executions`, `wf_execution_receipts` (exists) |
| Conversation | `chat_sessions.turns` (exists) plus additive `workflow_state` JSON: `{intent, step, proposed_action_ids, pending_inputs}` |
| Pathway decision | `pathway_decisions` (exists) |
| Reminder | `wf_reminders` (exists) plus additive `fire_at`, `cancelled_at`, `dedupe_key` if missing |
| Event processing | `wf_agent_events` extended as an outbox (Section 7) |

Resumability: every step writes its result before the next step starts. A browser refresh reloads state from these rows; there is no in-memory-only progress.

## 7. Event schema and outbox

`wf_agent_events` (exists, insert-only today) gains additive columns in migration `0014`: `dedupe_key` (unique per owner), `status` (`PENDING | PROCESSING | DONE | FAILED | DEAD | CANCELLED`), `attempts`, `next_attempt_at`, `processed_at`, `error_code`, `schema_version`.

```text
AgentEvent {
  id, owner_kind, owner_id, event_type, entity_type, entity_id,
  payload_meta (allow-listed, no document values), dedupe_key,
  occurred_at, schema_version, status, attempts, next_attempt_at
}
```

| Event | Producer | Consumers |
| --- | --- | --- |
| `profile.context.changed` | Profile (Regina) | insights.refresh, reminders.reconcile |
| `onboarding.completed` | Onboarding (Regina) | insights.refresh, notifications |
| `document.uploaded` | Documents (Regina) | notifications |
| `document.extraction.completed` | Documents (Regina) | notifications (review required) |
| `document.field.confirmed` | Documents (Regina) | insights.refresh, reminders.reconcile, claims.evidence_recheck |
| `coverage.updated` | Wallet (Regina) | insights.refresh, reminders.reconcile |
| `coverage.assessment.completed` | insights (Valen) | notifications, home cache |
| `claim.created` | Claims (Joshua) | insights.refresh, notifications |
| `claim.status.changed` | Claims follow-up (Joshua) | notifications, follow-up planner |
| `action.prepared` | Actions (Joshua) | notifications (approval required) |
| `action.approved` | Actions (Joshua) | audit only |
| `action.executed` | Actions (Joshua) | notifications, claim tracking |
| `reminder.due` | worker (Joshua) | notifications, renewal planner |
| `consent.revoked` | Consent (Regina) | cancel pending AI jobs, purge derived data (exists), notifications |

Transaction boundary: producers call `events.dispatch()` inside the same DB transaction as the state change (transactional outbox). Consumers run after commit in the worker. Dedupe key format: `{event_type}:{entity_id}:{version_or_date}`; insert-or-ignore on conflict.

Consumer contract: idempotent, re-check consent and ownership at processing time, never call an LLM (insight refresh is deterministic), write results with an input fingerprint so a duplicate event produces no new rows. Retry with exponential backoff (30 s, 2 min, 10 min, 1 h, 6 h); after 5 attempts `DEAD` plus an audit `AGENT_EVENT_FAILED`. Demo session deletion cascades owner rows; account deletion cancels pending events.

## 8. Worker and scheduling

No job platform exists. Proposed:

- `agent/worker.py: process_due(session_factory, now, limit) -> int` processes outbox rows, due reminders (`fire_at <= now`) and due follow-up polls (`workflow/followup.poll_due`, exists but unused).
- Runs (a) as an asyncio loop in FastAPI `lifespan` when `AGENT_WORKER_ENABLED=true` (default true in dev, false in tests), interval `AGENT_WORKER_INTERVAL_SECONDS` (default 15); (b) via `make agent-worker-once` for operators and E2E; (c) directly in tests with a frozen clock.
- Row claiming uses `UPDATE ... WHERE status='PENDING' AND id=:id` compare-and-set so two processes cannot double-process (portable to SQLite and PostgreSQL).
- UI freshness: pages refetch after mutations and poll `GET /notifications/unread-count` (Account plan) every 30 s; no websocket in P0.

## 9. Protection insights

New owner-scoped table `protection_insights` (migration `0014`, `OwnerColumns` XOR pattern from `workspace_state.py`): `id, rule_id, kind, severity, status (OPEN | RESOLVED | SUPERSEDED | USER_CORRECTED), coverage_id, facts JSON (computed values with provenance), evidence_refs JSON, input_fingerprint, kb_version, created_at, updated_at, resolved_at`; unique `(owner, rule_id, coverage_id, input_fingerprint)`.

| Kind | Rule (deterministic) | Severity basis |
| --- | --- | --- |
| `COVERAGE_CONTINUITY_INTERVAL` | Inclusive uncovered days between coverage end and later of study end / permit end | HIGH if a VERIFIED applicable requirement exists, otherwise NEEDS_VERIFICATION (never breach) |
| `POLICY_EXPIRY_SOON` | End date within 30 days in owner timezone | HIGH at 7 days or less |
| `MISSING_EVIDENCE` | Required field for a coverage not found or not reviewed | NORMAL |
| `CLAIM_NEEDS_EVIDENCE` | Workflow case status `NEEDS_EVIDENCE` | HIGH |
| `ACTION_AWAITING_APPROVAL` | `wf_actions` pending and unexpired | NORMAL |
| `FIELD_NEEDS_CONFIRMATION` | Extracted field with low confidence | NORMAL |

Refresh replaces OPEN insights whose fingerprint changed (old row SUPERSEDED). Dismiss is allowed only for NORMAL; HIGH insights stay until the underlying condition resolves or the user corrects a field ("This is wrong" opens the field review, producing `document.field.confirmed`). `recommendation_states` (exists) keeps working for KB recommendation cards.

## 10. RAG retrieval and citations

- Corpus: owned retained pages (`account_document_pages`; demo session equivalent to be confirmed in task B2.6) chunked into `clause_chunks` (exists) with additive `language` (`zh | id | en | unknown`).
- Tokenization: existing `\w+` for Latin scripts; character bigrams for CJK runs. KB `retrieval_terms` for CN gains zh/id/en alias groups (UNVERIFIED vocabulary, data not facts).
- Cross-language: question language detected deterministically; aliases expand the query into the document language. Answers are generated in the question language; quotes are always the original-language substring with document, page and offsets. Optional English or Indonesian gloss is labeled "Explanation, not a translation of the clause".
- Citation validation (exists): substring of an owned, retained, non-injected page. Added: support check (quote must contain a key term of the claimed benefit or exclusion and match polarity), exclusion and eligibility claims require the clause type to match, version check (coverage period of the document must contain the question's relevant date when one is given).
- Public KB chunks (`kb/*/rag_chunks.json`) are SYNTHETIC_FIXTURE and are never cited as user policy evidence.

## 11. Deterministic computations

| Computation | Function (single owner) |
| --- | --- |
| Inclusive date interval and union of coverage periods | `rules_engine.uncovered_days()` (merge the two existing formulas) |
| Money arithmetic, remaining limits | `services/benefits.py` (exists, Decimal) |
| Claim readiness, consistency checks | `workflow/claims.py`, `workflow/checks.py` (exist) |
| Reminder dates H-30, H-7, H-1 | new `agent/schedules.py` using `zoneinfo` from KB manifest timezone |
| Payload hash | `services/approval.payload_sha256` (exists) |

## 12. Action planning, approval and execution

```text
DRAFT -> AWAITING_APPROVAL -> APPROVED -> EXECUTING -> EXECUTED (receipt)
                    \-> REJECTED      \-> EXPIRED      \-> FAILED (retryable with same idempotency key)
any payload edit -> new payload_version, approvals invalidated -> AWAITING_APPROVAL
```

Exists in `workflow/actions.py` except the explicit split between approve and execute in the UI and the new action types. Executors:

| Executor | Effect | Receipt wording |
| --- | --- | --- |
| `sandbox_claim_submit` (exists) | Internal sandbox row | "Accepted by the INSURRA test sandbox. No insurer received this." |
| `manual_handoff_email_draft` (port from legacy) | Generates mailto/EML text | "Draft prepared. Not sent." |
| `manual_handoff_document` (port PDF) | Generates downloadable document | "Document generated. Not submitted." |
| `calendar_reminder_file` (port ICS) | ICS download | "Calendar file generated." |
| `internal_reminder` (exists) | `wf_reminders` row | "Reminder scheduled in INSURRA." |

No executor contacts a real insurer. A real integration needs a signed contract, credentials, and a new executor reviewed separately.

## 13. Notifications

Produced only by event consumers (Account plan `notifications` table with `dedupe_key`). Content never includes medical details, amounts or document values. Deep links are relative in-app paths (for example `/actions?action=<id>`, `/claims/<id>`).

## 14. Safety and threat controls

| Threat | Control |
| --- | --- |
| Prompt injection in documents | Line filter (exists) plus KB `injection_patterns.json` applied (currently unused), instruction/data separation in prompt, tool allowlist per intent, model cannot reach consequential tools, schema-validated outputs |
| Citation laundering | Support check and polarity check (Section 10); unsupported points dropped, not rewritten |
| Cross-user access | Owner-resolved handlers; 404 for foreign; tests per tool |
| Fabricated benefits or numbers | Numbers only from structured facts; post-hoc guard kept as a second line |
| Unauthorized tool calls | Registry permission classes; execute endpoint requires approval row, hash, version, consent, unexpired, idempotency |
| Replay and duplicates | Unique idempotency key per approval (exists); event dedupe keys |
| Consent bypass | Remove frontend auto-grant; recheck grants inside each tool and consumer |
| Sensitive logging | Allow-list audit metadata (exists); tool audit excludes inputs |
| Medical diagnosis | Safety screen first; medical-advice refusal; no diagnosis fields in drafts generated by AI |
| Misleading sandbox status | Receipt and UI wording above; sandbox statuses use `SANDBOX_*` enum labels |

## 15. Evaluation framework

- Golden question set per language (zh, id, en) over synthetic CN and ID policy fixtures: expected citation page, expected "unknown" cases, forbidden numbers.
- Adversarial set: injected instructions in policy text, cross-user id guessing, payload tampering, replay, consent revocation mid-call, red-flag phrases in three languages including negations.
- Metrics recorded per CI run: citation validity rate, unsupported-claim drop rate, red-flag recall on the test set, zero cross-owner reads.
- CI uses in-memory provider fixtures only (exists pattern). Optional live check script (exists `scripts/check_live_ai.py`) is never part of CI.

## 16. Human oversight

Users approve every consequential action, can correct any fact that drives an insight, can cancel reminders and monitoring, and can see every agent step in Activity & Audit. There is no automated underwriting, claim denial, purchase or policy modification.
