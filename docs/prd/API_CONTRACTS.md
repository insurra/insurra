# Canonical API contracts

All business paths below have `/api/v1` prefix. Deferred endpoints return HTTP 501 after identity, consent and object scope checks. The Joshua demo slice implements claim case creation/list/detail and action queue/decisions as explicitly marked below; it does not process evidence, build claim drafts or execute insurer actions. Existing working GET/demo endpoints retain their response shapes. Canonical PUT /profile uses the PRD envelope; see compatibility notes below. Lowercase PRD purpose values remain lowercase; other legacy domain enums remain uppercase.

Consent notation: `D` process_documents; `A` external_ai; `—` no processing grant required. Every user-scoped route requires a validated demo session today. Authenticated-account actors are specified but not resolved. Foreign and absent object IDs both return 404; session failure is 401, purpose denial 403, then owned unimplemented operations return 501. Retention never grants AI permission.

| PRD method/path | Canonical path | Request → response | Consent | Status / difference |
| --- | --- | --- | --- | --- |
| POST /api/consents | POST /consents | PurposeConsentUpdate → PurposeConsent | — | Functional foundation; one explicit purpose and policy_version. GET /consents lists three purposes. |
| PUT /api/profile | PUT /profile | ProfileUpdate → ProfileResponse | — | Functional `{profile,suggested_docs}` envelope; partial and full legacy request fields accepted. GET remains bare UserProfile. Unverified KB suggestions return []. |
| POST /api/documents | POST /documents | multipart file, kind? → DocumentUploadAccepted | D+A | 501; PDF/JPG/PNG and 10MB/10 files are future upload enforcement, not claimed implemented. |
| GET /api/documents/:id | GET /documents/{document_id} | UUID → DocumentDetail | D | 501 after ownership. |
| PATCH /api/fields/:id | PATCH /fields/{field_id} | FieldReviewRequest(value?, confirm=true) → ReviewedField | D | 501; no field mutation. |
| GET /api/completeness?task= | GET /completeness | task, coverage_id? → CompletenessReport | D | 501; missing fields never imply excluded benefits. |
| DELETE /api/documents/:id | DELETE /documents/{document_id} | DeleteConfirmation(confirm=HAPUS) → DeletionResult | — | 501 after ownership; no false deletion success. |
| DELETE /api/data | DELETE /data | DeleteConfirmation → DeletionResult | — | 501; complete storage cleanup unavailable. |
| GET /api/home/summary | GET /home/summary | — → HomeSummary | — | 501; existing dashboard continues using record/assessment endpoints. |
| POST /api/ask | POST /ask | AskRequest → AskAnswer or EmergencyRedirect; SSE contract | D+A | 501; no LLM, triage or streaming engine. |
| POST /api/pathways/compare | POST /pathways/compare | PathwayComparisonRequest → PathwayComparison or EmergencyRedirect | D | 501; no medical logic or cost calculation. |
| POST /api/claims | POST /claims | ClaimCaseCreate(path,coverage_id) → ClaimCaseCreated | D | Live demo case creation after coverage ownership; duplicate draft/path/coverage returns 409. |
| GET emergency directory | GET /emergency | country_code → EmergencyDirectory | — | Live public CN/ID source-verified contact directory; unverified country contacts return []. |
| POST /api/triage | POST /triage | TriageRequest(text,country_code?) → TriageResult | — | Live session-scoped positive phrase escalation for verified CN/ID terms. Separate medical and self-harm flows; screening_complete is always false, so no match is never clearance. No raw text in audit. |
| GET /api/claims | GET /claims | status?, limit=20, offset=0 → ClaimCasePage | — | Live demo scoped list; checklist and consistency arrays remain empty until verified processing exists. |
| GET /api/claims/:id | GET /claims/{claim_case_id} | UUID → ClaimCaseDetail | — | Live demo scoped detail and factual timeline; nullable sandbox reference/status/last check remain empty without a real response. Foreign/missing IDs return 404. |
| POST /api/claims/:id/evidence | POST /claims/{claim_case_id}/evidence | multipart file → EvidenceMatchResult | D+A | 501 after ownership; no pipeline. |
| POST /api/claims/:id/draft-form | POST /claims/{claim_case_id}/draft-form | — → ClaimDraftAction | D | 501 after ownership; literal status is `pending` per API CSV. |
| GET /api/actions | GET /actions | — → ProposedAction[] | D | Live demo scoped queue of persisted actions. |
| POST /api/actions/:id/approve | POST /actions/{action_id}/approve | ActionDecisionRequest? → ActionDecisionResult | D | Live for valid pending claim-submit actions with explicit confirmation and reviewed payload hash; edited payload remains 501. |
| POST /api/actions/:id/reject | POST /actions/{action_id}/reject | ActionDecisionRequest? → ActionDecisionResult | D | Live persisted rejection after ownership. |
| GET /api/audit?type= | GET /audit | type?, event_type?, limit?, offset → AuditEvent[] | — | Existing functional array retained; optional bounded pagination and X-Total-Count. |
| Tool classify_document / extract_text_or_ocr / extract_to_schema / check_completeness | Internal only | Pydantic document/field/completeness schemas | D+A for external processing | Deferred pipelines, no tool runtime. |
| Tool retrieve_clause / rules_engine / compare_paths / gap_matrix (P1) | Internal only | Pydantic evidence and assessment schemas | Feature-specific guards | Only deterministic existing visa interval works; rest deferred. |
| Tool triage_check / draft_claim_form / create_reminder / draft_message / hash_to_testnet (Bonus) | Internal only | Typed request/action boundaries | Feature-specific + separate execution approval | No execution; bonus deferred. |

