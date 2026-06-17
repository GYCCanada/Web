# Deep adversarial review — WHOLE PR `reg-launch/list-edit`

You are Codex doing a `--deep`, holistic, adversarial review of an ASSEMBLED stacked PR
(all four of its sub-commits taken together), not a single commit. Be skeptical. Hunt for
half-migrated callers, dead code between slices, incomplete deletions, behavior regressions,
and principle violations. Reward depth; punish shallow surface + churn.

## What to read

1. **The full synthesized program plan** (every branch + sub-commit):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`
   — read the WHOLE thing for cross-branch context, but the section that THIS PR must realize is
   **"Branch 2 — `reg-launch/list-edit` (ADR 0006, Candidate 4)"** (the "Module shape — `ListEdit`",
   "Schema changes", "Defaults migration", "Admin route", "Subtract (what dies)", "Test surface",
   and the four "Sub-commits" 2.1–2.4).
2. **The settled brief** (do NOT re-litigate settled decisions; flag only deviations FROM it):
   `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`
   — relevant: settled #2 (nanoid list identity, index merge replaced), #3 (section skip is
   section-level, items stay strict, `Text` both-locales invariant never relaxed), #10 (add =
   append empty item + fresh id + auto-save draft).
3. **ADR 0006** `/Users/cvr/Developer/personal/gyc/docs/adr/0006-stable-list-item-ids.md`
   (incl. the Consequences amendment this PR added about the read-path id-backfill).
4. **The whole-PR diff** (base = parent stack branch `draft-editor`, head = `list-edit`):
   `/Users/cvr/Developer/personal/gyc/docs/.counsel/list-edit-WHOLE.diff`
   This PR sits ON TOP of Branch 1 (`draft-editor`), which already extracted the `DraftEditor`
   deep module (`editDocument`/`applyImageUpload`/`publish`/`load` over a `ContentScope`). So the
   diff base already has DraftEditor; list-edit builds add/remove/reorder on it (no churn — that
   was the whole point of ordering DraftEditor first).

## The four sub-commits assembled in this PR

- **2.1** `ListItemId` brand + `id` on `Speaker`/`Seminar`/`TeamMember` + `IdListArray`
  (unique-id struct filter) + a separate **`DraftSiteContent`** schema (lax draft variant) +
  defaults migration (stable nanoids inlined) + **read-path id-backfill** (`id-backfill.ts`,
  wired into BOTH `content.server.ts` public read AND `draft-editor.server.ts` draft read).
- **2.2** `ListEdit` module (`applyListEdit` + `addOp`/`removeOp`/`reorderOp` +
  `collectListOps` control-field parser + `fieldName`/`listOpFieldName` templates).
- **2.3** Admin add/remove/reorder UI + `intent=list-op` action calling
  `DraftEditor.applyListOps` (a new `DraftEditor` method added this PR).
- **2.4** Delete the index assumption's homes: `deepMerge`'s array-by-index branch,
  `setPath`'s numeric-segment array handling, `setAtPath`'s index assumption
  (rewritten as identity-keyed `setByIdentity`), and the positional field-name templates in
  the admin view. Migrate all callers to identity-keyed.

## Verified gate state (you don't need to re-run, but assume green)

`bun run typecheck && bun run lint && bun run build && bun test` — typecheck clean, lint only 2
PRE-EXISTING warnings in untouched files, build OK, **231 tests pass / 0 fail**.

## The holistic questions I want answered

**(A) Does the assembled PR fully realize Branch 2 of the plan?**
- Interface depth: is `applyListEdit` the ONE deep operation (small interface), with
  op-constructors / `collectListOps` / `fieldName` as thin sugar — or did surface leak?
- ALL deletions made: did the index-by-position assumption ACTUALLY die in all FOUR named homes
  (`deepMerge` array-by-index branch, `setPath` numeric handling, `setAtPath` index assumption,
  positional view templates)? Run the deletion test: grep the diff for any surviving
  `isIndex`, `Number(segment)`, numeric-array-index merge, or `\.${ci}\.`/`\.${i}\.` positional
  template. Is any dead code left between slices (e.g. a helper 2.4 should have removed)?
- Complete test surface: add/remove/reorder round-trips; id-keyed merge preserves unedited deep
  fields (the property the old `deepMerge` had); the unique-id invariant; the id-backfill
  (id-less decodes, ids assigned, idempotent on re-decode); the draft-valid-but-publish-invalid
  empty-item case; control-field parsing. Is any of these MISSING or thin?
- No behavior regression: editing an existing speaker's leaf still overlays only that leaf and
  preserves long bios / image keys / omitted Option windows — now keyed by identity not index.

**(B) Does it cohere across its four sub-commits?**
- No half-migrated caller: every consumer of the old positional path (`content.tsx` view +
  action, `draft-editor.server.ts`, `admin-form.ts`, image-upload target rewrite) moved to
  identity-keyed in the SAME PR. Is there a path still emitting/consuming numeric segments?
- The `DraftSiteContent` vs `SiteContent` split: `AdminContent.content` became
  `DraftSiteContent`. Trace it end to end — does the view encode/decode the draft shape, does
  `publish` re-decode STRICT `SiteContent` (the both-locales `Text` gate), and is the strict
  invariant provably NOT relaxed for published content (settled #3 / CONTEXT §Section skip)?

**(C) Scrutinize the RISKIEST part hardest — the read-path id-backfill (`id-backfill.ts`).**
This is the single most important hazard in Branch 2: a *required* `id` on every list item
means every already-published `content/site.json` (which has NO ids) would FAIL decode on the
next read and break the LIVE site on deploy. The backfill assigns a fresh nanoid to any id-less
item between parse and decode. Adversarially check:
- Is it wired into **every** read path that decodes the document? (public `content.server.ts`
  `decodeDocument` AND admin `draft-editor.server.ts` `decodeDraftJson`.) Is there a read path
  that decodes WITHOUT backfill and would therefore break on the live id-less document?
- Is it genuinely **idempotent** (an item already carrying an `id` — even a bad one — is left
  untouched for the decoder to reject, not "repaired")? Does it ever mutate its input?
- Does it walk the RIGHT set of list locations (`conferences[].speakers[]`,
  `conferences[].seminars[]`, `team[]`) and ONLY those — and does a malformed document still
  reach the decoder (the sole gate) rather than throwing inside the walk?
- `withId` does `{ id: newListItemId(), ...item }`. Is the spread order safe given the
  `'id' in item` guard? Could a backfilled id collide with an existing one and trip the
  `uniqueListItemIds` filter?
- The defaults migration inlined hardcoded nanoids. Are they all unique and well-formed
  (the `ListItemId` pattern is `^[A-Za-z0-9_-]{21}$`)? Will `defaults.ts` (decoded via
  `decodeUnknownSync`) decode under the new required `id`?

**Also relevant** (these belong to later branches but check for premature/incorrect coupling):
- Option→string|undefined is **Branch 3** (conference-detail), NOT this PR — flag if this PR
  prematurely touched it.
- The equivalence harness is **Branch 6** — out of scope here.

## Output

Give a holistic verdict. List BLOCKING issues (must-fix before merge: plan deviation, principle
violation, incomplete deletion, broken gate, untested boundary, behavior regression, a read
path that breaks the live id-less document) separately from non-blocking CONCERNS. Cite exact
file paths + line ranges from the diff. If the PR genuinely realizes its plan section with no
blockers, say so plainly — do not invent issues.
