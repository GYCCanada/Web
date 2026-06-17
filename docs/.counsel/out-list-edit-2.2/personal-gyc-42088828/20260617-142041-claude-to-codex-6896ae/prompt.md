# Codex counsel — STANDARD review of ONE just-landed commit

You are reviewing a SINGLE sub-commit of a stacked-PR plan. Review ONLY this commit, against ONLY the slice the plan assigns to it. Do not review the whole branch, do not propose work that belongs to later sub-commits, and do not re-litigate settled decisions.

## What to read

1. The FULL synthesized plan (every branch + sub-commit list): `docs/registration-launch-plan.md`.
2. The branch this commit belongs to: section **"Branch 2 — `reg-launch/list-edit` (ADR 0006, Candidate 4)"** in that plan. The 2.2 line reads:
   > (2.2) `ListEdit` module (`applyListEdit` + private helpers) + tests.
   The branch's stated module shape for `ListEdit`:
   - The ONE deep operation: `applyListEdit(base, ops)` — id-keyed merge + op application in one function. `ListOp = { add: {listPath,id} } | { remove: {listPath,id} } | { reorder: {listPath,ids} }`.
   - Private helpers (NOT the interface): `collectListOps(entries)` parses `list.<path>.op` control fields; `fieldName(listPath, id, leaf)` is a thin string template. ONE deep capability; op-constructors + name-template are sugar.
   - Implementation absorbs: id matching, append-with-empty-defaults, drop-by-id, order-array application, structuralClone discipline. Arrays merge by matching `item.id` (nanoid), NOT position: id absent from base → appended; id in base but not overrides → survives; explicit order array reorders.
3. THIS commit's intent and diff:
   - **Commit:** `f59338d feat(cms)(list-edit): applyListEdit id-keyed add/remove/reorder + control-field parser`
   - **Sub-commit id/intent:** 2.2 — ListEdit module (`applyListEdit` + private helpers) + tests.
   - **Diff:** `docs/.counsel/list-edit-2.2.diff` (full `git show`). Files: `app/lib/content/list-edit.ts` (new, 239 lines), `app/lib/content/list-edit.test.ts` (new, 290 lines).

## Branch-2 context you must hold (do NOT flag as gaps in 2.2)

The plan splits Branch 2 into four sub-commits, in order:
- **2.1 (ALREADY LANDED, `ff99b6c`):** `ListItemId` brand + `id` on list-item schemas + defaults migration + read-path id-backfill. So `ListItemId`, `newListItemId`, schema ids all exist already — 2.2 builds on them.
- **2.2 (THIS commit):** the `ListEdit` module + tests.
- **2.3 (NOT YET):** Admin add/remove/reorder UI + `list-op` action intent (calls `DraftEditor.editDocument`).
- **2.4 (NOT YET):** Delete the `deepMerge` index-merge branch / numeric `setPath` list-handling / positional field-name templates; migrate callers.

The plan EXPLICITLY says (sub-commit list + "subtract" section + the commit message body) that the `deepMerge` index-branch and positional-template **deletions land in 2.4** — "migrate callers first" (`migrate-callers-then-delete-legacy-apis`). So 2.2 is NOT expected to delete `admin-form.ts`'s `deepMerge`/`setPath` index handling. Do NOT flag the absence of those deletions in 2.2 as a `subtract-before-you-add` violation — that subtract is sequenced into 2.4 precisely to migrate callers (the admin route, 2.3) first. Judge whether 2.2 makes ITS share of the deletions (which per the plan is none — it is purely additive groundwork, with the deletes deferred to 2.4 by design).

## Settled decisions (do NOT re-open)

ADR 0006 (`docs/adr/0006-stable-list-item-ids.md`) is realized by this branch: ids are content (round-trip through schema); id-keyed merge replaces index merge; add = new id + empty fields (publish-invalid until edited); remove = drop id; reorder = order array. RegFox is the launch channel. Conference is not a Page. See `docs/registration-launch-brief.md` "Settled decisions" + "Non-goals".

## The principles to judge against (`~/.brain/principles/`)

`small-interface-deep-implementation`, `make-impossible-states-unrepresentable`, `boundary-discipline`, `subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis`, `derive-dont-sync`, `correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO commented-out code — "read more code"), `prove-it-works`.

## Your review questions (answer each, ONLY for commit 2.2)

1. **Exact slice — no more, no less.** Does 2.2 implement EXACTLY its slice: `applyListEdit` (the one deep op) + private-helper sugar (`collectListOps`, `fieldName`, op-constructors, `listOpFieldName`) + tests? Does it leak in work that belongs to 2.1 (schema/defaults/backfill), 2.3 (admin UI/action), or 2.4 (deletions/caller migration)? Is anything from 2.2's own slice missing?
2. **Small-interface-deep-implementation + the branch's stated interface.** Is `applyListEdit` the single deep capability, with the rest genuinely private/thin sugar? The module currently `export`s `addOp`/`removeOp`/`reorderOp`/`collectListOps`/`fieldName`/`listOpFieldName`/`ListOp`/`ListPath`/`ListOpKind` — the plan calls `collectListOps` and `fieldName` "private (not interface)". Are these exports justified (consumed by 2.3's admin view/action across a module boundary, so they cannot be file-private), or do they over-widen the surface? Is the depth in the right place?
3. **Subtract (2.2's share).** Per the plan the deletions are sequenced to 2.4. Does 2.2 correctly defer them (additive-only, callers migrated first) rather than half-deleting? Is the deferral honest (the commit message states it), or is there a hidden parallel API being created that 2.4 would then have to reconcile?
4. **Gate.** `bun run typecheck && bun run lint && bun run build && bun test` — assume green (verified: typecheck clean, only pre-existing lint warnings in unrelated files, all 20 list-edit tests pass). Flag anything in the diff that would plausibly break the gate or that the test run would miss.
5. **Principle violations.** Any cast-to-any / stub / commented-out code? `boundary-discipline`: `collectListOps` parses untrusted FormData and keeps ids as raw strings, branding only where `applyListEdit` threads them into the document the decoder validates — is that the right boundary, or is it inventing/laundering a brand at a non-boundary? `make-impossible-states-unrepresentable`: is the `ListOp` union shape (exactly-one-of add/remove/reorder) sound, and is the exhaustive `applyOp` switch correct? Is the "pure: clone once, never mutate" claim actually upheld by `updateListAtPath`/`applyOp`?
6. **Test surface for THIS slice.** The plan's test surface for 2.2 (the `list-edit.test.ts` portion): add/remove/reorder round-trips; id-keyed merge preserves unedited deep fields (the property `deepMerge` had); add-with-empty produces a draft-valid-but-publish-invalid item (empty required `Text` blocks publish, not save — via `decodeUnknownSync` over `defaultContent`). Does the test file cover each? Any missing case that 2.2's slice REQUIRES (e.g. input immutability, ordered application, nested list-path navigation, the reorder-never-drops invariant)? Note `admin-form.test.ts` / `schema.test.ts` / `cms-e2e.test.ts` extensions are 2.1/2.3/2.4 surface, NOT 2.2 — do not require them here.
7. **Behavior regression.** Could anything in this additive commit regress existing behavior? (It adds two new files and touches nothing else — confirm the diff is genuinely additive and nothing pre-existing is altered.)

## Output

Give a crisp verdict (LGTM / LGTM-with-concerns / changes-requested). List any BLOCKING items (must fix before this commit stands) separately from non-blocking CONCERNS. Cite file:line from the diff. Be terse; no preamble.
