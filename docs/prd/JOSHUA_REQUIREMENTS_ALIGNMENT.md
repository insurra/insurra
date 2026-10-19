# Joshua design and requirements alignment

This document records how the supplied Joshua requirements and approved visual references fit the current application. It distinguishes implemented demo functions from deferred product workflows. The standalone HTML prototype stores fictional data in browser `localStorage`; its sandbox receipt and file proof are demonstrations only. None should be copied into the application as real outcomes.

The original local PRD CSVs (Summary, Daftar Screen, Kontrak API, Requirement, Skema Data) were not present during this review. They are required immutable references; the tracked manifest and existing PRD mappings were used for orientation, but this document does not replace a source-CSV conformance check. Run `make check-prd-source` when the CSVs are available.

## Design inputs

The supplied `APPROVED_DESIGNS.html` identifies six original approved screen images: Emergency Guidance, Claims Center parent, Claim Detail, Claim Draft, Action Approval, and Activity & Audit. The nine `previews/*.png` files show the separate working HTML prototype and are not pixel-identical approvals. Employer Benefits, Compare Plans, and Integrity Proof have prototype layouts but no individually approved artwork. These files are design references, not runtime data, source-verified medical or insurance facts, or permission to activate deferred workflows.

## Route and capability map

| Joshua surface | Intended frontend route | Current application | Foundation API / data boundary | Activation prerequisite |
| --- | --- | --- | --- | --- |
| Emergency Guidance (SC-08) | `/emergency` | Country-selected CN/ID official contacts and limited tri-lingual phrase escalation live | Public `GET /api/v1/emergency` emits only source-verified contacts. Session `POST /triage` returns positive medical/self-harm safety-flow matches; `screening_complete=false` means no-match is never clearance. AU contacts remain empty. Ask/pathway redirects remain 501. | Broader clinical review, local coverage validation, and integration with ask/pathway surfaces. |
| Claims Center parent (US-09-05) | `/claims` | Demo case list, search/filter and manual creation live | `GET/POST /api/v1/claims` use owner-scoped persisted cases. New cases start DRAFT with no inferred checklist. | Account actor support and validated case requirements. |
| Claim Detail and tabs (SC-09) | `/claims/[id]` | Owned case detail and stored timeline live; evidence tabs show honest unavailable states | Detail returns scoped case, persisted creation/decision events, and nullable sandbox tracking fields. Checklist/consistency arrays stay empty. Evidence/draft-form remain 501. | Persisted checklist, original evidence, source references, verification, conflict handling, and real sandbox status sync. |
| Action Approval (SC-10) | `/actions` | Demo queue and approve/reject UI live | Queue is owner scoped. Approve requires explicit confirmation and the hash shown to the reviewer; the server persists decision/hash. Edit, execute and insurer sandbox return 501. | A trusted action producer, edit/version review workflow, account actor support, real sandbox integration, idempotency and actual receipt. Never show execution success from local simulation. |
| Activity & Audit (SC-11) | `/audit` | Scoped demo audit list/filter live | Existing list and category/event filters are live for demo sessions; detail is 501 after owner check. | Case/action events, safe detail view, account actor support, pagination UI and redaction review. |
| Employer Benefits (SC-15) | `/employer-benefits` | Informational placeholder | No verified benefit coordination engine or employer policy extraction result. | Verified document-backed terms and explicit uncertainty for missing usage/coordination rules. |
| Product Comparison (SC-17) | `/products/compare` | Planned | No live comparison or ranking contract. | Verified product provenance, currency/period, ranking basis and commission disclosure. Unknown attributes remain unknown. |
| Document Integrity Proof (SC-19) | `/proof` | Planned bonus | No testnet anchoring or receipt. | If pursued, byte-level hash and verified transaction/explorer receipt; a local SHA-256 alone proves neither document authenticity nor on-chain anchoring. |

The standalone prototype's hash routes such as `/#/claims/.../draft` are not canonical application routes. Claim Draft is a tab of `/claims/[id]`, as recorded in the supplied requirement; no separate application route is needed. The approved sidebar has Claims Center and Activity & Audit as primary entries, with Emergency Guidance reached contextually. Existing working demo URLs stay in place; see `SCREEN_ROUTES.md`.

## Contract decisions to preserve

