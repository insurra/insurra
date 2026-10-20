# Adaptive Profiling and Protection Plan

## Six-step profile

1. **Location & Identity** — residence, nationality and age range.
2. **Life Situation** — student/employment context and only the enrollment or work fields needed for eligibility.
3. **Health & Lifestyle** — optional broad healthcare access needs plus activity and travel exposure. Health details need the separate `health_profile` grant and offer Skip / Prefer not to answer.
4. **Family & Financial Context** — dependents, broad responsibilities, income range, emergency savings and monthly affordability. Exact income is not requested.
5. **Existing Protection** — public, university, employer and personally purchased cover, all self-reported until evidence is verified.
6. **Goals & Review** — up to two priorities, preference, budget and final correction before save.

The draft can be resumed and edited. Full medical records, complete education history and exact income are outside initial onboarding.

## Assessment levels

- **Protection needs:** deterministic rules explain why a category may apply.
- **Coverage findings:** verified evidence can mark a need met; self reports stay unverified; absent data stays unknown or a potential gap.
- **Product candidates:** only catalog records from the applicable country with an official HTTPS source can appear. Candidate matching is informational and never represents an offer, acceptance, exact premium or underwriting result.

## Consent boundary

`health_profile` defaults false and is independent of `process_documents`, `external_ai` and `retention`. Storing voluntarily disclosed health fields requires it. Revocation removes those fields. Future external AI processing of health data must check both `health_profile` and `external_ai` at the protected call.

## Current catalog limitation

The initial Indonesia candidates use official Allianz, Prudential and Manulife product pages. Their summaries are manually curated and remain unverified until the source artifact and version are retained and reviewed. Current insurer terms and quotation channels are the authority. An empty candidate list is valid when no current record passes the country, category and effective-date filters.