Story-derived routing specifications (not listed in API CSV):

| Story | Canonical proposed path | Contracts / status |
| --- | --- | --- |
| US-01-01..02 | POST /auth/register, /auth/login | RegisterRequest/LoginRequest → AuthSession; public 501, no credentials persisted. |
| US-01-02 | GET /auth/google, /auth/google/callback | Live Google authorization-code + PKCE flow; creates/updates an account and returns a browser handoff token in the URL fragment. |
| US-01-01..02 | POST /auth/verify-email, /auth/resend-verification, /auth/password-reset | VerificationRequest/EmailRequest → AuthMessage; public 501. |
| US-01-02 | POST /auth/logout; GET /auth/me | Live bearer account-session lookup and revocation. Demo session is never an account. |
| US-12-02 | GET /data | DataInventory; scoped 501, no invented counts. |
| US-14-01..02 | GET /coverage-needs | CoverageNeed[]; D; 501. Legacy /assessments/coverage-needs retained. |
| US-11-02 | GET /audit/{event_id} | AuditEvent; owned 501 detail boundary. Existing list remains functional. |
| US-10-03 | POST /actions/{action_id}/execute | ProposedAction; D + owned persisted approval and payload hash; 501 even when approved. No execution. |
| US-10-04 | POST /sandbox/insurer/claims | SandboxClaimRequest → SandboxClaimResponse; D + owned approved action/hash and referenced claim/doc IDs; 501. No simulator. |

Compatibility endpoints retained: `/health`, GET `/countries`, GET `/demo/personas`, POST `/demo/sessions`, GET `/demo/sessions/me`, GET/PUT `/consent`, GET `/insurance/record`, GET `/assessments/visa-gap`, GET `/documents`, POST `/documents/upload`, GET `/assessments/completeness`, GET `/assessments/coverage-needs`, POST `/chat/ask`, POST `/care/compare`, POST `/claims/draft`. Legacy AI-capable stubs now require separate external_ai consent; old boolean grants document processing only.

Shared schema conventions: `ApiError(code,message,details,request_id)` for every failure; validated positive pagination bounds, UUID object IDs, inclusive date ranges, decimal-string money; no unverified quote is a FROM_DOCUMENT answer. OpenAPI documents future 2xx shapes without claiming implemented success. SSE is documented as named events, each carrying a JSON AskStreamEvent; the client exposes a native byte stream, with no business parser or fake responses.

## Request/response field audit (17 October 2026)

