# Deep adversarial review — WHOLE `reg-launch/form-engine` PR (Branch 6)

You are Codex, performing a **holistic, adversarial, --deep** review of the **entire assembled
`reg-launch/form-engine` pull request** — all six sub-commits (6.1–6.6) viewed as one unit, not
commit-by-commit. Each sub-commit was already reviewed individually and its blocking feedback
applied. Your job now is the **whole-PR** question: does the assembled diff fully realize its plan
section, cohere across its slices, and uphold the principles — with **no half-migrated caller and no
dead code left between slices**?

This is the **riskiest PR in the stack**. Scrutinize the riskiest parts hardest (enumerated below).
Be specific: cite file + line/hunk from the diff. Distinguish a true **BLOCKER** (must fix before
merge) from a **CONCERN** (worth noting) from a **NIT**. Do not invent gaps that the settled brief
explicitly rules out (see Non-goals). Reward correct subtraction — but verify it actually happened.

---

## What to read (provided context)

1. **The full synthesized plan:** `docs/registration-launch-plan.md` — the whole stack. Branch 6's
   section is **"Branch 6 — `reg-launch/form-engine` (Candidate 6, ADR 0007) — RISKIEST"** plus the
   **"Riskiest commit + how the harness pins it"** section near the end. Read the WHOLE plan so you
   understand what Branches 1–5 already delivered (this PR stacks on Branch 5's `getForm` multi-object
   read path + the widened `ContentScope`; Branch 2's `ListItemId`; Branch 3's `ExternalHttpsUrl`).
2. **The settled brief:** `docs/registration-launch-brief.md` — settled decisions (do NOT re-litigate)
   + **Non-goals** (do NOT flag these as gaps).
3. **ADR 0007** `docs/adr/0007-structural-form-builder.md` — the decision this PR realizes.
4. **CONTEXT.md** §Form definition, §Submission, §Registration channel — the domain language.
5. **The whole-PR diff:** `docs/.counsel/form-engine-WHOLE.diff` — `git diff
   per-page-content...reg-launch/form-engine` (three-dot; base = Branch 5 tip `per-page-content`,
   which is the stacked parent of this branch). This is the entire form-engine PR.

The six sub-commits assembled in this diff (in order):
- **6.1** `FormDefinition` schema + closed kind-set + tests (`app/lib/forms/definition.ts`).
- **6.2** generic decoder + renderer + action skeleton + tests
  (`app/lib/forms/decode.ts`, `render.tsx`, `action.ts`), plus a fix-commit addressing the 6.2 review
  (empty cross-field target; variant `nestedGroup` presence).
- **6.3** migrate **contact** to the engine; equivalence harness green for contact.
- **6.4** migrate **volunteer**; harness green for volunteer.
- **6.5** author `docs/forms/registration-spec.md` + rename old schema →
  `registration-schema.oracle.ts` + build the registration definition; **full-matrix +
  render-parity equivalence harness green**; migrate all four registration callers
  (`registration-form.tsx`, `2024/form/route.tsx`, `2025/form/route.tsx`, `2026/form/route.tsx`).
- **6.6** delete the three old hand-tuned schemas + the oracle + the equivalence harness files once
  the harness is green (the harness depends on the oracle, so they retire together per ADR 0007).

---

## The holistic questions (answer each explicitly)

### A. Does the assembled PR fully realize its plan section?

- **Interface depth.** The plan names four module surfaces: `FormDefinition` schema
  (`definition.ts`), generic decoder (`decode.ts` — `decodeForm(def, payload): Result<Decoded, Issue>`),
  generic renderer (`render.tsx` — `<FormFields definition={def} />`), generic action skeleton
  (`action.ts`). Are these the small-interface/deep-implementation modules the plan promised, or did
  any degrade into a shallow pass-through or a god-function? Does the closed `FieldKind` kind-set
  genuinely make an arbitrary field type unrepresentable (`make-impossible-states-unrepresentable`)?
