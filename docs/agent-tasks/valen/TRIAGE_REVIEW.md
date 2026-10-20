# AU/ID triage and emergency content review

**Draft checked 20 October 2026. All proposed KB content remains `UNVERIFIED`.** The repository's supported country scope is AU and ID. The resources were advanced to country version `0.3.1` so audit records can distinguish this draft from `0.3.0`.

## Sources and draft rules

| Country | Source | Candidate trigger rules in `red_flags.json` | Emergency number candidate |
| --- | --- | --- | --- |
| AU | [healthdirect: Calling triple zero (000)](https://www.healthdirect.gov.au/healthcare-and-services/emergency-and-urgent-care/calling-triple-zero) | Loss of consciousness; chest pain; breathing problems; seizure; uncontrollable bleeding. These are the source's ambulance examples. Indonesian phrases are draft translations. | `000`, from the same page. |
| ID | [Kemenkes Decision HK.01.07/MENKES/796/2019 (PDF)](https://jdih.kemkes.go.id/storage/documents/pdfs/2019kepmenkes796.pdf) | Unconsciousness/decreased consciousness; difficulty or abnormal breathing; bleeding that cannot be controlled with direct pressure; seizure still in progress or first seizure with no known history. The PDF's case tables include additional assessment questions and context; these candidate phrase matches do not reproduce the full operator algorithms. English phrases are draft translations. | `119`, also named as the NCC/PSC emergency access code in the decision. |

The AU page says `000` is Australia's national emergency service number and lists the symptoms above as examples for an ambulance. The Kemenkes decision describes an algorithm for NCC/PSC 119 call-center operators. Its chest-pain section asks additional questions and associates the red category with accompanying signs, so **chest pain is deliberately not a standalone ID trigger in this draft**. The separate [Kemenkes PSC 119 service page](https://kemkes.go.id/id/layanan/psc-119) is the current official service reference for the `119` candidate. Maintainers must confirm applicability, current reachability, locality/coverage, and whether operator-only algorithms can safely support a phrase-matching guardrail.

The exact phrase candidates that need review are:

- **AU** — `loss_of_consciousness`: ID `kehilangan kesadaran`, `pingsan`; EN `loss of consciousness`, `fainting`. `chest_pain`: ID `nyeri dada`; EN `chest pain`. `breathing_problems`: ID `masalah pernapasan`, `kesulitan bernapas`, `sesak napas`; EN `breathing problems`, `difficulty breathing`. `seizure`: ID `kejang`; EN `seizure`. `uncontrolled_bleeding`: ID `perdarahan tidak terkendali`; EN `uncontrollable bleeding`.
- **ID** — `unconsciousness`: ID `tidak sadar`, `penurunan kesadaran`; EN `unconscious`, `loss of consciousness`. `abnormal_breathing`: ID `kesulitan bernafas`, `tidak bernapas secara normal`, `tidak bernafas normal`; EN `difficulty breathing`, `not breathing normally`. `uncontrolled_bleeding`: ID `perdarahan yang tidak dapat dikendalikan dengan penekanan langsung`, `pendarahan yang tidak terkendali setelah dicoba untuk ditekan`; EN `bleeding that cannot be controlled with direct pressure`. `critical_seizure_context`: ID `korban masih kejang`, `kejang pertama kali dan tidak diketahui riwayat kejang sebelumnya`; EN `still having a seizure`, `first seizure with no known previous history`.

For AU, the Indonesian phrases are translations. For ID, the English phrases are translations. Each translation needs language/clinical review before activation.

The `RedFlagConfig` schema has only `id`, `category`, `phrases_id`, `phrases_en`, and `destination_code`; source, date, and review status exist only on the resource envelope. Therefore each country's `red_flags.json` has one source URL, `checked_at: 2026-10-20`, and `verification_status: UNVERIFIED`, applying to every entry. The emergency number candidates are stored in the existing `emergency.json` and nested `pathways.json` emergency shapes with source/date and `UNVERIFIED` status. The ID manifest now includes `jdih.kemkes.go.id` in its official-source host allow-list for the supplied JDIH PDF; the manifest remains unverified. No per-rule verification or source metadata was added.

The check date records when these source pages were inspected; it is not medical approval. These numbers and rules are review candidates, not active guidance. `triage_check` requires nonempty data plus a verified HTTPS source on the country's official-host allow-list. `emergency_info` also requires verified metadata. Consequently the draft phrases do not unlock Q&A/care and the candidate numbers are not exposed by the application.

## Maintainer approval checklist

- [ ] Confirm AU/ID remains the supported scope; do not substitute CN.
- [ ] Confirm `jdih.kemkes.go.id` is acceptable in the ID official-source host allow-list for this PDF.
- [ ] Re-open the AU Healthdirect page and approve or edit each listed trigger, its Indonesian phrase translations, and the `000` destination.
- [ ] Re-open the 2019 Kemenkes PDF and confirm it is still suitable/current for this use. Approve or edit each listed ID trigger, the English translations, and the `119` destination. Confirm that using a call-center operator guideline for this consumer phrase-match guardrail is acceptable. Keep chest pain contextual unless a reviewed rule can preserve the source's required questions/signs.
- [ ] Confirm the current Kemenkes PSC 119 page and the practical availability/coverage of `119`; confirm AU `000` availability and any locality caveats. Decide whether the product needs another officially sourced contact.
- [ ] Add at least 10 reviewed positive and 10 negative phrase cases per country, including bilingual phrasing, negation, contextual chest-pain cases, and phrases that must not trigger.
- [ ] After medical/language review, update the source/check metadata and mark each complete country resource `VERIFIED` only when all its entries and destination are approved. Keep unanswered items `UNVERIFIED` and unavailable.

For the API's `TRIAGE_UNAVAILABLE` gate, every supported country resource used for normal Q&A needs nonempty, approved red-flag data with `verification_status: VERIFIED`, a checked date, and an HTTPS source on its approved-host list. Both country resources must meet that bar before claiming AU/ID production coverage. Emergency-number approval is a separate prerequisite for exposing local contact information; SC-08 `/emergency` is still a separate missing product surface. Do not enable the live triage dependency as part of this review-preparation change.
