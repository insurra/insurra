# INSURRA Demo Acceptance Plan: Raka and Sinta

Status: proposed (planning, 2026-10-19). Prerequisites from the Account/Demo plan (IMPLEMENTATION_PLAN Part A): Raka migrated to China (AD-05, AD-06), AU deactivated (AD-04), demo reset/end (AD-09), notifications (AD-11). These steps verify the synthetic demo only. **A passing synthetic walkthrough is not proof that the real-user pipeline works**; account parity is covered by separate tests (TASKS B6.4).

Global failure behavior: any backend error renders an English error state with retry, never a success state; unknown values render "Not available" or "Needs verification"; synthetic badge visible on every demo screen.

## 1. Fixture prerequisites

| Item | Required value | Owner task |
| --- | --- | --- |
| Raka profile | CN, Shenzhen, Indonesian nationality, international student, CNY, `Asia/Shanghai`, study 2026-09-01 to 2027-06-30, fictional institution | Account plan T2.3 |
| Raka policy | Synthetic student health plan, 2026-09-01 to 2027-04-15, CNY | Account plan T2.3 |
| Raka claims seed | Policy period aligned to 2027-04-15 end (seed currently uses 2027-08-31; must change), fapiao service date 2026-10-12, CNY 450, patient Raka, hashes consistent, sandbox rows present for submitted cases | B6.1 |
| Raka Mandarin policy | Synthetic Chinese policy wording document with retained pages (labeled synthetic), used for Journey C | B2.6 |
| Sinta | ID, Jakarta, employee, JKN (BPJS) and employer group policies, IDR, coordination UNKNOWN | Exists, verify in B6.3 |

## 2. Raka Journey A: Protection intelligence

| # | Route | User action | Source data | Backend API | Tool | Expected UI | Evidence | Audit event | Assertion | Failure behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `/` | Start Demo on Raka card | persona template | `POST /demo/sessions {persona_id: raka}` | none | Redirect to `/home`, synthetic banner | n/a | `DEMO_SESSION_STARTED` | token in sessionStorage only | Error card, no session |
| A2 | `/home` | View | session profile | `GET /home/summary`, `GET /insights` | get_authorized_user_context | Greeting "Raka", Shenzhen, CN | profile provenance SYNTHETIC | none | no AU text, CNY | "Not available" blocks |
| A3 | `/home` | View coverage card | policy | `GET /home/summary` | get_user_coverages | Student coverage, end 15 Apr 2027 | policy record | none | dates match fixture | Unknown state |
| A4 | `/home` | Open top insight | insight row | `GET /insights` | evaluate_coverage_continuity | "Coverage dates require review. 76 days between coverage end and study end." severity Needs verification | facts with provenance COMPUTED; rule `coverage_continuity` UNVERIFIED | `COVERAGE_ASSESSMENT_COMPLETED` | uncovered_days == 76, interval 2027-04-16 to 2027-06-30 | Insight absent if dates missing; shows "Add study dates" |
| A5 | `/coverage-needs` | View | KB CN | `GET /coverage-needs` | get_applicable_country_rules | Applicability "Unverified", evidence state Potential gap | rule verification UNVERIFIED | none | no "mandatory", no legal wording | Needs verification state |
| A6 | `/coverage-needs` | Prepare renewal inquiry | insight | `POST /workflow/actions {renewal_inquiry}` | prepare_action | Action Review drawer with exact payload, hash, version | payload from owned data | `ACTION_PREPARED` | status AWAITING_APPROVAL; no send | Error, no action row |
| A7 | `/actions?action=id` | Approve | action | `POST .../approve` | verify_action_approval | Approved, Execute button separate | hash, version | `ACTION_APPROVED` | approval row bound to hash | 409 on mismatch shown |
| A8 | `/actions?action=id` | Execute | approval | `POST .../execute` | manual_handoff_email_draft | "Draft prepared. Not sent." download | receipt | `ACTION_EXECUTED` | receipt persisted; replay returns same receipt | Failure state with retry |
| A9 | `/audit` | View | audit rows | `GET /workflow/audit/timeline` | none | Prepared, approved, executed entries | receipt link | n/a | entries from backend only | Empty state |

