**BLOCKING**

1. MapSection skip is not fully pinned from the outside. The implementation gates the whole section and the hotels half correctly in [conference-detail.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:222>) lines 222-271, but the tests would still pass if either of these regressions landed:

- Delete only the hotels-half gate at line 235: the “hotels empty but map present” test in [conference-detail.test.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:307>) lines 307-315 still passes, because it asserts hotel names are absent but does not assert the hotels-description copy is absent.
- Delete only the whole-section early return at line 231: the “neither map nor hotels” test in [conference-detail.test.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:317>) lines 317-328 still passes if an empty `<section>` wrapper renders.

This violates the Branch 4 `prove-it-works` target in [registration-launch-plan.md](/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:150) lines 150-160.

2. Hero CTA gates are only partially covered. The component has separate mobile and desktop render paths for register/schedule buttons: [conference-detail.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:111>) lines 111-126 and [conference-detail.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:197>) lines 197-212. The skip tests render desktop by default via [conference-detail.test.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:90>) lines 90-96.

The schedule test correctly asserts the label, not just the missing href, in [conference-detail.test.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:344>) lines 344-355, but only for desktop. The mobile schedule gate could be deleted and tests stay green.

The register skip test in [conference-detail.test.tsx](</Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:330>) lines 330-341 checks the RegistrationSection title and RegFox href, but not the hero label `registration.register` from [translations.ts](/Users/cvr/Developer/personal/gyc/app/lib/localization/translations.ts:143). A regression that renders `<a href={undefined}>Register</a>` in the hero would pass.

**CONCERNS**

- The real boundary projection is covered separately: [content.server.test.ts](/Users/cvr/Developer/personal/gyc/app/lib/content.server.test.ts:229) lines 229-253 pins 2026 RegFox-only and 2025 cancelled data, and [defaults.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts:305) lines 305-364 matches that shape. The Branch 4 render tests are component-level, not full route/runtime proof.
- Schema strictness looks correct: [schema.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:34) lines 34-38 defines strict bilingual `Text`, [schema.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:395) lines 395-399 makes hotel `name` required, and [schema.test.ts](/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts:493) lines 493-541 proves malformed present hotels fail while a complete hotel decodes.
- Targeted verification passed: `bun test app/lib/content.server.test.ts 'app/routes/($lang)+/conference-detail.test.tsx' app/lib/content/schema.test.ts` → 65 pass, 0 fail. I did not run the full build gate.

**Evidence Reviewed**

Plan/brief/diff: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`, `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`, `/Users/cvr/Developer/personal/gyc/docs/.counsel/section-skip-WHOLE.diff`.

Code/tests: `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx`, `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts`, `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts`, `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts`, `/Users/cvr/Developer/personal/gyc/app/lib/content.server.test.ts`, `/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts`, `/Users/cvr/Developer/personal/gyc/app/lib/localization/translations.ts`, `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx`, `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx`, `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx`.

**VERDICT**

Not launch-ready yet: the implementation appears correct, but Branch 4 does not fully realize its `prove-it-works` contract until the MapSection and hero CTA gate tests catch the regressions above.

**Let Me Take More Off Your Plate**

- Next actions I can do right now: patch the missing outside-in tests and rerun targeted + full gate.
- Automations or systems I can set up: add a small regression checklist for “undefined href” and empty-section gates.
- Things to delegate to your team: have someone runtime-smoke `/2025`, `/fr/2025`, `/2026`, `/fr/2026` after the test patch lands.