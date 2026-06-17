# Counsel review — single just-landed commit (STANDARD, not deep)

You are Codex, performing a focused code review of ONE just-landed sub-commit in a
stacked-PR program. Review ONLY this commit against the plan. Do not review the
whole branch or earlier sub-commits except where this commit's correctness depends
on them.

## What to produce

A structured verdict with:
- `blocking[]` — MUST-fix before proceeding: plan deviation that isn't justified, a
  principle violation, an incomplete deletion, a broken gate, an untested boundary,
  or a behavior regression. Empty if none.
- `concerns[]` — non-blocking observations worth recording.
- `verdict` — one line: ship / ship-with-follow-ups / block.

Be adversarial but fair. If the commit is correct, say so plainly — do not invent
blockers. If you flag something, cite the file + line from the diff.

## The commit under review

- **id:** `3198e00` (HEAD)
- **Branch:** `reg-launch/list-edit` (Branch 2 of the stack).
- **Sub-commit:** **2.3 — Admin add/remove/reorder UI + `list-op` action intent.**
- **Plan's one-line spec for 2.3 (verbatim):**
  > (2.3) Admin add/remove/reorder UI + `list-op` action intent (calls `DraftEditor.editDocument`).
- **Diff:** `docs/.counsel/list-edit-2.3.diff` (full `git show HEAD`, in this repo).

### Already-landed prior sub-commits (context, NOT under review)
- 2.1 (`ff99b6c`): `ListItemId` brand + `id` on list-item schemas + defaults migration
  + read-path id-backfill normalization (`app/lib/content/id-backfill.ts`).
- 2.2 (`f59338d`): the `ListEdit` module (`app/lib/content/list-edit.ts`) — the deep
  `applyListEdit(base, ops)` + op-constructors `addOp`/`removeOp`/`reorderOp` + the
  control-field parser `collectListOps` + `listOpFieldName` template.
- Branch 1 (DraftEditor) already shipped: `DraftEditor` is the deep admin write module
  exposing `load` / `editDocument` / `applyImageUpload` / `publish`, scoped by
  `ContentScope` / `scopeKeys` / `siteScope`. The route action is "auth → parse intent
  → call DraftEditor".

## Review questions (answer each, with receipts from the diff)

1. **Exact slice — no more, no less.** Does 2.3 implement exactly its plan slice (the
   per-list add/remove/reorder admin UI + a `list-op` action intent)? Flag scope creep
   or under-delivery.

2. **The plan-vs-implementation deviation you MUST adjudicate.** The plan's 2.3 line says
   the action "**calls `DraftEditor.editDocument`**". The commit instead introduces a NEW
   `DraftEditor.applyListOps(scope, ops)` method and calls THAT. The commit message argues
   `editDocument`'s array-by-index `deepMerge` is wrong for remove/reorder (that index
   branch is slated to die in 2.4), so routing list ops through `editDocument` would be
   semantically broken. Adjudicate: is adding `applyListOps` (mirroring `applyImageUpload`)
   the correct realization of the plan's INTENT (route stays thin, bucket-key choreography
   stays in DraftEditor, list ops are id-keyed not index-keyed), or is it unjustified scope
   creep / a new public-interface method that should have waited? Consider
   `small-interface-deep-implementation` (is `applyListOps` a genuinely-deep new capability,
   or shallow sugar over `editDocument` + `applyListEdit`?) and whether the plan's literal
   wording was simply imprecise about a real ordering constraint (2.4 deletes the index
   branch). Note: 2.4 is the sub-commit that deletes the index-merge branch / positional
   field-name templates — it has NOT landed yet.

3. **The OTHER large deviation you MUST adjudicate — `DraftSiteContent`.** The plan's
   Branch-2 text (and ADR 0006 consequences) says: "Add = appends an empty item with a fresh
   nanoid and auto-saves the draft"; "an empty required `Text` blocks publish, not save";
   "add-with-empty produces a draft-valid-but-publish-invalid item". The plan does NOT name a
   separate `DraftSiteContent` schema — it implies the existing strict `SiteContent` somehow
   tolerates the stub on save. This commit makes that mechanism EXPLICIT by introducing a
   whole `DraftSiteContent` schema (per-locale-optional `DraftText`, optional
   `DraftImageRef.alt`, optional `position`, etc.), decoding/encoding drafts through it, and
   re-decoding strict `SiteContent` only at `publish`. Adjudicate: is this the RIGHT
   realization of the plan's stated draft-lax/publish-strict requirement (you cannot have
   "draft tolerates an id-only item" AND "strict `Text` both-locales invariant" with a single
   schema — the two are in direct tension, so a separate draft schema is arguably forced), or
   is it over-engineering / a parallel-schema smell (`migrate-callers-then-delete`,
   `derive-dont-sync`)? Specifically assess:
   - Is `DraftSiteContent` a hand-maintained PARALLEL of `SiteContent` that will silently
     drift (a `derive-dont-sync` violation), or is the duplication acceptable/necessary given
     the per-field laxness must be precise (identity/asset/enum leaves stay STRICT when
     present; only content text relaxes)? Could it have been derived from `SiteContent` rather
     than re-declared? Is re-declaration justified here?
   - Is the "draft-lax DOWN TO THE LEAF but strict-when-present" boundary correctly modeled?
     (`make-impossible-states-unrepresentable`: a present image `key` must still be a valid
     `AssetKey`; only absence is tolerated, never a malformed value.) The tests at
     `schema.test.ts` assert: stub decodes as draft / rejected by strict; half-filled bilingual
     draft-valid but publish-invalid; a malformed (`../../etc/passwd`) image key rejected EVEN
     as a draft. Are these the right invariant tests, and do they actually pin the boundary?
   - Does `publish` correctly enforce strict `SiteContent` (re-encode draft JSON → strict
     decode → 400 IssueError on incomplete) so the live document can never carry half-filled
     content (CONTEXT §Section skip: skip is for ABSENCE, never half-filled)?