## 3. Raka Journey B: Agentic claims

| # | Route | User action | Source | API | Tool | Expected UI | Evidence | Audit | Assertion | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | `/claims` | New claim | owned policy | `POST /workflow/claims` (Idempotency-Key) | get_user_coverages | Case detail opens | policy ref | `CLAIM_CREATED` | one case on double click | Error card |
| B2 | `/claims/[id]` | View checklist | KB CN claim evidence | detail | get_claim_requirements | Items incl. fapiao marked "Insurer requirement unverified" | KB record UNVERIFIED | none | unverified items visible, not counted satisfied | Checklist empty state |
| B3 | `/claims/[id]` | Upload synthetic fapiao (multipart) | test fixture file | `POST .../evidence` | validate_claim_evidence | Extracted fields shown for review | doc sha256, page | `CLAIM_EVIDENCE_ADDED` | consent prompt if `process_documents` missing (no auto-grant) | 403 shows consent prompt |
| B4 | `/claims/[id]` | Confirm fields | evidence | `POST .../evidence/{id}/confirm` | validate_claim_evidence | Checks: date in policy, CNY, amount 450.00 | computed checks | `CLAIM_EVIDENCE_CONFIRMED` | deterministic results | Check failure listed |
| B5 | `/claims/[id]` | View missing | checklist | detail | validate_claim_evidence | "Missing: medical record" | KB item | none | readiness not READY | n/a |
| B6 | `/claims/[id]` | Generate draft | case | `POST .../draft` | prepare_claim_draft | Editable draft, missing fields blank | field provenance | `CLAIM_DRAFT_CREATED` | no invented values | Error |
| B7 | `/claims/[id]` | Send to approval | draft | `POST .../send-to-approval` | prepare_action | Action Review drawer | payload hash | `ACTION_PREPARED` | sandbox_claim_submit pending | 409 if not ready (override requires acknowledgement) |
| B8 | drawer | Edit then approve | action | PATCH, approve | verify_action_approval | Version 2, old approval void | hash v2 | `ACTION_PAYLOAD_EDITED`, `ACTION_APPROVED` | approve with v1 hash returns 409 | 409 message |
| B9 | drawer | Execute | approval | execute | execute_approved_sandbox_action | "Accepted by the INSURRA test sandbox. No insurer received this." | receipt HMAC | `ACTION_EXECUTED` | `wf_sandbox_claims` row; second execute replays | Failure with retry |
| B10 | `/claims/[id]` | Wait (worker) | sandbox | worker `process_due` | get_claim_status | Timeline "Sandbox processing" then decision | status events | `CLAIM_STATUS_CHANGED` | status from sandbox row, labeled sandbox | "Status check failed" visible |
| B11 | `/claims/[id]` | Sandbox requests info (operator fixture) | sandbox | worker | prepare_claim_follow_up | Follow-up task + draft message action | reminder row | `FOLLOW_UP_PREPARED` | message not sent without approval | n/a |
| B12 | `/notifications` | View | notifications | `GET /notifications` | none | "Claim needs more information" | event ref | n/a | one notification per event | n/a |
| B13 | `/audit` | View | audit | timeline | none | Full history with receipt link | refs | n/a | no raw document values | n/a |

## 4. Raka Journey C: Cross-language Q&A