- Use `/api/v1` and generated TypeScript from Pydantic/OpenAPI. The supplied suggested `/api/...` endpoint list and prototype's local state are proposals, not additional live APIs.
- Existing canonical claim creation requires an owned `coverage_id` and `path`. Manual case creation in the supplied requirement needs a contract decision for users without a selected pathway; do not silently invent a pathway or weaken ownership checks.
- Claim list items carry `{case, checklist, consistency_checks, timeline}`. Draft-form's future success literal is `pending`; approval/rejection success shapes are status-only. New sandbox-specific enum names are available in the contract, but no sandbox status is written without a real receipt or status response.
- Required evidence can be missing, uploaded, extracted, or verified. Readiness must count only explicitly satisfied required items, keep conflicts visible, and never turn an unverified upload into a verified field or insurer eligibility finding.
- An action decision must be actor-owned and bound to the exact canonical server payload hash. Editing the payload requires new review. A submitted, executed, or successful state requires a real authorized response; all executors currently remain 501.
- `process_documents`, `external_ai`, and `retention` are independent current database grants. Evidence processing that can use AI requires both document and external-AI grants. Consent never follows from opening a page.
- CN emergency 110/119/120 uses the [Beijing Communications Administration source](https://bjca.miit.gov.cn/zwgk/tzgg/art/2022/art_8d4eb93ee3424f30826c97ee400e8937.html). ID 112/110/113 uses [Komdigi](https://layanan112.komdigi.go.id/tentang) and medical 119 uses [Kemenkes](https://kemkes.go.id/id/layanan/psc-119); 112 coverage depends on the local government implementation. The Singapore numbers and clinical examples in the reference images remain visual copy, not facts for this repository.
- Preserve original evidence, currency, and country. Missing information is not exclusion. Do not present fictional receipts, provider submissions, diagnoses, prices, or legal conclusions as user records.

## Current handoff state

The current demo can create and list a case, read its detail and factual timeline, display a scoped action queue, persist approval/rejection of an existing valid action, and audit those decisions. Source-verified emergency contacts and positive-only red-flag phrase matching are available for CN/ID; self-harm risk follows a separate support message. The matcher is not medical triage, diagnosis, or proof that unmatched text is safe. Create Claim → Evidence → Draft → Queue remains disconnected: no verified requirement generator, evidence processor, or trusted action producer exists. Execute, sandbox status sync, polling/webhooks, follow-up dispatch, and Receipt remain 501 or inactive because no official sandbox endpoint, authentication, or receipt format was supplied. The five original PRD CSVs are still missing, so payload-shape conformance against those sources remains open. Account-session claim/action support, employer benefits, comparison and proof are outstanding. No team ownership or branch assignment is implied.

## Revisi final PBI (19 October 2026)

| PBI | Implemented now | Remaining activation boundary |
| --- | --- | --- |
| US-08-01/02/03 | CN/ID sourced contacts, three-language positive phrase matches, separate self-harm support response, and non-blocking later-document guidance. | Wider clinical language review and ask/pathway emergency redirects. |
| US-09-01–04 | Claim case and original-evidence contracts retained; missing evidence is never counted as verified. | Source-specific fapiao requirements, secure upload/OCR, deterministic matching and draft generation need verified insurer procedures and original documents. |
| US-09-05 | Owner-scoped case timeline, nullable sandbox reference/status/last check, explicit NOT_CONFIGURED monitoring state, and sandbox-specific status labels. | Actual submission receipt, status sync, scheduler/webhook, change detection, missing-evidence tasks, retries and follow-up need a supported sandbox API. No scheduled job is created now. |
| US-10-01–04 | Stored queue and exact payload-hash approval/rejection. | Trusted multi-type action producer, recipient/attachment review, edit invalidation, idempotent outbound execution and receipts need destination contracts. All execution returns 501. |
| US-11-01/03 | Case creation and action decisions produce scoped operational audit/timeline events without raw document values. | Execution, blocked-request and follow-up receipt events require those workflows; audit detail remains 501. |
| P1 benefit/travel/product changes | No fabricated primary/secondary payer, travel rule, product rank or commission result. | Source-backed CN/ID benefit and product data plus account workflow contracts. |

Every verified emergency contact and active red-flag phrase now records source URL, jurisdiction, checked date and verification status in the country KB. Other country KB facts retain their existing verification status and cannot become definitive conclusions from this emergency update.
