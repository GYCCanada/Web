# Counsel review — registration-launch Branch 4 (`reg-launch/section-skip`), sub-commit 4.2

You are Codex, performing a STANDARD (not deep) review of a SINGLE just-landed commit in a
stacked-PR stack. Review ONLY this commit against the plan slice it claims. Be terse and
specific; cite file:line.

## What to review

**Commit 4.2** — `test(conference)(section-skip): cover every skip + the present-but-empty hard-error`
(git sha `6b8d040`).

Its intent (from the plan's sub-commit list for Branch 4):
> (4.2) Tests for every skip + the present-but-empty hard-error case.

This is the SECOND and FINAL sub-commit of Branch 4. Sub-commit 4.1 (`78fa969`,
already landed in this branch) added the actual gating — each `ConferenceDetail`
section gated on the `Option`/empty-array boundary data. **4.2 is tests-only**: it
pins 4.1's gating from the outside (render-to-string) and proves items stay strict
at the schema (decode) layer. It adds NO production code.

The commit's full diff is at:
`/Users/cvr/Developer/personal/gyc/docs/.counsel/section-skip-4.2.diff`

## Context you are given

1. The FULL synthesized plan: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`.
   Read it for the stack shape, principles, and the deletion/subtract discipline.

2. The specific branch section is **"Branch 4 — `reg-launch/section-skip`"** in that plan
   (Candidate 2, settled #3). Its stated module shape: **no new module** — `ConferenceDetail`
   gains the gating; `toConference` already emits the section-presence discriminators
   (`undefined`/`[]`). Its **test surface** (the slice 4.2 must implement):
   > `conference-detail.test.tsx` grows — empty `speakers` omits the speakers section;
   > absent `mapEmbedUrl` + empty `hotels` omits `MapSection`; absent `registrationUrl`
   > omits the register button; `/2025` (all empty) renders hero + FAQ only. A *present*
   > hotel missing `name` fails decode (`schema.test.ts`) — proving skip ≠ tolerance for
   > half-filled content.

   Its sub-commits:
   > (4.1) Gate each section on the `Option`/empty-array boundary data.  ← already landed (`78fa969`)
   > (4.2) Tests for every skip + the present-but-empty hard-error case.  ← THIS commit

3. Settled decision #3 (do NOT re-litigate): **Section skip = section-level, items stay
   strict.** Empty list / absent optional block → skipped silently. A present item with a
   blank required bilingual field → hard validation error. The `Text` both-locales invariant
   is never relaxed; validation lives in the schema, never the component.

## The questions to answer (this commit ONLY)

1. **Exact slice — no more, no less.** Does 4.2 implement exactly its slice (the test
   surface above) — every skip case + the present-but-empty hard-error — and nothing that
   belongs to another sub-commit/branch? Since 4.2 is tests-only, flag any production-code
   change that leaked in (there should be none). Flag any plan-required test for THIS slice
   that is missing (e.g. an un-covered gate, EN-only where FR is required, a skip case the
   plan named but the tests omit).

2. **Interface discipline (`small-interface-deep-implementation`).** Branch 4 adds no module;
   the tests exercise the existing `ConferenceDetail` prop interface (`<ConferenceDetail
   conference={...} />`) and the schema decode boundary. Do the tests pin behavior through the
   public boundary (render-to-string HTML / decode result), or do they reach into internals?

3. **Subtract-before-you-add.** 4.2's deletion share. The plan's Branch 4 "Subtract" is
   "any remaining author-note comments and dormant-render paths folded into ConferenceDetail;
   the gating replaces them" — that deletion belongs to 4.1 (the gating commit), not the
   tests commit. Confirm 4.2 isn't expected to delete anything, OR flag if it should have.

4. **Principles.** Any violation of: `make-impossible-states-unrepresentable` (does the
   present-but-empty test actually prove the schema rejects half-filled items, i.e. skip is
   section-level not item-level?), `prove-it-works` (do the skip tests assert the section is
   genuinely GONE from rendered HTML — not merely a weaker assertion?), `derive-dont-sync`,
   `boundary-discipline`, `correctness-over-pragmatism` (NO cast-to-any to fake an invalid
   item — though note a deliberate `unknown`-typed test fixture to construct an intentionally
   invalid payload is legitimate; judge whether the cast is test-fixture-legitimate vs a
   correctness dodge).

5. **Gate.** Confirm the commit is consistent with a green gate (typecheck/lint/build/test).
   The runner reports 265 pass / 0 fail. Flag any test that looks tautological, that would
   pass even if the gating were removed (i.e. a `not.toContain` on a string that never
   appears regardless), or a brittle assertion.

6. **Regression.** Does anything here regress 4.1's behavior or weaken an existing test?

## Output

Return a terse structured verdict:
- **blocking**: must-fix before this commit is acceptable (plan deviation, missing required
  test for the slice, principle violation, tautological/false-confidence test, leaked
  production change, broken gate).
- **concerns**: non-blocking observations worth noting.
- **verdict**: one line — accept / accept-with-nits / needs-work.

Remember: STANDARD review of ONE tests-only commit. Do not propose work that belongs to a
different sub-commit or branch. Do not re-litigate settled decisions.
