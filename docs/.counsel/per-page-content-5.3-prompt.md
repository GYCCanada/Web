# Codex counsel — STANDARD review of ONE just-landed commit

You are doing a focused, single-commit code review for a stacked-PR program. Review **only** the commit described below, against the plan. Do not review the rest of the stack, do not propose work that belongs to later sub-commits, and do not re-litigate settled decisions.

## What to produce

A structured verdict with:
- `blocking`: MUST-fix-before-proceeding items only. Reserve this for: deviation from sub-commit 5.3's stated slice, a principle violation, an incomplete deletion this commit owed, a broken gate, an untested boundary the plan's test surface required for THIS slice, or a behavior regression. If none, return an empty list.
- `concerns`: non-blocking observations worth noting.
- `verdict`: a short overall judgement.

## The review questions (answer each)

1. **Exact slice — no more, no less.** Does this commit implement *exactly* sub-commit 5.3's slice: `Content.getPage` + `getForm` multi-object read path (per-object decode boundary + fallback-to-default + per-object cache) + parameterized `bust`, plus the tests the plan lists for this slice? Does it leak in work that belongs to 5.4 (route migration / flat-translation-key deletion) or 5.5 (admin sections), or to Branch 6 (growing the FormDefinition schema)?
2. **`small-interface-deep-implementation`.** Is the added interface (`getPage`, `getForm`, parameterized `bust`, the `BustTarget` union + `bustSite`/`bustPage`/`bustForm` constructors) small and deep? Is the per-object cache machinery hidden behind it?
3. **Branch module interface honored.** The Branch 5 plan section states: `Content` gains `getPage(name)` and `getForm(name)`, each reading its object with its own decode boundary + fallback + independent cache-bust; per-object cache so editing About busts only About's cache, not the conference cache; `bust(scope)` parameterized over scope. Does the commit match this stated interface? Note the commit names the read-path discriminator `BustTarget` (over the registry's `PageId`/`FormId`) rather than reusing `DraftEditor`'s `ContentScope` — is that a sound boundary call (avoids the read path carrying the draft/published key pair + an import cycle), or a deviation from "parameterized over scope"?
4. **Subtract-before-you-add.** 5.3's share of the plan's deletions. Note: the candidate-5 god-bag retirement (deleting flat translation keys) is explicitly sub-commit **5.4**, and route migration is 5.4 — so 5.3 itself owes mainly the `bust()` → `bust(target)` signature migration of existing callers (the single site-publish caller in `DraftEditor.publish`). Did it migrate that caller and avoid leaving a parallel/legacy `bust` API? (`migrate-callers-then-delete-legacy-apis`.)
5. **Principle violations.** Any `cast-to-any`, stubs, commented-out code, or `as unknown as X`? Note the two `as PageContent<P>` / `as FormContent<F>` casts in `getPage`/`getForm` over the `ObjectCache.read: Effect<unknown>` — is the `unknown`-cache + cast at the typed-getter boundary justified (the registry's `PAGE_SPECS`/`FORM_SPECS` are `satisfies ObjectSpec<unknown, unknown>`, so the per-id precise type is recovered only at the getter), or should the cache be parameterized to avoid the cast? Is `make-impossible-states-unrepresentable` honored (closed `BustTarget` union, exhaustive switch)?
6. **Test surface for THIS slice.** The plan's 5.3-relevant test surface (from the Branch 5 "Test surface" bullet): `getPage`/`getForm` fallback-to-default; per-object cache-bust isolation (editing About doesn't bust conference); **one malformed page object can't break another's decode** (ADR 0008 headline blast-radius). Does the commit's `content.server.test.ts` additions cover each? Are there missed boundaries for THIS slice (e.g. reading a real published object; busting form independently)? (Per-object draft/published reconciliation tests belong to 5.2; do not flag their absence here.)
7. **Behavior regression.** Does the `bust` signature change (now `bust(target?: BustTarget = bustSite)`) preserve the existing site-publish behavior (default arg → site bust, the prior `bust()` semantics)? Does the eager per-object cache construction at layer build affect existing reads?

## Context for your review

### (a) The FULL synthesized plan

@/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md

### (b) ADR 0008 (the decision this branch realizes)

@/Users/cvr/Developer/personal/gyc/docs/adr/0008-per-page-storage-objects.md

### (c) The registry this commit reads through (Branch 5.2, already landed)

@/Users/cvr/Developer/personal/gyc/app/lib/content/pages/registry.ts

### (d) The branch PR-plan section under review

**Branch 5 — `reg-launch/per-page-content`** (see the plan's "Branch 5" section in full). Sub-commit list:
- (5.1) `RichText` + all six Page schemas + `HomePage` + `FormDefinition` placeholder + per-page/per-form defaults. — landed
- (5.2) `ContentScope` widened to page/form; `scopeKeys` page/form key-pairs; `DraftEditor.load`/`publish` reconciliation generalized per-object; tests. — landed
- **(5.3) `Content.getPage` + `getForm` multi-object read path (per-object cache + parameterized `bust`) + tests. — THE COMMIT UNDER REVIEW**
- (5.4) Migrate evergreen routes (incl. home) to `getPage`; delete the per-page flat translation keys. — NOT YET
- (5.5) Per-page `/admin` sections (via `DraftEditor` + `ListEdit`). — NOT YET

### (e) THIS commit — id + intent + diff

- **Commit:** `affdbd3` — `feat(cms)(per-page-content): Content.getPage + getForm multi-object read path`
- **Intent (sub-commit 5.3):** Content.getPage + getForm multi-object read path (per-object cache + parameterized bust) + tests.
- **Full diff:**

@/Users/cvr/Developer/personal/gyc/docs/.counsel/per-page-content-5.3.diff

### Gate status (already verified by the implementer)

`bun run typecheck && bun run lint && bun run build && bun test` — all green. typecheck clean; lint shows only two PRE-EXISTING warnings in files this commit does not touch (`app/lib/effect/form.test.ts`, `app/routes/($lang)+/_index.tsx`); build succeeds; 303 pass / 0 fail. The `WARN ... could not read ...` log lines during the test run are the deliberate fallback-on-NotFound / fallback-on-malformed negative-path assertions, not test failures.

Review ONLY this commit against sub-commit 5.3's slice. Be precise; cite diff hunks / file lines where you can.
