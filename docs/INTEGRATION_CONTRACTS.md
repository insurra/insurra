# INSURRA Integration Contracts

Status: proposed (planning, 2026-10-19). Area leads follow the user's master prompt: Regina (account, profile, consent, onboarding, documents, wallet, family, notifications), Valen (context intelligence, insights, Ask, Coverage Needs, Care Pathways, Home), Joshua (emergency, claims, actions, audit, reminders, employer benefits, comparison). Code modules keep responsibility names, never developer names (AGENTS.md).

All contracts are Pydantic v2 models exposed through FastAPI under `/api/v1`, exported to `backend/openapi.json` and `frontend/src/lib/api/types.gen.ts`. Errors use `ApiError(code, message, details, request_id)`. Missing and foreign objects return 404.

## 1. Shared conventions

| Concern | Rule |
| --- | --- |
| Actor | `Authorization: Bearer <account session>` XOR `X-Demo-Session`. Both present: 422 `AMBIGUOUS_ACTOR` (Account plan AD-10). Internal adapter `owner_for(actor) -> Owner(kind, id)` maps to workflow `owner_kind/owner_id`. |
| Consent | `require_purposes(actor, {...})` reads current rows each call. 403 `CONSENT_REQUIRED` with `details.purposes`. |
| Idempotency | Consequential POSTs accept `Idempotency-Key` (UUID). Same key with different body: 409 `IDEMPOTENCY_MISMATCH`. |
| Events | Producers call `events.dispatch(db, owner, event_type, entity_type, entity_id, meta, dedupe_key)` inside the producing transaction. |
| Provenance | Every fact exposed across a boundary carries `Provenance` (AGENTIC_AI_ARCHITECTURE Section 3). |
| Synthetic | Demo responses carry `synthetic: true` at the envelope level. |

## 2. Regina to Valen and Joshua

| Interface | Schema | Lifecycle | Authorization | Errors |
| --- | --- | --- | --- | --- |
| Profile context | `ProfileData` (additive fields per Account plan AD-02); `UserContext` via `GET /context` | Changes emit `profile.context.changed`; country change rules per `COUNTRY_INTEGRATION.md` | Owner only | 404, 422 validation |
| Consent state | `PurposeConsents {process_documents, external_ai, retention}` | Revocation emits `consent.revoked`; consumers cancel pending AI jobs | Owner; privacy management needs no grant | 403 on protected callers |
| Owned coverages | `AccountCoverage` + reviewed `AccountField`; demo `UnifiedInsuranceRecord` | `coverage.updated`, `document.field.confirmed` | Owner | 404 |
| Documents and pages | `account_documents`, `account_document_pages` (retained only with `retention`) | `document.uploaded`, `document.extraction.completed` | Owner + `process_documents` | 403, 404 |
| Notifications | `Notification {id, type, category, priority, title, body, deep_link, entity_type, entity_id, created_at, read_at}` | Written only by `events` consumers | Owner | 404 |
| Auto-discovery (P1) | `PolicyCandidate {candidate_id, insurer_match, product_match, document_ids, confidence, provenance, status: CANDIDATE | CONFIRMED | REJECTED}` | `policy.candidate.detected` then user confirmation produces `coverage.updated` | Owner + `process_documents` | A candidate is never owned coverage until CONFIRMED |

## 3. Valen interfaces

### 3.1 Protection insights

```text
GET  /api/v1/insights                      -> InsightList {items: ProtectionInsight[], kb_version, generated_at}
POST /api/v1/insights/{id}/decision        body {decision: DISMISS | CORRECT, field_id?} -> ProtectionInsight
ProtectionInsight {
  id, kind, severity: HIGH | NORMAL | NEEDS_VERIFICATION, status, title, explanation,
  facts: ComputedFact[] (value, unit, provenance), coverage_id?, evidence_refs[],
  next_actions: NextAction[], created_at, updated_at
}
NextAction { kind: OPEN_REVIEW | PREPARE_ACTION | OPEN_CLAIM | OPEN_PATHWAYS | OPEN_EMERGENCY, label, deep_link, action_type? }
```

Auth: account or demo. Consent: none for reading deterministic insights; `CORRECT` routes to the document review flow. Events consumed: profile, field, coverage, claim, action. Emits `coverage.assessment.completed`. Idempotent by fingerprint. HIGH insights reject `DISMISS` with 409 `INSIGHT_REQUIRES_RESOLUTION`.

### 3.2 Home summary (extends `GET /api/v1/home/summary`, exists)

Additive fields: `insights` (top 3 OPEN by severity), `attention {claims_needing_evidence, pending_approvals, expiring_policies}` (counts from owned rows; `null` when unknown, never fabricated), `recent_activity` (last 5 `AuditTimelineItem`), `emergency {available, contacts[], source_url}` from the shared safety module.

### 3.3 Ask

```text
POST /api/v1/ask (exists) additive response fields:
  intent: Intent, tool_steps: ToolStep[] {tool, status, summary}, proposals: ActionProposal[]
ActionProposal { proposal_id, action_type, title, summary, target_entity, requires_approval: true }
POST /api/v1/ask/proposals/{proposal_id}/prepare  -> {action_id} (creates wf_actions draft via Joshua contract 4.2)
```

