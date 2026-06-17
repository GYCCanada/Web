# Counsel review request — single commit, sub-commit 2.4

You are Codex, doing a STANDARD (not deep) code review of ONE just-landed commit in a
stacked-PR program. Review ONLY this commit against the plan slice it claims to implement.
Be adversarial but precise: do not invent gaps the plan explicitly defers; do verify the
deletions, the interface discipline, and any regressed behavior.

## What to read

1. The FULL synthesized program plan (every branch + sub-commit list):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`
2. The specific branch section this commit belongs to: **"Branch 2 — `reg-launch/list-edit`
   (ADR 0006, Candidate 4)"** in that same plan file (lines ~64–100). Sub-commit list at the
   bottom of that section is the contract.
3. THIS commit's diff: `/Users/cvr/Developer/personal/gyc/docs/.counsel/list-edit-2.4.diff`
4. (Context, do not re-litigate) ADR 0006: `/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md`

## The commit under review

- **Commit:** `6a9bb5b` — `feat(cms)(list-edit): retire the index assumption — identity-keyed merge/navigation`
- **Intent (sub-commit 2.4, from the plan):** "Delete index-merge branch / numeric `setPath`
  list-handling / positional field-name templates; migrate callers."
- The plan's "Subtract (what dies)" for this branch names exactly three index-assumption homes
  this commit must retire:
  - `deepMerge`'s **array-by-index branch** (`admin-form.ts`) → id-keyed merge.
  - `setPath`'s numeric-segment array handling + `setAtPath`'s list-index assumption.
  - the view's positional field-name templates (`conferences.${ci}.speakers.${si}.name`,
    `team.${ti}.name`) → id-keyed (`speakers.${speaker.id}.name`).

This commit is the LAST sub-commit of Branch 2. Sub-commits 2.1 (ListItemId brand + id on
schemas + defaults + id-backfill), 2.2 (`ListEdit` module / `applyListEdit` + helpers), and
2.3 (admin add/remove/reorder UI + `list-op` intent calling `DraftEditor.editDocument`) already
landed. So `applyListEdit`, `fieldName`, `addOp/removeOp/reorderOp`, `collectListOps`, the
`ListItemId` brand, and the `DraftEditor` interface PRE-EXIST this commit — they are not 2.4's
to introduce. 2.4 is the deletion-and-migration slice.

## Review questions (answer each, with file:line receipts from the diff)

1. **Exact slice — no more, no less.** Does this commit implement precisely sub-commit 2.4's
   scope (delete the three index-assumption homes + migrate every caller), and NOT smuggle in
   work belonging to Branch 3+ (conference schema growth, section-skip, per-page) or earlier
   sub-commits? Flag any scope bleed in either direction.

2. **`subtract-before-you-add` / deletion test.** The plan demands the three index homes
   genuinely vanish. Verify in the diff:
   - `deepMerge`'s old `Array.isArray(base) && Array.isArray(overrides)` index branch is
     actually deleted (not left dormant alongside the new one).
   - `setPath`'s `isIndex`/numeric array-construction (`Number(segment)`, `isIndex(next) ? [] : {}`)
     is gone; `setAtPath` no longer navigates arrays by index (now `setByIdentity`).
   - the view's `conferences.${ci}.speakers.${si}` / `team.${ti}` positional templates are gone,
     replaced by id/slug-keyed `fieldName(...)`.
   Is there any LEFTOVER positional/index path still reachable in `app/` (a dead `isIndex`, a
   second merge branch, a `${ci}`/`${si}` template)? Call it out if so.

3. **`small-interface-deep-implementation` + the branch's stated module interface.** Branch 2's
   interface contract: "The ONE deep operation `applyListEdit`; private helpers `collectListOps`,
   `fieldName` are sugar." Does 2.4 keep the public surface small — i.e. does it introduce any
   NEW exported symbol it shouldn't? (`setByIdentity`, `itemIdentity`, `navIdentity` should be
   private/module-local.) Are the new identity-resolution helpers (`itemIdentity` in admin-form,
   `navIdentity` in list-edit) justified depth, or near-duplicate shallow wrappers that should be
   one shared helper? Judge whether the duplication is acceptable for two different modules or a
   smell.

4. **`make-impossible-states-unrepresentable` / `boundary-discipline`.** The view re-asserts the
   `ListItemId` brand via `ListItemId.make(speaker.id)` / `ListItemId.make(member.id)` at the
   render boundary (encode drops the brand to a bare string). Is that the right call (validate,
   not cast) and does it keep `fieldName`'s "no `.`-bearing id" guarantee load-bearing? Or is it
   redundant ceremony? Also: `setByIdentity` creates missing OBJECT keys but never fabricates
   ARRAY items — verify that invariant holds in the diff and that an unknown identity leaves the
   doc untouched (the strict decode downstream is the gate).

5. **Behavior regression.** Does the identity-keyed merge/navigation preserve the property the
   old index merge had — an edit overlays only its leaf, every unedited deep field survives
   verbatim — AND additionally fix index-drift (an edit lands on its id after a reorder)? Are
   there cases the OLD code handled that the new code silently drops (e.g. a conference addressed
   when it carries neither `id` nor `slug`; a numeric-looking id; the image-upload target for a
   freshly-added stub item that carries only its `id` with no `photo` object yet)? Check the
   `setByIdentity` "create fresh object for absent/scalar slot" branch against the stub-upload case.

6. **Test surface for THIS slice.** The plan's Branch 2 test surface mentions add-with-empty,
   id-keyed merge preserving unedited deep fields, position-independence. For 2.4 specifically:
   does the commit add **position-independence** tests (an edit lands on its id/slug even after a
   reorder) for BOTH `deepMerge` (admin-form.test) AND `updateListAtPath`/`applyListEdit`
   (list-edit.test) AND `setAtPath` (admin-form.test)? Is the migrated e2e (`cms-e2e.test.ts`)
   still asserting the auto-save-then-upload-target chain, now id-keyed? Is any test merely
   renamed without strengthening, where the slice's risk (index→identity) demanded a new
   assertion? Flag missing coverage for the riskiest path (the THROUGH-an-array navigation, e.g.
   `conferences./2024.speakers`).

7. **Gate.** The commit message claims "Gate green: typecheck, lint, build, 231 tests." Assume
   the gate ran. Flag only if the diff shows something that would plausibly NOT compile/pass
   (e.g. an `as unknown as` cast, a stubbed function, a commented-out assertion, a removed test
   that wasn't replaced).

8. **Any principle violation** not covered above (`derive-dont-sync`,
   `migrate-callers-then-delete-legacy-apis` — were ALL callers migrated before the old branch
   was deleted, or is a parallel positional path left for some caller?).

## Output format

Return a tight verdict. For each BLOCKING issue (must-fix before this commit is sound), give:
the file:line, what's wrong, why it violates the plan/principle, and the minimal fix. Separate
NON-blocking concerns (nits, future-branch notes). If the commit cleanly implements 2.4's slice,
say so plainly — do not manufacture blockers. End with an overall verdict: APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES.
