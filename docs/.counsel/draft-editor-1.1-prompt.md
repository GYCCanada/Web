# Counsel review — registration-launch Branch 1, sub-commit 1.1

You are doing a STANDARD (not deep) review of a SINGLE just-landed commit in a stacked PR.
Review ONLY this commit against the plan — not the whole branch, not future commits.

## Commit under review

- **id:** `0ddcb40` (`refactor(cms)(draft-editor): ContentScope + scopeKeys + DraftEditor.load`)
- **intent (sub-commit 1.1):** `ContentScope` (single-inhabitant union) + `scopeKeys` +
  `DraftEditor.load` (the draft/published reconciliation moved verbatim from
  `Content.getAdminContent`) + tests.
- **diff:** see `docs/.counsel/draft-editor-1.1.diff` (in this repo). It touches exactly two files:
  - `app/lib/content/draft-editor.server.ts` (new, +177)
  - `app/lib/content/draft-editor.server.test.ts` (new, +154)

IMPORTANT framing: this is sub-commit **1.1 of 3** in Branch 1. Per the plan's sub-commit list:
- 1.1 = `ContentScope` + `scopeKeys` + `DraftEditor.load` + tests (THIS commit).
- 1.2 = `editDocument` + `applyImageUpload` + `publish` + tests (LATER — not in this diff).
- 1.3 = migrate `admin/content.tsx`, delete the inline ~165-line pipeline + `Content.getAdminContent` + leaked constants (LATER — not in this diff).

So at 1.1 the Service exposes ONLY `load`; `Content.getAdminContent` still exists (it is
deleted in 1.3 once its caller migrates); the route is untouched. The module-level doc comment
forward-describes `editDocument`/`publish` (the eventual deep module) but the Service interface
at 1.1 is `{ load }` only. This is correct stacked-commit slicing, NOT premature surface — judge
it as such.

## Plan documents (authoritative — do not re-litigate settled decisions)

### Full synthesized plan
See `docs/registration-launch-plan.md` in this repo (read it in full).

### The specific branch section: "Branch 1 — reg-launch/draft-editor (Candidate 3)"

Key requirements for Branch 1 relevant to 1.1:
- `DraftEditor` is a NEW deep module (`app/lib/content/draft-editor.server.ts`) with the
  smallest surface: `load`, `editDocument`, `applyImageUpload`, `publish`.
- `ContentScope` is introduced as a **closed, single-inhabitant union today** (`{ kind: 'site' }`),
  NOT a free string. Branch 5 *widens the union* (`| { kind: 'page' } | { kind: 'form' }`) rather
  than retrofitting a parameter. All ops route through `scopeKeys(scope): { draftKey, publishedKey }`
  — a real function with one case now, N cases later. `make-impossible-states-unrepresentable`:
  an editor cannot target a key that isn't a known scope.
- `load` = the draft/published reconciliation **moved verbatim** from `Content.getAdminContent`
  (`content.server.ts:484-515`), generalized over `scopeKeys`. Reconciliation is by bucket
  `lastModified`, not by mere draft presence.
- 1.1's test surface (from the plan): `load` reconciliation ported from the current
  `getAdminContent` tests — draft-newer / draft-older(stale) / draft-no-published / defaults.

## Review questions (answer each, with file:line receipts)

1. **Exact slice?** Does 1.1 implement EXACTLY sub-commit 1.1's slice — no more (no premature
   `editDocument`/`publish` Service methods, no early route migration, no early
   `getAdminContent` deletion), no less (scope + scopeKeys + load + the four reconciliation
   tests all present)?
2. **small-interface-deep-implementation:** Is the Service surface at 1.1 minimal (`{ load }`)?
   Is `scopeKeys` a real one-case-now/N-cases-later switch the module routes through (deep), or
   ceremony? Does `ContentScope` honor the branch's stated "closed single-inhabitant union, widen
   not retrofit" interface?
3. **make-impossible-states-unrepresentable:** Is `ContentScope` genuinely closed (no free
   string key)? Can an editor target a key that isn't a known scope?
4. **Deletions (subtract-before-you-add):** 1.1's plan-share of deletions is ZERO — the verbatim
   move of `getAdminContent` into `load` and its deletion happen in 1.3 (migrate-callers-then-delete).
   Confirm that deferring the `getAdminContent` deletion to 1.3 (after the route caller migrates)
   is the CORRECT ordering, not a subtract-before-you-add violation. Flag if you think the duplicate
   reconciliation (now in both `content.server.ts` and `draft-editor.server.ts` until 1.3) is a
   problem at this slice.
5. **derive-dont-sync / verbatim move:** Is the reconciliation in `DraftEditor.load` truly
   behavior-equivalent to `Content.getAdminContent` (compare the diff's `load` to
   `content.server.ts:484-515`)? Any subtle divergence (head-compare, Option handling, fallback
   order)?
6. **Gate:** The repo gate is `bun run typecheck && bun run lint && bun run build && bun test`.
   Are there any obvious gate failures introduced by THIS commit — unused imports/exports (e.g.
   an `IssueError` or `deepMerge` imported but unused at 1.1), type errors, a test that can't
   compile? (The Service exposes only `load` at 1.1, so anything imported solely for
   `editDocument`/`publish` would be an unused-import lint failure — check the imports.)
7. **Test surface:** Do the tests cover the four reconciliation cases the plan names
   (draft-newer / stale-draft / draft-no-published / defaults) AND the `scopeKeys` key-pair? Is
   the stale-draft case proven via `lastModified` (TestClock), not mere presence? Any missing
   case for THIS slice?
8. **Behavior regression / principle violations:** Any cast-to-any, stub, commented-out code,
   or behavior regression? Does `load` "never fails" (a bad draft logged + ignored) as the plan
   requires, so the editor always opens?

Return: a verdict (approve / approve-with-concerns / request-changes), a list of BLOCKING items
(must-fix before the branch proceeds), and non-blocking concerns. Cite file:line.