4. **Small-interface-deep-implementation + the branch's stated module interface.** Branch 2's
   stated module is `ListEdit` (`applyListEdit` is the ONE deep op; op-constructors + parser
   are private sugar). This commit does NOT grow `ListEdit`'s public surface (good?) but DOES
   grow `DraftEditor`'s (the `applyListOps` method) and `schema.ts`'s (the `DraftSiteContent`
   export, the `uniqueListItemIds` filter + `IdListArray` helper). Are these additions
   justified deep capabilities, or surface bloat? Is the route kept thin (the plan's
   requirement: action = auth → parse intent → call DraftEditor)?

5. **`uniqueListItemIds` invariant — in scope for 2.3?** The commit also adds a struct-level
   `uniqueListItemIds` filter (applied to speakers/seminars/team in BOTH strict and draft
   docs) so the id-keyed merge/reorder can't be made ambiguous by a duplicate id. Is this a
   legitimate part of "the id-keyed list editing is correct" (arguably it belongs with the
   merge in 2.2, or is fine landing alongside the UI that exercises reorder), or is it scope
   creep into 2.3? Is the invariant itself correct (`make-impossible-states-unrepresentable`)?

6. **Subtract-before-you-add (this commit's share).** The plan's Branch-2 deletions
   (`deepMerge` array-by-index branch, numeric `setPath` list-handling, positional
   field-name templates) are explicitly slated for **sub-commit 2.4**, NOT 2.3. The commit
   message says "Field-name templates stay positional (id-keyed names are 2.4)". So 2.3
   carries NO deletion obligation — verify that's a correct reading of the plan, and that the
   commit didn't leave dead/duplicated code it SHOULD have deleted now. (The one in-commit
   replacement: the speakers `fieldset` was gated `length > 0` and is now always-rendered
   with an Add button — confirm no dead conditional remains.)

7. **Test surface for THIS slice.** The plan's Branch-2 test surface names, among others:
   "`cms-e2e.test.ts` — add a speaker, save draft, assert id persists; remove, assert gone";
   and "add-with-empty produces a draft-valid-but-publish-invalid item". This commit adds:
   - `cms-e2e.test.ts`: add→draft-reopens-but-publish-rejects; add→untouched-save-succeeds
     (regression guard); add→image-upload-to-new-id succeeds; remove+reorder round-trip.
   - `schema.test.ts`: the `DraftSiteContent` draft-lax/publish-strict matrix.
   - `draft-editor.server.test.ts`: type-widening of a test helper to accept the draft doc.
   Does the test surface cover this slice's behavior (add/remove/reorder e2e, the
   draft-valid/publish-invalid property, the auto-save-then-upload-target chain settled #10)?
   Any MISSING test the plan's surface requires for THIS slice? (e.g. is the `list-op` ROUTE
   action path — `collectListOps` → `applyListOps` → redirect — covered, or only the service
   method? Is the `ItemControls` reorder permutation / disabled-edge logic tested?)

8. **Behavior regression.** Does anything in this commit change public read-path behavior, the
   existing save-draft/publish/upload flows, or EN/FR rendering? (The public `getSiteContent`
   read path and `Content` boundary must be untouched; the admin view now renders partial
   items with empty defaults.) Flag any regression. Note the commit message claims a fixed
   "draft-save regression" — assess whether the fix (the always-render fieldset + `?? emptyText`
   defaults + draft-lax decode) is sound and whether an untouched Save-draft of a doc WITH a
   stub item now round-trips (the test claims it does).

9. **Principle violations.** Any `cast-to-any` / `as unknown as X` to silence types, stubs,
   commented-out code, or TODO/FIXME bail-outs? (Note: a `as unknown as Json` appears in a
   TEST at `cms-e2e.test.ts` constructing a deliberately-partial override payload — assess
   whether that's a legitimate test-fixture cast or a smell. There are also several
   `as EncodedDoc` / `as Json` casts in `draft-editor.server.ts` that pre-date this commit at
   the encode boundary — only flag NEW ones this commit introduces.)

## Gate status (already verified by the implementer, confirm plausibility)

- `bun run typecheck` — clean.
- `bun run lint` — exit 0 (2 pre-existing warnings in untouched files).
- `bun run build` — exit 0.
- `bun test` — 226 pass, 0 fail.

## Settled decisions (DO NOT re-litigate — realize, don't re-open)

- ADR 0006: list identity = stable nanoid ids; index merge REPLACED by id-keyed merge; add =
  new id + empty fields + auto-save draft; an incomplete required field blocks PUBLISH, not
  draft save.
- Settled #10: "Add item = appends with generated id + empty fields + auto-saves draft" so
  uploads/edits have a server-side target.
- CONTEXT §Section skip: skip is for ABSENCE (empty list / absent optional block), never a
  tolerance for half-filled content; a present item with a blank required bilingual field is a
  hard validation error; the `Text` both-locales invariant is never relaxed.
- The index-merge-branch / positional-template DELETIONS are sub-commit 2.4's job, not 2.3's.

---

## The full plan (for grounding the above)

@docs/registration-launch-plan.md
