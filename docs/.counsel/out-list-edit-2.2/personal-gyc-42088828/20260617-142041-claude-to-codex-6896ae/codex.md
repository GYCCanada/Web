LGTM-with-concerns.

**BLOCKING**
None.

**CONCERNS**
- `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.test.ts:280-284` uses `as unknown as readonly ListItemId[]` in the expected reorder op. It is test-only, but it violates the local “no `as unknown as X`” guardrail. Use the local `id(...)` helper for `idA/idB/idC` instead.
- `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.ts:520-525` says `collectListOps` keeps ids raw and brands only when `applyListEdit` threads them into the document, but `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.ts:541-548` casts FormData strings to `ListItemId` inside the parser. Behavior is still boundary-safe because invalid add ids fail downstream decode, but the comment overclaims.

**Verdict Notes**
- Slice is correct: diff is additive-only, exactly two new files: `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.ts` and `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.test.ts`; no 2.1 schema/defaults/backfill, no 2.3 UI/action, no 2.4 deletion/caller migration.
- `applyListEdit` is the deep operation at `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.ts:488-497`; helpers are thin sugar. Exports are acceptable because 2.3 needs parser/template helpers across the module boundary.
- Deferring `deepMerge`/positional deletion is honest: commit message says 2.4 owns it in `/Users/cvr/Developer/personal/gyc/docs/.counsel/list-edit-2.2.diff:24-25`, matching `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`.
- Test surface is strong for this slice: add/remove/reorder, id-keyed preservation, nested list path, immutability, ordered ops, non-array path no-op, real-document decode, and publish-invalid empty item are covered in `/Users/cvr/Developer/personal/gyc/app/lib/content/list-edit.test.ts`.
- No existing behavior regression visible: `git show --stat f59338d` confirms 529 insertions across two new files only.

Files/principles used: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`, `/Users/cvr/Developer/personal/gyc/docs/.counsel/list-edit-2.2.diff`, `/Users/cvr/.brain/principles/small-interface-deep-implementation.md`, `/Users/cvr/.brain/principles/make-impossible-states-unrepresentable.md`, `/Users/cvr/.brain/principles/boundary-discipline.md`, `/Users/cvr/.brain/principles/subtract-before-you-add.md`, `/Users/cvr/.brain/principles/migrate-callers-then-delete-legacy-apis.md`, `/Users/cvr/.brain/principles/derive-dont-sync.md`, `/Users/cvr/.brain/principles/correctness-over-pragmatism.md`, `/Users/cvr/.brain/principles/prove-it-works.md`.