- **ALL deletions made.** The plan's subtract list (Branch 6 "Subtract"): `registration-schema.oracle.ts`
  deleted; the hand-written `schema`/`clientSchema`/`Method`/cross-field-filter blocks in `contact.tsx`
  and `volunteer.tsx` deleted; the triplicated `routeFormAction` bodies collapsed to the generic
  skeleton; `registration-schema.test.ts` replaced. **Run the deletion test on each:** does the diff
  actually remove these lines, or do dead remnants survive? Confirm `contact.tsx` and `volunteer.tsx`
  no longer carry their own hand-tuned Effect Schema + Method discriminator + cross-field filter.
  Confirm no orphaned import of a deleted symbol survives anywhere.
- **Complete test surface.** The plan demands: the equivalence harness (oracle + **full failure
  matrix** + render parity), `definition.test.ts` (closed-kind-set round-trips, impossible-field-kind
  unrepresentable), `decode.test.ts` (each kind decodes; cross-field rules fire at the right path with
  the right key), `render.test.tsx` (each kind renders; discriminator switches conditional fields).
  The equivalence harness + oracle are **deleted in the final state** (6.6) per ADR 0007 ("oracle
  removed once registration is fully migrated"). **Is the standing (post-deletion) test surface still
  adequate** — i.e. do `decode.test.ts` / `definition.test.ts` / `render.test.tsx` /
  `registration-form.test.tsx` independently pin the behaviour the now-deleted harness proved, or did
  deleting the harness leave a coverage hole (e.g. a cross-field rule or a discriminator branch now
  untested)? This is a key whole-PR question: the harness was scaffolding; verify it left durable
  tests behind, not a gap.
- **No behavior regression.** Contact + volunteer run **server-side** today (`parseSchema`). Does the
  engine emit identical decoded output AND identical `TranslationKey` error sets (same paths via
  conform's `formatPath`, same keys) for those two? Registration is **client-only** (verified no-op
  server action) — does the migration preserve the client `RegistrationStandardSchema` validation +
  the rendered field-name/default-value parity vs the old `registration-form.tsx`?
- **Principles upheld.** `migrate-callers-then-delete-legacy-apis` (callers migrated BEFORE the schema
  is deleted — verify ordering across 6.5→6.6, no window where a caller imports a deleted symbol);
  `subtract-before-you-add`; `derive-dont-sync` (the closed-set + the message-key validity derived from
  the live `translations`, not re-declared); `boundary-discipline`; **`correctness-over-pragmatism`:
  flag ANY `as any`, `as unknown as`, `as never`, stub, or commented-out code introduced by this PR —
  and judge whether each is a legitimate schema-builder seam cast or a smell.** (Note: `decode.ts` has
  `as never` / `as unknown as Schema.Codec` at the `definitionToSchema` boundary, and
  `registration-form.tsx` has a "cast at the seam" for conform's typed field metadata — judge whether
  these are the minimal, justified, well-commented seams the plan's `derive-dont-sync` note sanctions,
  or whether they hide a real type hole.)

### B. Does it cohere across its sub-commits?

- **No half-migrated caller.** All four registration callers
  (`registration-form.tsx`, `{2024,2025,2026}/form/route.tsx`) must read from the engine definition.
  Is any one still on the old schema path?
- **No dead code between slices.** Did 6.2 introduce a helper that 6.5 made obsolete? Did a
  fix-commit (`750f381`) leave a superseded branch? Is `action.ts`'s skeleton actually used by all
  three migrated forms, or does a form still carry its own inline `parse→send→toast` body?
- **One decode boundary.** The plan says the generated codec reuses `parseSchema`/`formatSchemaResult`
  verbatim so error paths/keys come from one shared mechanism. Verify the decoder did NOT re-invent
  path serialization or message bucketing.

### C. Scrutinize the riskiest parts HARDEST

This PR's plan flags three specific risk surfaces — attack each:

1. **The equivalence harness for registration (B6's headline risk).** Registration is a 2-way
   discriminated union (attendee/exhibitor) with ~10 cross-field validators, a `StringToBoolean`
   three-token codec (`true`/`false`/`on`), and every error path must emit a real `TranslationKey` (a
   wrong/absent key renders blank — silent failure). The harness was supposed to feed **valid + every
   invalid variant** (missing each required field, off-list literal, bad email, bad url, each
   cross-field rule violated independently, the attendee-vs-exhibitor discriminator branches, the
   three checkbox-boolean tokens) through BOTH oracle and engine asserting **(a)** identical decoded
   output, **(b)** identical emitted `TranslationKey` sets, **(c)** render-level field-name +
   default-value parity. Inspect the harness as it existed in 6.5 (in the diff, file
   `app/lib/forms/equivalence.registration.test.tsx`, since deleted in 6.6) and the surviving
   `registration-form.test.tsx`: **was the matrix genuinely full, or thin?** Did any failure path get
   asserted only on decoded output but NOT on the emitted key (the silent-blank-render risk)? After
   6.6 deleted the harness, is the three-token codec + each cross-field rule + the discriminator split
   still covered by a standing test?
2. **`decode.ts`'s reconstruction of server-side validation.** The single accumulating struct-level
   presence filter (`makePresenceFilter`) is load-bearing: chained `.check`s would ABORT after the
   first failure, so two unsatisfied rules (the contact/volunteer `email`+`phone` pair) would surface
   only one. Verify the implementation actually accumulates (not aborts) and that the variant
   presence + cross-field rules compose into ONE filter. Check the `optional`-at-key vs
   non-empty-when-present modelling (an `optional: true` email with value `""` must still emit
   `requiredMessage`) — does it? Check `nestedGroup` `optional` presence (the always-rendered `extra`
   absent inside a selected variant must error at its first inner required field; an `optional` group
   absent must be valid).
3. **`Option`→`string|undefined` / closed-set integrity at the boundary.** (For this PR the analogue
   of B3's Option-projection concern is the `MessageKey`/`FieldName`/`OptionValue` brands.) Verify a
   hand-edited definition cannot reference an off-list translation key (would render blank), cannot
   smuggle a dotted path / `[` / whitespace into a `FieldName` the decoder interpolates into a
   form-data path (`boundary-discipline`), and cannot create a discriminator with an option that
   branches to no variant or a variant unreachable by any option (the `variantsMatchOptions` bijection).

---

## Non-goals (do NOT flag these as gaps)

- **Registration has no server decode today** and this PR does **not** add one — it is a verified
  no-op server action; registration is **client-only** in prod (the harness for registration is
  client-validation parity + render parity, NOT server-decode parity). Wiring a registration *server*
  action + persistence is **net-new work deferred to Branch 7** — do not flag its absence here.
- **RegFox carries Friday's launch** (settled #9); the on-site form is built/proven but not
  load-bearing — do not flag "the on-site form isn't wired as the live channel."
- Field kinds are a **closed set** (~8), not an arbitrary builder — do not ask for more kinds.
- Submission persistence is **Branch 7**, not here — do not flag missing persistence.
- The oracle + equivalence harness being **deleted in the final state is correct** (ADR 0007) — do
  NOT flag the deletion as lost coverage UNLESS you can show a specific behaviour the harness proved
  that no standing test now covers.

---

## Output format

1. **Verdict:** one line — does the assembled PR realize Branch 6 and cohere, ship-ready or not.
2. **BLOCKERS** (must fix before merge) — each with file:line/hunk from the diff + why.
3. **CONCERNS** (worth fixing, not blocking) — each with a receipt.
4. **NITS** (optional polish).
5. **What's done well** (so the implementer knows what NOT to churn).

Cite file paths and line/hunk references for every claim. Show the trail.
