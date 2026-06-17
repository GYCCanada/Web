# Counsel review — single commit, registration-launch Branch 5, sub-commit 5.5

You are Codex, doing a STANDARD (not deep) review of ONE just-landed commit in a
stacked-PR program. Review **only this commit** against the plan slice it claims to
implement. Do not redesign; judge whether the commit is the correct, minimal,
principled realization of exactly its assigned slice.

## What to judge (answer each explicitly)

1. **Slice fidelity** — does this commit implement EXACTLY sub-commit 5.5's slice
   ("Per-page `/admin` sections (via `DraftEditor` + `ListEdit`)") — no more, no
   less? Flag any scope creep (work belonging to 5.1–5.4 or to Branch 6) OR any
   missing piece of 5.5.
2. **Small-interface / deep-implementation** — 5.5 must add NO new write path. It
   must reuse Branch-1 `DraftEditor` (`load`/`editDocument`/`applyImageUpload`/
   `applyListOps`/`publish`) and Branch-2 `ListEdit` (`collectListOps`/`fieldName`/
   `applyListOps`). Does it? Is the new surface (the dynamic route + the
   `draftSchema` addition to `ObjectSpec` + the `Draft*Page` schemas + the hoisted
   `controls.tsx`) the smallest that delivers per-page editing?
3. **subtract-before-you-add** — 5.5's stated deletion is hoisting the inline
   `/admin` field/list controls out of `content.tsx` into `controls.tsx` and
   migrating the site editor to them (the duplication must genuinely vanish, not be
   copied). Verify `content.tsx` truly deletes the inline `Text`/`Bilingual`/
   `Section`/`ImageUpload`/`ListOpButton`/`ItemControls`/`AddItemButton` and imports
   them from `./controls` instead. Is any duplication left behind?
4. **make-impossible-states-unrepresentable / boundary-discipline / derive-dont-sync**
   — the `:page` param decodes through the closed `PageId` (404 otherwise); the
   dashboard + editor page-set is driven by the single `PAGE_IDS`/`PAGE_SPECS`
   registry (no second list of pages); `PageEditor` is an exhaustive switch over
   `PageId` (adding a Page without an editor is a type error); the draft/publish
   split lives in the registry `ObjectSpec` (`draftSchema` lax, `schema` strict) so
   the reconciliation never forks. Are these upheld? Any cast (`as`) that erodes a
   real boundary vs. a justified re-assert-the-brand-at-the-view-boundary?
5. **ADR 0006 (draft tolerates absence, never malformed)** — the `Draft*Page`
   variants relax list-item *content text* to optional (`DraftText`/optionalKey)
   while keeping `id` and any present branded leaf (`ExternalHttpsUrl`) STRICT. A
   freshly-added id-only item must be draft-valid yet publish-invalid; a present
   malformed value (e.g. a non-https `donateUrl`) must fail even the draft. Is this
   correctly modeled?
6. **ADR 0008 (per-object isolation)** — publishing a page must bust ONLY that
   page's read cache, not other pages / forms / the conference `site` doc. Is that
   the behavior, and is it tested?
7. **Test surface for THIS slice** — the plan's 5.5 surface needs: per-page
   add→fill→publish goes live via `getPage` with no redeploy; publishing a page does
   NOT bust another page's cache (per-object isolation); the draft variants tolerate
   id-only adds but the strict schema blocks publish. Are these present and
   meaningful (not assertion-free)? Any missing test the slice requires?
8. **Behavior regression** — does migrating `content.tsx` to the shared `controls`
   (and threading `newId` into `AddItemButton`) change the site editor's behavior?
   Does the new route's `RichText`-read-only decision silently drop editable content
   the plan intended to be editable in 5.5? (Plan note: RichText editing is a
   separate concern; structural list edits + plain-`Text` fields are the 5.5 scope.)
9. **Gate** — does the commit pass `bun run typecheck && bun run lint && bun run
   build && bun test`? (Assume the runner reports the result; judge whether anything
   in the diff would obviously break it — e.g. an unused import, a non-exhaustive
   switch, a type hole.)
10. **Principle violations** — any `cast-to-any`, stub, commented-out code, or
    "simplify by gutting" — flag with file:line.

Return: a verdict (approve / approve-with-nits / request-changes), a list of BLOCKING
items (must-fix before the branch's final deep review), and non-blocking concerns.
Cite file paths/line numbers from the diff.

---

## (a) The FULL synthesized plan

See attached: `docs/registration-launch-plan.md` (read in full — every branch +
sub-commit list + ordering hazards + receipts).

## (b) The specific branch PR-plan section

The relevant section is **"Branch 5 — `reg-launch/per-page-content`"** in the plan
(Candidate 5, ADR 0008). Its sub-commit list ends with:

> - (5.1) `RichText` + all six Page schemas + `HomePage` + `FormDefinition`
>   placeholder schema-type + per-page/per-form defaults.
> - (5.2) `ContentScope` widened to page/form; `scopeKeys` gains page/form
>   key-pairs; `DraftEditor.load`/`publish` reconciliation generalized per-object;
>   tests (wiring proven before any route migrates).
> - (5.3) `Content.getPage` + `getForm` multi-object read path (per-object cache +
>   parameterized `bust`) + tests.
> - (5.4) Migrate evergreen routes (incl. home) to `getPage`; delete the per-page
>   flat translation keys.
> - **(5.5) Per-page `/admin` sections (via `DraftEditor` + `ListEdit`).**

The branch's stated admin-route intent (plan, Branch 5 "Admin route"):

> per-Page `/admin` sections (settled #5), each a `Section` driven by its schema,
> reusing Branch-2 `ListEdit` for FAQ items / give-directions, writing via
> `DraftEditor` with the page's scope.

5.1–5.4 already landed (see prior commits `c4a7da9`, `e3f2835`, `affdbd3`,
`df28e1b`). This commit (5.5) is the LAST sub-commit of Branch 5.

## (c) THIS commit's id + intent + diff

- **Commit:** `2d85fa6` — `feat(cms)(per-page-content): per-page /admin sections via DraftEditor + ListEdit`
- **Sub-commit:** 5.5 — Per-page `/admin` sections (via `DraftEditor` + `ListEdit`).
- **Intent:** add a per-Page `/admin` editor — ONE dynamic route
  (`admin/pages/:page`) editing any evergreen Page object through `DraftEditor`
  scoped via `pageScope`, reusing Branch-2 `ListEdit` add/remove/reorder + the
  Branch-1 draft/publish pipeline — NO new write path. Adds `Draft*Page` lax draft
  variants + `draftSchema` on the registry `ObjectSpec`; hoists shared admin
  controls to `routes/admin/controls.tsx` and migrates `content.tsx` to them.
- **Diff:** `docs/.counsel/per-page-content-5.5.diff` (attached).

Files touched (10): `app/lib/content/cms-e2e.test.ts`,
`app/lib/content/draft-editor.server.ts`, `app/lib/content/pages/registry.ts`,
`app/lib/content/pages/schema.test.ts`, `app/lib/content/pages/schema.ts`,
`app/routes.ts`, `app/routes/admin/_index.tsx`, `app/routes/admin/content.tsx`,
`app/routes/admin/controls.tsx` (new), `app/routes/admin/pages.$page.tsx` (new).