| # | Route | Action | Source | API | Tool | Expected UI | Assertion | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `/settings/privacy` | Grant documents + external AI (demo-scoped) | consent | consent APIs | none | Toggles on | grants persisted per session | n/a |
| C2 | `/ask` | Ask in Indonesian: "Apakah rawat jalan ditanggung polis saya?" | synthetic Mandarin policy pages | `POST /ask` (SSE) | retrieve_applicable_policy_clauses | Answer in Indonesian; citation shows original Chinese quote, document, page | quote is substring of page; language zh; label "Explanation, not a translation" | No match: "Not found in your documents", never "not covered" |
| C3 | `/ask` | Ask with red-flag phrase in Chinese "胸痛" | safety screen | `POST /ask` | safety screen | Navigates to `/emergency` with CN contacts | no provider call (fixture provider records zero calls) | If KB contacts empty: generic local emergency instruction |
| C4 | `/ask` | "Remind me before my policy expires" | owned policy | `POST /ask`, `POST /ask/proposals/{id}/prepare` | schedule_coverage_reminder | Action card, then review drawer | internal_reminder action AWAITING_APPROVAL | n/a |

CI runs C2 to C4 with the in-memory provider fixture. A live provider run is optional and never counted as CI evidence.

## 5. Sinta Journey

| # | Route | Action | Source | API | Tool | Expected UI | Evidence | Audit | Assertion | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | `/` | Start Demo Sinta | template | `POST /demo/sessions` | none | `/home`, Jakarta | n/a | `DEMO_SESSION_STARTED` | isolated from Raka | error |
| S2 | `/protection` | View | records | existing protection APIs | get_user_coverages | JKN and Employer group as separate cards | each UNVERIFIED synthetic | none | no combined limit | n/a |
| S3 | `/ask` | "Does my employer policy include outpatient care?" | employer policy pages (synthetic) | `POST /ask` | retrieve_applicable_policy_clauses | Cited answer or "Not found" | page quote | `ASK_ANSWERED` (metadata only) | no unsupported benefit | not-found state |
| S4 | `/pathways` | Compare non-emergency outpatient | KB ID pathways | `POST /pathways/compare` | compare_supported_care_pathways | BPJS primary (verified source) and employer network (unverified) cards, costs "Not available" | KB provenance | none | no cashless claim | triage unavailable: fail closed message |
| S5 | `/pathways` | View coordination | employer view | `GET /workflow/employer-benefits/overview` | none | Coordination "Unknown" with explanation | no evidence ref | none | coordination == UNKNOWN | n/a |
| S6 | `/pathways` | Prepare benefit clarification | pathway | `POST /workflow/actions {employer_benefit_inquiry}` | prepare_action | Review drawer, HR inquiry draft | payload | `ACTION_PREPARED` | not sent | error |
| S7 | drawer | Approve and execute | action | approve, execute | manual_handoff_email_draft | "Draft prepared. Not sent." | receipt | `ACTION_APPROVED`, `ACTION_EXECUTED` | receipt persisted | 409 states |
| S8 | `/audit` | View | audit | timeline | none | Entries for S6 to S7 | refs | n/a | Sinta sees no Raka rows | empty state |

## 6. Isolation assertions (run with every walkthrough)

1. Raka and Sinta sessions in two tabs never see each other's cases, actions, insights or notifications (API returns 404 for foreign ids).
2. A demo token on `/api/v1/account/*` returns 401; an account token in `X-Demo-Session` returns 401.
3. A real account created after the demo contains no persona rows.
4. Demo reset returns the baseline: zero user-created actions, seeded cases only.
5. No AU, OSHC, 8501, Melbourne or AUD text appears anywhere in either walkthrough (Playwright text scan).
6. No em dash characters in rendered UI copy (Playwright text scan).

## 7. Automation mapping

| Walkthrough | Backend test | Playwright spec |
| --- | --- | --- |
| Raka A | `test_agent_insights.py`, `test_actions_types.py` | `demo-raka-protection.spec.ts` |
| Raka B | `test_workflow.py` (extended), `test_claim_followup.py` | `demo-raka-claims.spec.ts` |
| Raka C | `test_policy_qa_cross_language.py`, `test_safety_screen.py` | `demo-raka-ask.spec.ts` |
| Sinta | `test_care_pathways.py` (ID), `test_employer_coordination.py` | `demo-sinta.spec.ts` |
| Isolation | `test_session_isolation.py` (exists, Account plan) | `demo-personas.spec.ts` (Account plan T7.2) |
