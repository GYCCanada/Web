Verdict: **Not safe to merge yet**; Branch 7 mostly realizes the persisted Submission pipeline, but the runtime/test seam does **not** share the injected `Storage` with `Content`, so the “same in-memory bucket / real CMS-backed form definition” proof is false.

**BLOCKING**

- `makeAppLayer(storageLayer)` does not wire `storageLayer` into `Content`. It merges `Content.defaultLayer`, and `Content.defaultLayer` already pre-provides `Storage.layerOptional`, so `Content.getForm(...)` reads through a separate optional storage instance while `Submissions.persist(...)` writes to the injected storage. That violates the prompt’s “same Content/Storage instance” criterion and makes the in-memory runtime proof weaker than claimed.
  Evidence: `/Users/cvr/Developer/personal/gyc/app/lib/effect/runtime.ts:82-95`, `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:705-712`, `/Users/cvr/Developer/personal/gyc/app/lib/storage.server.ts:252-268`, `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.ts:91-124`.
  The service-level tests compose this correctly with `Content.layer` plus the same test storage, which is the pattern `makeAppLayer` should follow: `/Users/cvr/Developer/personal/gyc/app/lib/forms/submissions.server.test.ts:52-58`.

**CONCERNS**

- Registration multi-record persistence is sequential and non-atomic. If registrant #2 fails after #1 is written, #1 remains, notify does not run, and a retry can duplicate #1. The action does not report success, so I would not block on this object-storage tradeoff, but it should be an explicit accepted behavior or get an idempotency/grouping design.
  Evidence: `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.ts:113-118`; existing tests cover notify failure after all writes, not mid-loop persist failure: `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.test.ts:190-212`.

- Registration field-error keys look correct by trace: the action decodes `Schema.Struct({ registrants: Schema.Array(...) })`, and `formatSchemaResult` serializes numeric paths with conform’s `formatPath`, so paths should key as `registrants[0].email`. I did not see an action-level invalid-payload test pinning that exact path.
  Evidence: `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-action.ts:100-106`, `/Users/cvr/Developer/personal/gyc/app/lib/effect/form-schema.ts:29-43`, `/Users/cvr/Developer/personal/gyc/app/lib/effect/form.ts:64-83`.

- Stale comment: `RegistrationForm` still says the registration action is a deliberate no-op, which is false after Branch 7.
  Evidence: `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/registration-form.tsx:180-183`.

The rest of the core plan is solid: `Submissions` is persist-only, payload schema is derived from `FormDefinition`, flat actions persist before notify, registration no-op actions are removed from all three year routes, and focused tests pass (`bun test app/lib/forms/submission.test.ts app/lib/forms/submissions.server.test.ts app/lib/forms/action.test.ts app/lib/forms/registration-action.test.ts` → 24 pass).

**Let Me Take More Off Your Plate**

- Next action: patch `makeAppLayer` to compose `Content.layer` with the passed storage and add a regression test using stored `forms/contact.json`.
- Automation: add a small runtime-composition test that proves `Content.getForm` and `Storage.list` see the same `layerTest` bucket.
- Team delegate: ask reviewers to decide whether registration partial-write-on-persist-failure needs idempotency before launch.