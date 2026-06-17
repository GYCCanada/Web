# Counsel review request — single just-landed commit (STANDARD review)

You are Codex, doing a focused code review of ONE just-landed sub-commit in a stacked-PR
program. Review ONLY this commit against the plan. Do not review the rest of the stack.

## What to judge (answer each explicitly)

1. **Exact-slice fidelity.** Does this commit implement EXACTLY sub-commit 6.4's slice —
   "Migrate volunteer; harness green for volunteer" — no more, no less? Flag any scope creep
   (work that belongs to 6.2/6.3/6.5/6.6) or any missing piece of 6.4.
2. **`small-interface-deep-implementation` + the branch's stated module interface.** Branch 6's
   engine surface is `FormDefinition` (data) + `FormFields` renderer + `decodeForm` decoder +
   the generic `formAction` skeleton. Does volunteer migrate onto that interface (definition +
   `getForm` + `<FormFields>` + `formAction`) rather than introducing a parallel path or
   widening the interface? Is the only form-specific code the `notify` body?
3. **Subtract-before-you-add (this commit's share of the plan's deletions).** Branch 6 deletes
   the hand-written `schema`/`clientSchema`/`Method`/cross-field-filter blocks in `volunteer.tsx`.
   Verify the volunteer hand-tuned schema and its `volunteer-schema.test.ts` genuinely VANISH
   here (not duplicated, not commented out). The oracle is retained ONLY inside the equivalence
   harness (correct per ADR 0007 — oracle deleted in 6.6). Confirm no parallel schema survives in
   the route.
4. **Gate.** `bun run typecheck && bun run lint && bun run build && bun test` — reviewer ran it:
   typecheck/lint/build pass (one pre-existing unrelated oxlint warning in `form.test.ts`), and
   `bun test` is 523 pass / 0 fail. Judge whether the commit's claims match.
5. **Principle violations.** No `cast-to-any` to silence types, no stubs, no commented-out code.
   `derive-dont-sync`: the route reads decoded fields off the generic `DecodedForm` record (a
   projection, not re-validation). `boundary-discipline`: the loader JSON is re-decoded through
   `FormDefinition` on the client. Judge these.
6. **Test surface required for THIS slice.** ADR 0007 + the plan demand an equivalence harness:
   oracle + FULL failure matrix (valid + every invalid variant) asserting (a) identical decoded
   output and (b) identical emitted `TranslationKey` sets, for the migrated form. For volunteer
   that means: per-method valid, every required field absent/empty/invalid-type, off-list method,
   each cross-field rule violated independently, EN+FR rendered-string parity. Is the matrix
   complete for volunteer? Are the TWO intentional deltas (email-format tightening; `positions`
   drop) each pinned by a dedicated, non-widenable test?
7. **Behavior regression.** The migrated `notify` mailer body must be byte-for-byte the old
   action's output (including the always-empty `Positions:` line). The two pinned deltas are the
   ONLY accepted behavioral changes — judge whether they are genuinely contained to one field
   each and whether the email-format tightening is a defensible correctness improvement vs a
   silent regression. Is anything else silently changed (default values, field order, success
   toast, honeypot)?

## The two pinned deltas — scrutinize

- **`email` format tightening:** pre-migration volunteer `Email` checked only `isMinLength(1)`
  and accepted a malformed address (a pre-existing drift from contact, which DID validate
  format). The engine's `email` kind validates format uniformly, so volunteer now rejects a
  malformed email. The commit claims this is a strict superset on the `email` field only, pinned
  by `emailFormatTightening`. Is that claim true and contained? Could it reject any payload the
  old form accepted in a way that matters?
- **`positions` drop:** the oracle decoded absent `positions` to `[]`; the multi-checkbox was
  never rendered (loader `positions: []` hardcoded), never submitted, and its options are dynamic
  loader data (never a closed `OptionList`), so it does not fit the closed `FieldKind` set and is
  dropped (`subtract-before-you-add`). The decoded-default delta is pinned by
  `decodedDeltaIsPositionsOnly` and `notify` keeps the empty `Positions:` line. Is dropping it
  correct, or does it lose a real capability?

## Output

Return: a verdict (approve / approve-with-concerns / request-changes), a list of BLOCKING issues
(must-fix before proceeding — plan deviation, principle violation, incomplete deletion, broken
gate, untested boundary, behavior regression), and a list of non-blocking concerns. Be concrete
and cite file:line.

---

## Context bundle

### (a) THE FULL PLAN

@docs/registration-launch-plan.md

### (b) THE SETTLED BRIEF

@docs/registration-launch-brief.md

### (c) ADR 0007 (the form-builder decision this branch realizes)

@docs/adr/0007-structural-form-builder.md

### (d) This commit's diff (commit 3a4915d — "feat(forms)(form-engine): migrate volunteer to the engine; harness green for volunteer")

@docs/.counsel/form-engine-6.4.diff

### Branch PR-plan section under review: "Branch 6 — `reg-launch/form-engine`"

The relevant sub-commit list (from the plan):
- (6.1) `FormDefinition` schema + closed kind-set + tests.
- (6.2) Generic decoder + renderer + action skeleton + tests.
- (6.3) Migrate **contact** to the engine; harness green for contact. [ALREADY LANDED]
- (6.4) Migrate **volunteer**; harness green for volunteer. **← THIS COMMIT**
- (6.5) Author `registration-spec.md` + rename old schema → oracle + build registration
  definition; full-matrix + render-parity equivalence harness green; migrate all four
  registration callers.
- (6.6) Delete the three old schemas + oracle once the harness is green.

Note: 6.3 (contact) established the harness pattern (`equivalence.contact.test.ts`). 6.4 is the
SECOND migration on that same pattern. The registration callers and the oracle file rename are
6.5/6.6 work and MUST NOT appear here.
