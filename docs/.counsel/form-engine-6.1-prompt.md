# Counsel review request — STANDARD review of ONE just-landed commit

You are Codex, giving a focused second-opinion code review. Review **only** the single
commit described below, against the plan. Do not review the whole stack. Do not propose
work that belongs to later sub-commits.

## What I need from you

Review commit **6.1** of Branch 6 (`reg-launch/form-engine`) and answer, concretely:

1. **Exact-slice fit.** Does this commit implement *exactly* sub-commit 6.1's slice —
   "FormDefinition schema + closed kind-set + tests" — no more (no renderer/decoder/action
   skeleton from 6.2, no contact/volunteer/registration field-graphs from 6.3–6.5, no
   equivalence harness from 6.5), and no less (the schema, the closed `FieldKind` set,
   variants, cross-field rules, and the round-trip + closure tests are all present)?
2. **small-interface-deep-implementation.** Does the module honor the branch's stated module
   interface (`FormDefinition` schema = data describing the field graph; renderer/decoder/
   action are explicitly later)? Is the surface small and the implementation deep, or is
   anything shallow / a thin pass-through / leaking?
3. **subtract-before-you-add.** Does this commit make its share of the plan's deletions?
   Specifically: the Branch 5.1 PLACEHOLDER `FormDefinition` (page-level copy only) is
   supposed to be *deleted* from `content/pages/schema.ts` and every caller migrated to the
   new `lib/forms/definition.ts` module (`migrate-callers-then-delete-legacy-apis`). Did the
   placeholder genuinely vanish, and did all callers (defaults, registry, the content.server
   + draft-editor tests, the pages/schema.test.ts placeholder tests) migrate cleanly with no
   parallel/duplicate `FormDefinition` left behind?
4. **Gate.** Does it pass `bun run typecheck && bun run lint && bun run build && bun test`?
   (I ran it: typecheck clean, lint has one PRE-EXISTING unrelated warning in
   `app/lib/effect/form.test.ts`, build OK, 343 pass / 0 fail.) Flag anything you think the
   gate would or should catch.
5. **Principle violations.** Any `make-impossible-states-unrepresentable`,
   `boundary-discipline`, `derive-dont-sync`, `correctness-over-pragmatism` violations? In
   particular: is the closed kind-set actually closed (can an author invent a ninth kind)?
   Are the `MessageKey` / `FieldName` / `OptionValue` brands the right boundary discipline?
   Is `MessageKey` correctly DERIVED from the live translations object (not a re-declared
   key list)? Any cast-to-any / stubs / commented-out code / `throw "not implemented"`?
6. **Missing tests for this slice.** Does the test surface cover what the plan demands for
   THIS slice — "closed-kind-set round-trips, impossible-field-kind unrepresentable"? Note
   that the full failure-matrix equivalence harness and `decode`/`render` tests are 6.2/6.5,
   NOT this slice — do not flag their absence as a gap.
7. **Behavior regression.** Could this change regress anything that exists today (the Branch
   5.1 per-form read path, `Content.getForm`, the draft-editor form reconciliation)? The
   form defaults now carry an empty `fields: []` graph — is that a safe interim state?

Return: a verdict (approve / approve-with-concerns / request-changes), an explicit list of
any BLOCKING issues (must-fix before this commit is sound), and lower-priority concerns.

---

## (a) The full synthesized plan

@docs/registration-launch-plan.md

## (b) The specific branch PR-plan section

The plan section governing this commit is **"Branch 6 — `reg-launch/form-engine` (Candidate 6,
ADR 0007) — RISKIEST"** in the file above. Its sub-commit list:

- (6.1) `FormDefinition` schema + closed kind-set + tests.   ← **THIS COMMIT**
- (6.2) Generic decoder + renderer + action skeleton + tests.
- (6.3) Migrate **contact** to the engine; harness green for contact.
- (6.4) Migrate **volunteer**; harness green for volunteer.
- (6.5) Author `registration-spec.md` + rename old schema → `registration-schema.oracle.ts` +
  build registration definition; full-matrix + render-parity equivalence harness green; migrate
  all four registration callers.
- (6.6) Delete the three old schemas + oracle once the harness is green.

The module shape the branch promises for the form engine:
- **`FormDefinition` schema (`forms/definition.ts`) — closed kind-set (ADR 0007, CONTEXT §Form
  definition):** discriminated union of ~8 `FieldKind`s — `requiredText`, `optionalText`,
  `email`, `url`, `literal` (radio), `checkboxBoolean`, `arrayOfLiteral`, `nestedGroup` — plus
  discriminated-union variant support + cross-field rules. A `FormDefinition` is data
  (`forms/<form>.json`), bilingual labels/placeholders. `make-impossible-states-unrepresentable`:
  cannot invent a field type outside the closed set.

This commit must land ONLY the schema + closed kind-set + its tests. It also makes its share of
the deletion: it replaces the Branch 5.1 placeholder `FormDefinition` that lived in
`content/pages/schema.ts` and migrates all callers to the new module.

## (c) This commit — id, intent, diff

- **Commit:** `1c73d00` — `feat(forms)(form-engine): FormDefinition schema + closed kind-set + tests`
- **Intent (sub-commit 6.1):** land the structural `FormDefinition` Effect Schema (the closed
  `FieldKind` tagged union, the `FormVariantSet` discriminated-union support, the closed
  `CrossFieldRule` set, the `MessageKey`/`FieldName`/`OptionValue` boundary brands) in a new
  `app/lib/forms/definition.ts`, with round-trip + closure tests; AND delete the Branch 5.1
  page-copy-only placeholder `FormDefinition` from `content/pages/schema.ts`, migrating every
  caller (defaults, registry, content.server + draft-editor tests) to the new module.
- **Full diff:** `docs/.counsel/form-engine-6.1.diff` (read it for the exact changes).

@docs/.counsel/form-engine-6.1.diff

## Grounding (read as needed)

- ADR 0007: `docs/adr/0007-structural-form-builder.md` (the closed-kind-set decision + the
  equivalence-harness migration strategy — note the harness is 6.5, not this commit).
- CONTEXT §Form definition: `CONTEXT.md` (the domain glossary entry for a Form definition).
- The new module: `app/lib/forms/definition.ts`.
- The new tests: `app/lib/forms/definition.test.ts`.