All 21 expanded HTTP operations were reviewed against the API CSV and relevant story/data rows, including nested fields. The route manifest preserves the original summaries; it does not substitute for this review. `test_payload_contracts.py` protects the transcribed fields, nested array references, literals, optionality and limits. No stub was changed to return fabricated success.

| Operation(s) | Request and response field findings |
| --- | --- |
| POST consents | `purpose` is the exact lower-case three-purpose enum; `granted` is a strict boolean. Additional `policy_version` defaults to 1.5. Response includes id, purpose, granted, policy_version, granted_at, revoked_at, updated_at; ownership is server context rather than caller-supplied user_id. Revoked/never-granted timestamps may be null. |
| PUT profile | All six API fields exist: employment_status, dependents, city, owned_coverage, priorities, budget_range. Profile metadata is optional for incremental draft updates; omitted values are preserved for same-country updates, nullable fields may be cleared. Core display_name/residence_context/country_code/occupation cannot be cleared. Lists remain bounded (dependents 6, owned_coverage 20, priorities 2). Response requires `profile` and `suggested_docs` (max 6); each suggestion has document_type, label, requirement_level and nullable source_url. Only the selected country's VERIFIED versioned resource is projected; both shipped KBs return []. |
| POST documents; GET document | Multipart requires one `file`; `kind` is optional. Accepted result requires document_id and status. Detail requires status, kind, injection_flag, fields, plus id and country_code. fields[] contains id, document_id, field_key, value, previous_value, source_page, confidence, status, confirmed_by_user, source_evidence and updated_at. Values are JSON (including null); page >=1 or null; confidence 0..1 or null. Evidence preserves document_id/page_number/original_text/source_field. FOUND requires a value and either user confirmation or confidence >=0.8 with evidence; actual upload/extraction/source verification is deferred. |
| PATCH field | `confirm` is required literal true; `value` is optional JSON. Omission and explicit null remain distinguishable via model_fields_set. Response is the same ReviewedField shape used in document fields, retaining previous_value and provenance. No mutation is implemented. |
| GET completeness | Required task query; optional coverage_id is scoped. ready_pct is integer 0..100; items[] includes field_key, status, nullable suggested_doc and optional source_evidence/rule_source. Unknown values remain unknown. |
| DELETE document; DELETE data | Body requires exact confirm="HAPUS"; prospective response requires deleted=true. Both always return 501 after guards; deletion is never reported as successful. |
| GET home summary | No request body. active, expiring_30d, needs_verification are nonnegative counts; recommendations has max 3 items with rule_id, title, explanation and nullable source. No recommendations are computed. |
| POST ask | Required question length 1..500; optional scoped coverage_id is additive. JSON result contains answer_points (max 5) with required text, label and citations[]; each citation requires doc UUID, positive page, nonempty quote. FROM_DOCUMENT requires citations. Additional warnings defaults to []. Alternative requires redirect="emergency". SSE uses named answer_point/complete/redirect/error events with a discriminated JSON AskStreamEvent payload; this resolves the PRD's unspecified framing. No actual stream or answer is produced. |
| POST pathways compare | Required complaint length 1..300 and service_type; city is optional/nullable to allow a future profile default. paths[] has name, steps, requirements, est_out_of_pocket, docs, uncertainties, sources plus pathway_code and optional coverage_id. Cost is nullable; when present it requires decimal-string minimum/maximum, original currency and a RuleSource; maximum >= minimum. Sources carry country_code/kb_version/rule_id/source_url/checked_at/verification_status. Alternative emergency redirect is identical to ask. No estimates/routing are computed. |
| POST claims; POST triage | Claim body requires path and owned coverage_id; result requires claim_case_id. Claim creation is live for demo sessions with document-processing consent; duplicate active drafts return 409. Triage requires text length 1..500 and optional supported country_code; positive matches carry id/kb_version/category/source_url, safety_flows and screening_complete=false. It performs limited deterministic phrase escalation, not clinical triage. |
| GET claims; GET claim detail | The combined API row specifies case + checklist. Detail adds consistency_checks and persisted timeline events. Case includes nullable claim_ref, sandbox_status, last_checked_at and monitoring_state. These remain null/NOT_CONFIGURED without integration. checklist[] requires item_key, required, nullable rule_source, status and optional document_id. List uses items[] of the same detail shape plus pagination(limit,offset,total). Optional status filter and bounded limit 1..100/offset >=0 are additive. |
| POST claim evidence; POST draft-form | Evidence requires multipart file, and result matched_items[] reuses CaseChecklistItem. Draft-form has no body and returns action_id with exact lower-case literal status="pending". No evidence matching, case transition or action creation occurs. |
| GET actions; POST approve/reject | The demo queue returns owned persisted ProposedAction rows and a proposed payload hash. Legacy action rows may have null created_at/payload_version. Approval requires confirmed=true plus the hash displayed during review, validates the owned claim and attachments, persists status/time/hash and audits the decision. Rejection persists status and clears approval. Edited payload remains 501; execution remains 501 even after approval. Decision result contains only status (ActionStatus). |
| GET audit | Optional type alias maps answer/compare/action/guardrail/deletion/consent; exact event_type remains supported. Masked array elements retain id, session_id, event_type, outcome, metadata, created_at. Operational metadata allow-list excludes raw questions/values/tokens. Optional limit/offset and X-Total-Count preserve the original array; absent limit remains unbounded for compatibility. |

