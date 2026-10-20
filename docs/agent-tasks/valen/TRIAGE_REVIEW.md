# Country safety content review

**Draft checked 20 October 2026.** The current master runtime allowlist is `CN,ID`; this integration keeps it unchanged. New Indonesian rules below remain `UNVERIFIED` and are ignored by strict screening; current ID Q&A continues to use only existing verified ID rules. The AU resources remain inactive drafts and do not expand runtime scope.

## Sources and rules requiring approval

| Draft | Source | Candidate rules or number | Runtime status |
| --- | --- | --- | --- |
| ID red flags | [Kemenkes Decision HK.01.07/MENKES/796/2019 (PDF)](https://jdih.kemkes.go.id/storage/documents/pdfs/2019kepmenkes796.pdf) | Unconsciousness/decreased consciousness; abnormal breathing; bleeding not controlled with direct pressure; seizure still in progress or a first seizure with no known history. English phrases are translations. | Four new per-rule entries are `UNVERIFIED` and not used by triage until approved. |
| ID emergency | [Kemenkes PSC 119 service](https://kemkes.go.id/id/layanan/psc-119) | `119` is already present as a verified medical contact in current master KB. This PR adds no ID emergency number. Master contacts `112`, `119`, `110`, and `113` are preserved. | Existing KB entries remain unchanged. |
| AU red flags and emergency | [Healthdirect: Calling triple zero (000)](https://www.healthdirect.gov.au/healthcare-and-services/emergency-and-urgent-care/calling-triple-zero) | Loss of consciousness, chest pain, breathing problems, seizure, uncontrolled bleeding; `000`. Indonesian phrases are translations. | All draft entries and `000` remain `UNVERIFIED`; AU is inactive. |

The candidate ID phrases are `tidak sadar` / `penurunan kesadaran`; `kesulitan bernafas` / `tidak bernapas secara normal` / `tidak bernafas normal`; bleeding that cannot be controlled with direct pressure; and a seizure still in progress or a first seizure with no known history. Each entry records the JDIH PDF URL, `checked_at: 2026-10-20`, jurisdiction `ID`, and `verification_status: UNVERIFIED`.

The Kemenkes PDF describes call-center operator assessment. Its chest-pain section requires additional context, so chest pain is not added as a standalone ID rule. Maintainers should confirm the PDF is current and appropriate for this consumer phrase-matching screen, review the Indonesian/English wording and destinations, and decide whether additional questions are necessary. The page check date records inspection only; it is not clinical approval.

The existing `RedFlagConfig` schema supports per-rule source URLs, checked dates, jurisdiction, evidence class, and verification status. The ID resource now carries the new rules individually as unverified. Strict screening skips unverified rules while requiring the country resource itself to have reviewed metadata; it never treats a non-match as medical clearance (`screening_complete` stays false).

## Maintainer checklist

- [ ] Confirm the current master runtime scope remains CN/ID. Do not activate AU or substitute its rules without a separate team decision.
- [ ] Re-open the Kemenkes PDF; approve or edit each of the four ID rules, their language translations, and the `emergency` destination. Confirm operator-only steps are safe to reduce to phrase matches; do not add standalone chest pain without preserving source-required context.
- [ ] Confirm `jdih.kemkes.go.id` remains an acceptable source host and that the checked date should be refreshed at approval.
- [ ] Confirm current use and locality/coverage caveats for master ID contacts `112`, `119`, `110`, and `113`. `119` is already listed from the [PSC 119 service](https://kemkes.go.id/id/layanan/psc-119); no second number is introduced here.
- [ ] If AU is proposed for a future scope, review the Healthdirect triggers, Indonesian translations, `000`, and its availability caveats before adding AU to `ACTIVE_KB_COUNTRIES`.
- [ ] Add reviewed positive and negative test cases for each approved rule, including bilingual phrases, negation, contextual chest pain, and phrases that must not trigger.
- [ ] Mark only individually approved ID entries `VERIFIED`. Approval is required before the new ID rules can trigger triage or emergency routing; existing reviewed rules remain active. Missing or resource-level unverified data continues to return `TRIAGE_UNAVAILABLE`. Emergency contact approval is a separate gate.
