**Verdict: Request changes**

Finding: `submissionKey` drops the `ListItemId` brand at the registry boundary.

- File: `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/registry.ts:121`
- Evidence: `submissionKey` is documented as derived from the closed `FormId` plus the submission’s `ListItemId`, but its signature accepts `id: string`.
- Why it matters: this weakens the 7.2 “derived key” invariant for every future caller. `Submissions.persist` currently passes a branded id, but the exported key helper permits `submissionKey('contact', '../bad')` or any arbitrary string. This violates the review rubric’s `make-impossible-states-unrepresentable` check and is easy to fix by typing `id: ListItemId`.
- Suggested fix: import `type ListItemId` from `../schema` in `registry.ts` and change the signature to:
  ```ts
  export const submissionKey = (form: FormId, id: ListItemId): string =>
    `submissions/${form}/${id}.json`;
  ```

**Review Questions**

1. Exact slice: mostly yes. No 7.3 caller migration, notify/orchestrator, or mailer changes leaked into this commit. No required deletion is owed in 7.2. The one issue is the `submissionKey` type hole above.
2. Module interface: `Submissions.Service` exposes exactly one operation, `persist`, at `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.ts:64-81`. The implementation hides definition lookup, schema derivation, id/date/key derivation, encode validation, and storage write at `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.ts:95-126`.
3. Deletions: no deletion is owed by this sub-commit. The plan explicitly leaves inline mailer/action subtraction to 7.3.
4. Principles: `derive-dont-sync` is satisfied via `Content.getForm(form)` and `submissionSchema(definition)` at `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.ts:101-102`. `Effect.orDie` on `IsoDate` decode and encode is the right error-channel choice for this slice: those are developer/invariant failures, not `StorageError`s. The violation is `submissionKey(..., id: string)`.
5. Test surface: durable write, round-trip, distinct ids/keys, no-mailer context, and registration derived payload are covered in `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.test.ts:105-241`. The “decoupled from notify” property is proven enough for 7.2 by compiling/running with only `Submissions | Content | Storage`, not `Mailer`, plus asserting the object exists immediately after `persist`.
6. Behavior regression: no obvious regression to 5.x/6.x read/decode paths. `Content.getForm` is infallible at the public service boundary, falling back per object at `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:572-590` and exposed as `Effect.Effect<FormContent<F>>` at `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:450-452`.
7. Gate: I did not rerun the gate in this read-only review environment. Based on the provided gate result, the slice is still under one small type-safety fix despite green tests.

**References Used**

- `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-submissions-7.2/personal-gyc-42088828/20260617-214911-claude-to-codex-7e0091/prompt.md`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/submissions-7.2.diff`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.test.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/registry.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/submission.test.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/storage.server.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/storage.test-helper.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts`
- `/Users/cvr/Developer/personal/gyc/app/lib/forms/decode.ts`