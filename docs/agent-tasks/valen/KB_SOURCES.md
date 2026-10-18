# Country configuration sources and activation boundaries

Checked 18 October 2026. Resource/manifest version is now 0.3.0. Existing shared emergency, red-flag, extraction, task and other resource data is unchanged; only the envelope version was synchronized. They remain UNVERIFIED. `example_questions.json` adds questions, not coverage claims.

The AU student-cover recommendation uses the [Commonwealth Ombudsman OSHC fact sheet](https://www.ombudsman.gov.au/__data/assets/pdf_file/0025/88324/Factsheet_student_OSHC.pdf), reviewed on 18 October 2026. It describes student-visa insurance timing and exceptions. The configured applicability is abroad/student context; the UI explicitly asks the user to verify individual visa conditions and exceptions. It does not decide whether an individual breached a visa condition. Only this checked source is enabled for the regulatory recommendation. Other recommendation rules are product heuristics, visibly unverified where they lack an official reference.

Country context supplies IANA city timezones and an explicit official-source host allow-list. A host alone never verifies a rule: source URL, check date and verification metadata are also required. Emergency numbers and red flags remain disabled until their shared resources are reviewed. No numbers, symptoms, tariffs or policy clauses were invented to activate them.

Policy-document quotes and regulatory references are separate evidence. Original Raka/Sinta placeholder text remains untouched. Tests use a separately named FICTIONAL TEST POLICY and cannot establish real insurance benefits.
