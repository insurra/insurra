# Canonical API contracts

All business paths below have `/api/v1` prefix. A mapped future endpoint is an honest HTTP 501 contract after identity, consent and object scope checks; no business operation succeeds. Existing working endpoints retain their response shapes. Lowercase PRD purpose values remain lowercase; other legacy domain enums remain uppercase.

Consent notation: `D` process_documents; `A` external_ai; `—` no processing grant required. Every user-scoped route requires a validated demo session today. Authenticated-account actors are specified but not resolved. Foreign and absent object IDs both return 404; session failure is 401, purpose denial 403, then owned unimplemented operations return 501. Retention never grants AI permission.

| PRD method/path | Canonical path | Request → response | Consent | Status / difference |
| --- | --- | --- | --- | --- |
| POST /api/consents | POST /consents | PurposeConsentUpdate → PurposeConsent | — | Functional foundation; one explicit purpose and policy_version. GET /consents lists three purposes. |
| PUT /api/profile | PUT /profile | ProfileUpdate → UserProfile | — | Existing functional bare response retained; suggestions deferred. GET also remains live. |
| POST /api/documents | POST /documents | multipart file, kind? → DocumentUploadAccepted | D+A | 501; PDF/JPG/PNG and 10MB/10 files are future upload enforcement, not claimed implemented. |
| GET /api/documents/:id | GET /documents/{document_id} | UUID → DocumentDetail | D | 501 after ownership. |
| PATCH /api/fields/:id | PATCH /fields/{field_id} | FieldReviewRequest(value?, confirm=true) → ReviewedField | D | 501; no field mutation. |
| GET /api/completeness?task= | GET /completeness | task, coverage_id? → CompletenessReport | D | 501; missing fields never imply excluded benefits. |
| DELETE /api/documents/:id | DELETE /documents/{document_id} | DeleteConfirmation(confirm=HAPUS) → DeletionResult | — | 501 after ownership; no false deletion success. |
| DELETE /api/data | DELETE /data | DeleteConfirmation → DeletionResult | — | 501; complete storage cleanup unavailable. |
| GET /api/home/summary | GET /home/summary | — → HomeSummary | — | 501; existing dashboard continues using record/assessment endpoints. |
| POST /api/ask | POST /ask | AskRequest → AskAnswer or EmergencyRedirect; SSE contract | D+A | 501; no LLM, triage or streaming engine. |
| POST /api/pathways/compare | POST /pathways/compare | PathwayComparisonRequest → PathwayComparison or EmergencyRedirect | D | 501; no medical logic or cost calculation. |
| POST /api/claims | POST /claims | ClaimCaseCreate(path,coverage_id) → ClaimCaseCreated | D | 501 after coverage ownership. |
| POST /api/triage | POST /triage | TriageRequest(text) → TriageResult | — | 501; session required for this internal sensitive endpoint, no text processed. Future emergency screen remains public per PRD. |
| GET /api/claims | GET /claims | status?, limit=20, offset=0 → ClaimCasePage | — | 501; shared pagination envelope. |
| GET /api/claims/:id | GET /claims/{claim_case_id} | UUID → ClaimCaseDetail | — | 501 after ownership. |
| POST /api/claims/:id/evidence | POST /claims/{claim_case_id}/evidence | multipart file → EvidenceMatchResult | D+A | 501 after ownership; no pipeline. |
| POST /api/claims/:id/draft-form | POST /claims/{claim_case_id}/draft-form | — → ClaimDraftAction | D | 501 after ownership. |
| GET /api/actions | GET /actions | — → ProposedAction[] | D | Existing 501 retained, no queue business logic. |
| POST /api/actions/:id/approve | POST /actions/{action_id}/approve | ActionDecisionRequest? → ProposedAction | D | 501 after ownership; optional body preserves old requests. |
| POST /api/actions/:id/reject | POST /actions/{action_id}/reject | ActionDecisionRequest? → ProposedAction | D | 501 after ownership. |
| GET /api/audit?type= | GET /audit | type?, event_type?, limit?, offset → AuditEvent[] | — | Existing functional array retained; optional bounded pagination and X-Total-Count. |
| Tool classify_document / extract_text_or_ocr / extract_to_schema / check_completeness | Internal only | Pydantic document/field/completeness schemas | D+A for external processing | Deferred pipelines, no tool runtime. |
| Tool retrieve_clause / rules_engine / compare_paths / gap_matrix (P1) | Internal only | Pydantic evidence and assessment schemas | Feature-specific guards | Only deterministic existing visa interval works; rest deferred. |
| Tool triage_check / draft_claim_form / create_reminder / draft_message / hash_to_testnet (Bonus) | Internal only | Typed request/action boundaries | Feature-specific + separate execution approval | No execution; bonus deferred. |

Story-derived routing specifications (not listed in API CSV):

| Story | Canonical proposed path | Contracts / status |
| --- | --- | --- |
| US-01-01..02 | POST /auth/register, /auth/login | RegisterRequest/LoginRequest → AuthSession; public 501, no credentials persisted. |
| US-01-01..02 | POST /auth/verify-email, /auth/resend-verification, /auth/password-reset | VerificationRequest/EmailRequest → AuthMessage; public 501. |
| US-01-02 | POST /auth/logout; GET /auth/me | Logout eventually 204; current 501 after session. AccountSummary for future authenticated account; current 501. Demo session is never an account. |
| US-12-02 | GET /data | DataInventory; scoped 501, no invented counts. |
| US-14-01..02 | GET /coverage-needs | CoverageNeed[]; D; 501. Legacy /assessments/coverage-needs retained. |
| US-11-02 | GET /audit/{event_id} | AuditEvent; owned 501 detail boundary. Existing list remains functional. |
| US-10-03 | POST /actions/{action_id}/execute | ProposedAction; D + owned persisted approval and payload hash; 501 even when approved. No execution. |
| US-10-04 | POST /sandbox/insurer/claims | SandboxClaimRequest → SandboxClaimResponse; D + owned approved action/hash and referenced claim/doc IDs; 501. No simulator. |

Compatibility endpoints retained: `/health`, GET `/countries`, GET `/demo/personas`, POST `/demo/sessions`, GET `/demo/sessions/me`, GET/PUT `/consent`, GET `/insurance/record`, GET `/assessments/visa-gap`, GET `/documents`, POST `/documents/upload`, GET `/assessments/completeness`, GET `/assessments/coverage-needs`, POST `/chat/ask`, POST `/care/compare`, POST `/claims/draft`. Legacy AI-capable stubs now require separate external_ai consent; old boolean grants document processing only.

Shared schema conventions: `ApiError(code,message,details,request_id)` for every failure; validated positive pagination bounds, UUID object IDs, inclusive date ranges, decimal-string money; no unverified quote is a FROM_DOCUMENT answer. OpenAPI documents future 2xx shapes without claiming implemented success. SSE is documented as named events, each carrying a JSON AskStreamEvent; the client exposes a native byte stream, with no business parser or fake responses.
