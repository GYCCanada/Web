# Counsel review — registration-launch Branch 5, sub-commit 5.1

You are Codex, doing a STANDARD (not deep) review of a SINGLE just-landed commit on the
GYC registration-launch stacked-PR stack. Review ONLY this commit, ONLY against the plan
slice it is meant to implement. Do not redesign; do not review the rest of the stack.

## What to judge (answer each, with file:line receipts)

1. **Exact slice — no more, no less.** Does the commit implement EXACTLY sub-commit 5.1's
   slice (RichText + all six Page schemas + HomePage + FormDefinition placeholder + per-page/
   per-form defaults + the tests the plan's 5.1 test surface names)? Flag anything that
   belongs to 5.2 / 5.3 / 5.4 / 5.5 (read-path, ContentScope widening, route migration, admin
   sections, flat-key deletion) leaking in early, AND anything 5.1 should contain that is missing.
2. **small-interface-deep-implementation + the branch's stated module interface.** Branch 5's
   shape: per-page typed schemas in `app/lib/content/pages/*.ts`, a shared closed `RichText`
   primitive, a `FormDefinition` placeholder that is a REAL decode boundary (title + optional
   intro) for Branch 5.3's per-form read path. Is the interface small and the implementation
   honest? Is RichText genuinely CLOSED (no arbitrary HTML smuggling)?
3. **subtract-before-you-add — this commit's share of deletions.** 5.1 is purely additive in
   the plan (the god-bag deletion is 5.4's slice, route migration 5.4, admin 5.5). So 5.1 owns
   NO deletion. BUT: does it ADD duplication it should have avoided? Specifically: the base
   `app/lib/content/schema.ts` already defines `IdListArray` + `uniqueListItemIds` (as
   module-PRIVATE, non-exported helpers). `pages/schema.ts` RE-STATES both locally. Is that a
   defensible local copy (originals are unexported) or a DRY violation that should instead
   export+share the base helper? Judge against subtract-before-you-add / derive-dont-sync.
4. **Gate.** The full gate passed locally: typecheck clean, lint clean (only 2 PRE-EXISTING
   warnings in unrelated files: `_index.tsx:209` unused `translate`, `form.test.ts:122`
   require-yield), build OK, `bun test` 286 pass / 0 fail. Any reason to doubt prove-it-works
   for THIS slice?
5. **Principle violations.** make-impossible-states-unrepresentable (Text both-locales,
   closed RichText, LinkHref = https|mailto only reusing the ExternalHttpsUrl XSS boundary),
   boundary-discipline (ListItemId, defaults decoded NOT `.make`'d), correctness-over-pragmatism
   (NO cast-to-any, NO stubs, NO commented-out code). The FormDefinition "placeholder" — is it a
   legitimate typed boundary or a disguised stub? (It decodes real JSON; Branch 6 GROWS it.)
6. **Test surface the plan requires for THIS slice.** Plan 5.1 test surface (`pages/*.test.ts`):
   each schema round-trips; RichText token round-trip; present-but-empty hard-error. Does the
   landed `pages/schema.test.ts` cover that, plus the LinkHref XSS accept/reject matrix and the
   closed-token-set rejection? Any required-for-5.1 test missing?
7. **Behavior regression.** 5.1 adds new files only (no route/read-path touched yet), so it
   should regress nothing. Confirm the defaults carry today's real bilingual copy (faithful
   transcription is the point; byte-identical render parity is explicitly a 5.4 concern).

## Output

A focused verdict: BLOCKING items (must fix before proceeding), non-blocking CONCERNS, and an
overall pass/revise call FOR THIS COMMIT ONLY.

---

## Context bundle

### (a) THIS commit — id + intent

- Commit: `c4a7da9` `feat(cms)(per-page-content): RichText + six Page schemas + HomePage + FormDefinition placeholder + per-page/per-form defaults`
- Intent (plan sub-commit 5.1): "RichText + all six Page schemas + HomePage + FormDefinition
  placeholder schema-type + per-page/per-form defaults."
- Files (all NEW, +821 lines): `app/lib/content/pages/schema.ts` (269),
  `app/lib/content/pages/defaults.ts` (349), `app/lib/content/pages/schema.test.ts` (203).
- Full diff: `docs/.counsel/per-page-content-5.1.diff` (read it).

### (b) Base schema helpers it builds on (`app/lib/content/schema.ts`)

- `Text = Struct({ en: NonEmptyString, fr: NonEmptyString })` — bilingual, both required.
- `ExternalHttpsUrl` = NonEmptyString.check(parse: https-only, no embedded credentials).brand.
- `ListItemId` = NonEmptyString.check(`^[A-Za-z0-9_-]{21}$`).brand; `newListItemId()` mints one.
- `uniqueListItemIds` filter + `IdListArray(item)` — BOTH module-PRIVATE (not exported). This is
  the DRY question in judgement #3: pages/schema.ts re-states both locally.

### (c) The FULL plan

@docs/registration-launch-plan.md

### (d) Branch 5 PR-plan section (the slice authority)

See "## Branch 5 — `reg-launch/per-page-content` (Candidate 5, ADR 0008)" in the plan above —
especially "Sub-commits (high-blast-radius → 5)": 5.1 is the FIRST and is additive (schemas +
defaults + tests). 5.2 widens ContentScope; 5.3 adds getPage/getForm; 5.4 migrates routes +
deletes flat keys; 5.5 adds admin sections. Anything from 5.2–5.5 in this commit is scope creep.

### (e) Settled decisions (DO NOT re-litigate)

@docs/registration-launch-brief.md

### (f) ADR 0008 (per-page/per-form storage objects — realize, don't re-open)

@docs/adr/0008-per-page-storage-objects.md
