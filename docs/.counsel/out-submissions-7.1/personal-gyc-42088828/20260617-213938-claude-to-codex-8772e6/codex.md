**Verdict:** Clean. No blocking issues. Commit `8b40426` is correctly scoped to 7.1: it adds only the submission schema factory, envelope/id exports, and focused tests. I found no persist service, no `Storage.put`, no mailer, no route/action wiring, and no shared-module changes.

**Review Answers**

1. **Exact slice:** Yes. `git show --name-only` shows only:
`/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.ts`
`/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.test.ts`

2. **derive-dont-sync:** Yes. `submissionSchema(definition)` embeds `definitionToSchema(definition)` directly as `payload`, so there is no parallel per-form payload struct to drift. The factory is the right realization of the plan sketch because the payload cannot be known without a `FormDefinition`.

3. **Impossible states:** Envelope is watertight for the stated invariant: `ListItemId`, closed `FormId`, and real-calendar `IsoDate`. Tests reject off-list form, bad id, and invalid dates.

4. **Interface size:** `SubmissionEnvelope` is justified for this slice because it names and tests the form-independent metadata contract without needing the payload field graph. Minor non-blocking taste note: exporting lowercase `submissionEnvelope` is slightly more surface than strictly necessary today, but it is harmless and plausibly useful for 7.2 composition.

5. **Subtract-before-you-add:** Correctly add-only. The plan assigns mailer/action deletion to 7.3, not 7.1.

6. **Gate:** I did not rerun the gate in this read-only review environment. Based on the diff, I see no new `as never` / `as unknown as` casts, no tautological tests, and no obvious typecheck/lint/build/test break. The known cast is in prior `definitionToSchema`, outside this commit.

7. **Test surface:** Covered for 7.1: derivation, round-trip, envelope. It also proves payload tracks a second definition via a literal-choice definition, not just one contact-shaped case.

8. **Regression risk:** Net-new module, no callers, no shared-module edits, no export collision found. Existing behavior should not regress.

**Receipts**

Used these file references:

- `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-submissions-7.1/personal-gyc-42088828/20260617-213938-claude-to-codex-8772e6/prompt.md:1`
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/submissions-7.1.diff:1`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:260`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:1`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.ts:1`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.test.ts:1`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/decode.ts:495`
- `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/registry.ts:87`
- `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:218`
- `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:289`
- `/Users/cvr/.brain/principles/never-block-on-the-human.md:1`
- `/Users/cvr/.brain/principles/redesign-from-first-principles.md:1`
- `/Users/cvr/.brain/principles/derive-dont-sync.md:1`
- `/Users/cvr/.brain/principles/make-impossible-states-unrepresentable.md:1`
- `/Users/cvr/.brain/principles/small-interface-deep-implementation.md:1`
- `/Users/cvr/.brain/principles/subtract-before-you-add.md:1`
- `/Users/cvr/.brain/principles/prove-it-works.md:1`