### Compatibility and deliberate normalizations

- **PUT /api/v1/profile success response changes** from a bare UserProfile to `{profile,suggested_docs}`. External PUT consumers must read `.profile`. The existing frontend only reads GET, whose bare shape is unchanged. Full legacy PUT request bodies still work; partial PRD bodies now work, with validation against the merged profile before persistence. JSON profile storage needs no new migration.
- Claim list items now include the case/checklist envelope; action decision success schemas narrow to `{status}`; draft-form status changes to `pending`. Those operations have always returned 501, so no working product success response is removed. The generated contracts intentionally change for future consumers. Legacy `/claims/draft` and GET actions keep their established DTOs.
- Data-tab examples use lower-case enums. Existing domain values stay uppercase: queued/processing/done/failed → QUEUED/PROCESSING/COMPLETED/FAILED; found/unverified/missing/not_applicable → FOUND/UNVERIFIED/MISSING/NOT_APPLICABLE; complete/missing/needs_check → COMPLETE/MISSING/NEEDS_CHECK; pending/approved/rejected/completed/failed → ActionStatus uppercase. residence/occupation/certainty/claim lifecycle follow the documented uppercase enums. Purpose values and the API's explicit draft `pending` and redirect `emergency` literals remain lowercase. Stored statuses are never rewritten.
- Source CSV objects are compact summaries rather than complete JSON Schemas. UUIDs, source structures, decimal cost ranges, pagination, SSE framing and extra provenance fields are explicit technical normalizations. Budget remains a nullable string, dependents/owned_coverage remain string arrays; employment_status remains optional free text, separate from legacy occupation. They do not authorize an eligibility/recommendation engine.
- Single-file multipart contracts are preserved; a future multi-file UI must issue individual requests or explicitly revise the contract. Size/MIME/batch constraints, review algorithms, retention cleanup, real authentication, detailed claim histories and feature-specific workflows remain deferred. Stronger consent/session checks described above are intentional security boundaries. No verified medical/regulatory facts or external integrations were added.

Country-context integration follow-up: country switches clear omitted residence/visa/budget fields, while same-country updates preserve omitted values and explicitly supplied destination values remain accepted. Original insurance/document countries are immutable under profile updates. Country mismatches produce NEEDS_VERIFICATION with no gap; full rationale and KB prerequisites are in [COUNTRY_INTEGRATION.md](COUNTRY_INTEGRATION.md). API request/response shapes remain unchanged.

## Adaptive protection plan (maintainer-authorized additive contract)

| Method | Path | Status | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/protection-plan` | live | Actor bearer or demo session | `PersonalProtectionPlan {country_code, health_profile_used, document_evidence_used, findings[], product_candidates[], overall_summary, limitations[]}` |

The endpoint does not require document or health consent. It omits those data sources when their current purpose grant is false. Product candidates always carry an official source URL, verification state, eligibility state, pricing availability and limitations. `UNKNOWN` eligibility and missing pricing must stay explicit.
