**Blocking**

1. Missing 7.3 coverage for the new registration action boundary.

The flat `formAction` path is tested end-to-end for persist-first over the same in-memory bucket, including notify failure leaving `submissions/contact/<id>.json`. But registration deliberately does **not** use that flat skeleton; it has a separate `registrationAction` that decodes the `{ registrants: [...] }` shell, loops each registrant through `Submissions.persist`, then notifies. I found service-level registration shape coverage in `submissions.server.test.ts`, but no test that exercises `registrationAction` itself.

That leaves the 7.3-specific net-new server action unproven. Add a test that submits at least two registrants through `registrationAction` over one in-memory `Storage`, asserts two `submissions/registration/*.json` objects exist with the decoded payloads, and asserts notify receives the stored records. Also add the notify-failure variant for registration, because this path owns its own persist-first orchestration.

**Concerns**

- Registration multi-persist is sequential. If persist succeeds for registrant 1 and fails for registrant 2, the action errors after a partial durable write and no notification. Given the no-DB bucket design, this is not automatically a blocker, but it deserves an explicit test or comment once the registration-action test is added.

- I did not rerun the gate; I reviewed the prompt, plan, diff, and current source. The prompt reports `typecheck`, `lint`, `build`, and `bun test` clean except the known lint warning.

**Review Questions**

1. Scope fidelity: yes. The commit is scoped to runtime wiring, flat skeleton persist-then-notify, contact/volunteer notification migration, registration server action, route migration, translations, and tests.

2. Persist-first invariant: source order is correct in both paths. Flat path is tested soundly against the same in-memory bucket. Registration path is not tested directly, which is the blocker.

3. Registration split: sound. The array shell is not a flat field graph; keeping a small registration-specific action while reusing `routeFormAction`, `definitionToSchema`, and `Submissions.persist` is the right boundary.

4. Derive-dont-sync: clean. Registration decodes each registrant from `definitionToSchema(definition)` and persists through `Submissions.persist('registration', registrant)`, whose schema is also definition-derived.

5. Migrate-callers-then-delete: clean. The three `Effect.void` no-op actions are gone, all three year routes re-export the shared action, and `actionData?.result` matches the wrapped action shape.

6. Boundary discipline: clean. Notifiers now receive stored `Submission` records; contact/volunteer read `submission.payload`, and registration notification references persisted ids.

7. Test surface: incomplete for this slice. Flat skeleton is covered; registration action orchestration is not.

8. Behavior regression: contact/volunteer mailer bodies appear byte-identical except the source changes from decoded payload to `submission.payload`. Honeypot still short-circuits before the action body, so persist and notify are skipped.

9. Gate/principles: no new `any`, stubs, TODO bailouts, or commented-out implementation in the 7.3 diff. The `makeAppLayer` / `makeRequestRuntimeFromLayer` refactor is a legitimate proof seam, not unnecessary production widening.

**File References Used**

- `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-submissions-7.3/personal-gyc-42088828/20260617-220706-claude-to-codex-d6e039/prompt.md`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:260`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:264`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:274`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:276`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:281`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:54`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:56`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:123`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/action.ts:116`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/action.ts:131`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.ts:85`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.ts:100`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.ts:109`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/action.test.ts:214`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.test.ts:221`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/registration-route.ts:37`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/form/route.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/form/route.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/form/route.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/contact.tsx:86`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:97`
- `/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts:82`
- `/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts:184`