Auth: account or demo. Consent: `process_documents` + `external_ai` for model calls; deterministic-only intents (reminder, status) work without `external_ai`. Errors: `TRIAGE_UNAVAILABLE` 503 (fail closed), `QUESTION_RATE_LIMIT` 429, `EMERGENCY_REDIRECT` as SSE `redirect` event. A proposal never executes; `prepare` is idempotent per proposal.

### 3.4 Coverage Needs (extends `GET /api/v1/coverage-needs`, exists)

Each need adds `applicability: REQUIRED_VERIFIED | RECOMMENDED | APPLICABILITY_UNVERIFIED | NOT_APPLICABLE` and `evidence_state: HAVE_COVERAGE | MISSING_EVIDENCE | POTENTIAL_GAP | NEEDS_VERIFICATION | NOT_APPLICABLE`, plus `continuity {uncovered_days, interval_start, interval_end, compared_to, rule_id, rule_verification_status}`.

### 3.5 Care pathways to claims

`POST /api/v1/pathways/compare` (exists). Pathway confirmation calls Joshua's claim creation contract (4.1) with `origin: PATHWAY`, `comparison_id`, `Idempotency-Key`. The existing foundation `claim_cases` row is still written for backward compatibility; `wf_claim_cases.origin_ref` (additive) stores its id. Decision required (TASKS B-HUMAN-2).

### 3.6 Travel (P1)

`POST /api/v1/travel/checks {origin, destination, start_date, end_date, purpose, activities[]}` returns `{territory: COVERED | NOT_COVERED | UNKNOWN, date_coverage {covered_days, uncovered_days}, exclusions_cited[], destination_requirements: UNVERIFIED[], verification_steps[]}`. Owned policy fields only; no foreign rules invented.

## 4. Joshua interfaces

### 4.1 Claim creation

`POST /api/v1/workflow/claims` (exists) accepts additive `origin: MANUAL | PATHWAY | ASK`, `origin_ref?`, honors `Idempotency-Key`. Emits `claim.created`. Ownership of `coverage_id` verified. Response `ClaimCaseDetail` (declared response model, needed for generated types).

### 4.2 Action preparation (shared boundary)

```text
POST /api/v1/workflow/actions        body {action_type, entity_type, entity_id, draft_inputs} -> ActionDetail (status AWAITING_APPROVAL)
GET  /api/v1/workflow/actions/{id}   -> ActionDetail {payload, payload_sha256, payload_version, destination, expires_at, status, approvals[], receipt?}
POST /api/v1/workflow/actions/{id}/approve  body {payload_sha256, payload_version, confirm: true}
POST /api/v1/workflow/actions/{id}/execute  header Idempotency-Key
POST /api/v1/workflow/actions/{id}/reject | cancel ; PATCH edits -> new version
```

`action_type` enum: `sandbox_claim_submit`, `claim_follow_up_message`, `renewal_inquiry`, `policy_servicing_request`, `policy_clarification_inquiry`, `employer_benefit_inquiry`, `internal_reminder`, `calendar_reminder_file`. Server builds the canonical payload from owned data; `draft_inputs` are validated text fields only (subject, body, request kind), never ids of other owners. Emits `action.prepared`, `action.approved`, `action.executed`. Errors: 409 `PAYLOAD_HASH_MISMATCH`, 409 `PAYLOAD_VERSION_STALE`, 410 `ACTION_EXPIRED`, 403 `CONSENT_REQUIRED`, 422 `DESTINATION_NOT_ALLOWED`, 429 rate limit.

### 4.3 Claim status and follow-up

`claim.status.changed {case_id, from, to, source: SANDBOX | USER | SYSTEM}`. Real insurer statuses are never represented; sandbox statuses use `SANDBOX_*` labels.

### 4.4 Reminders

`GET /api/v1/workflow/reminders`, `POST /api/v1/workflow/reminders/{id}/cancel`. Reminder `{id, kind: POLICY_EXPIRY | CLAIM_TASK | USER, coverage_id?, fire_at, timezone, status, dedupe_key}`. Created by renewal planner (deterministic) or approved `internal_reminder` actions.

### 4.5 Emergency and safety screen

`services/safety_screen.screen(text, country) -> SafetyResult {category: MEDICAL_EMERGENCY | SELF_HARM_RISK | NONE_DETECTED, matched_flag_ids, screening_complete: false}`. Consumed by Ask, Pathways, Emergency page. `GET /api/v1/workflow/emergency/contacts?country=` returns only KB contacts with `verification_status`; empty means "Not available".

### 4.6 Audit timeline

`GET /api/v1/workflow/audit/timeline` (exists) becomes a read model over `wf_audit_logs`, `audit_events`, `account_audit_events` filtered by owner. Items carry `synthetic` flag and `approval_id?`, `receipt_id?` references.

### 4.7 Employer benefits and comparison (P1)

Employer: `coordination: PRIMARY | SECONDARY | UNKNOWN | NOT_APPLICABLE` with `evidence_ref` required for anything except UNKNOWN. Comparison: each attribute is `{value | null, provenance}`; product `verification_status` defaults to UNVERIFIED; `commission_disclosure` nullable.

## 5. Ownership lifecycle across boundaries

| Event | Effect |
| --- | --- |
| Demo reset or end (Account plan AD-09) | Cascade deletes owner rows including insights, events, reminders; worker skips rows whose owner no longer resolves |
| Account deletion | Cancels pending events and reminders, deletes insights; audit retained redacted |
| Consent revoked | Pending AI events `CANCELLED`; reminders unaffected (no AI); executions requiring the purpose fail 403 at execute time |
