# Counsel review — registration-launch Branch 6 (`reg-launch/form-engine`), sub-commit 6.2

You are doing a STANDARD (not deep) review of a SINGLE just-landed commit in a stacked-PR
program. Review ONLY this commit against the plan. Do not review other commits, the rest of
the branch, or the whole program. Do not propose new scope.

## The commit under review

- **Commit:** `ae11a8c` — `feat(forms)(form-engine): generic decoder + renderer + action skeleton + tests`
- **Intent (sub-commit 6.2 of Branch 6):** "Generic decoder + renderer + action skeleton + tests."
- **Diff:** `docs/.counsel/form-engine-6.2.diff` (read it in full; 6 new files, +1569, no deletions).
- Files added: `app/lib/forms/{decode.ts,decode.test.ts,render.tsx,render.test.tsx,action.ts,action.test.ts}`.
- Prior commit `ef8c6e0` landed 6.1 (`FormDefinition` schema + closed kind-set + tests) in
  `app/lib/forms/definition.ts`; this commit does NOT touch `definition.ts` — it builds on it.

## What 6.2 is supposed to be (from the plan)

Branch 6 module shape (`app/lib/forms/`):
- **Generic decoder (`forms/decode.ts`):** `decodeForm(def, payload): Result<Decoded, Issue>` —
  reconstructs server-side Effect Schema validation FROM the `FormDefinition`, emitting real
  `TranslationKey` error sets driven by the definition (not hand-written), REUSING
  `parseSchema`/`formatSchemaResult` (one shared boundary; `derive-dont-sync`,
  `subtract-before-you-add` — don't re-invent path serialization / message bucketing).
- **Generic renderer (`forms/render.tsx`):** `<FormFields definition={def} />`. Absorbs the
  method-discriminator + cross-field-filter UI duplicated across contact/volunteer and the
  per-kind control markup triplicated across the three forms. Closed `FieldKind` set ⇒ total
  switch (`make-impossible-states-unrepresentable`).
- **Generic action skeleton (`forms/action.ts`):** the `parseSubmission → decodeForm →
  send/persist → toast.redirect` pipeline parameterized by form name (replaces the triplicated
  `routeFormAction` bodies). `notify` MUST stay a separable callback so Branch 7 can land a
  `Submissions.persist` step in FRONT of it without rewriting the skeleton.

6.2 is the engine landing **before** any caller migrates. Plan sub-commit list for Branch 6:
- (6.1) `FormDefinition` schema + closed kind-set + tests. ← already landed
- **(6.2) Generic decoder + renderer + action skeleton + tests. ← THIS COMMIT**
- (6.3) Migrate **contact** to the engine; harness green for contact.
- (6.4) Migrate **volunteer**; harness green for volunteer.
- (6.5) Author `registration-spec.md` + rename old schema → oracle + registration definition;
  full-matrix + render-parity equivalence harness green; migrate all four registration callers.
- (6.6) Delete the three old schemas + oracle once harness green.

Test surface the plan names for Branch 6 (6.2's share is the per-module unit tests, NOT the
equivalence harness which is 6.3+): `forms/decode.test.ts` (each kind decodes, cross-field
rules fire at the right path with the right key); `forms/render.test.tsx` (each kind renders,
discriminator switches conditional fields). The equivalence harness + spec doc + oracle are
explicitly 6.5's slice, NOT 6.2's.

## Settled decisions (DO NOT re-litigate)

- Registration is **client-only today** — `2026/form/route.tsx` action is a verified no-op
  (`Effect.void`); `registration-schema.ts` powers ONLY client `RegistrationStandardSchema`.
  So 6.2's decoder is net-new validation logic, not equivalent-to-an-existing-server-path; the
  equivalence/render-parity proof is deferred to 6.5. Do NOT flag "decoder has no caller yet" or
  "no equivalence harness" as a gap — those are 6.3–6.5 by plan.
- Closed `FieldKind` set (~8 kinds: requiredText, optionalText, email, url, literal,
  checkboxBoolean, arrayOfLiteral, nestedGroup) + discriminated variant + cross-field rules.
  Not an arbitrary builder.
- Forms are read via Branch 5's `Content.getForm` (already landed). `notify` separable from a
  future `persist` (Branch 7). No DB; JSON in bucket.
- Effect v4 (effect-smol) Schema API. `parseSchema`/`formatSchemaResult` live in
  `app/lib/effect/form-schema`; `routeFormAction`/`SubmissionContext` in `app/lib/effect/form`.

## Principles to judge against (`~/.brain/principles/`)

`small-interface-deep-implementation`, `make-impossible-states-unrepresentable`,
`boundary-discipline`, `subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis`,
`derive-dont-sync`, `correctness-over-pragmatism` (NO cast-to-any to silence types, NO stubs,
NO commenting-out, NO `throw new Error("not implemented")`).

## Review questions (answer each, with file:line receipts)

1. **Exact slice — no more, no less.** Does 6.2 implement EXACTLY decoder + renderer + action
   skeleton + their unit tests? Does it overreach (migrate a caller, delete an oracle, author the
   harness/spec — all later sub-commits) or underreach (a named module/capability missing)?
2. **Interface depth.** Are `decodeForm` / `<FormFields>` / `formAction` small surfaces over deep
   implementations? Any shallow pass-through or leaked internal (e.g. the bucket-key idiom, the
   conform internals, the `Issue` tree) crossing a boundary it shouldn't?
3. **`make-impossible-states-unrepresentable` / closed set.** Is the `FieldKind` switch total with
   no unsafe default? Can a definition carry a field the renderer/decoder has no case for?
4. **`derive-dont-sync` + `subtract-before-you-add`.** Does the decoder genuinely REUSE
   `parseSchema`/`formatSchemaResult` (one boundary) rather than re-implement path/bucket logic?
   6.2 lands NEW code with no deletions — is that correct for this slice (the deletions are 6.6,
   gated on the harness), or should something have died here?
5. **Gate.** Typecheck/lint/build/test all pass (confirmed green by the implementer). Any
   `as any` / `as unknown as` / `as never` casts that silence a real type hole rather than a
   genuine Schema-variance bridge? (Note `decode.ts:348-350` casts `struct.check(filter as never)`
   and the final `as unknown as Schema.Codec` — judge whether these are legitimate Effect Schema
   filter-variance bridges or a correctness bail-out.)
6. **Behaviour fidelity to the hand-tuned siblings.** The decoder claims to reproduce the
   `true/false/on` checkbox codec, the attendee/exhibitor variant presence-at-own-path model, and
   the `method`-gated cross-field rule. Reading `decode.ts`, are these faithful? Any path/key that
   would render blank (wrong/absent `TranslationKey`) or a variant field demanded on the wrong
   branch? The `optionalText`/`nestedGroup` exclusion from variant presence (decode.ts:263-269) —
   correct, or does it silently drop a required field?
7. **Test adequacy for THIS slice.** Do the three test files cover each `FieldKind`, the
   cross-field rule firing at the right path/key, and the variant branch switching (render +
   decode)? Any 6.2-slice behaviour untested (e.g. `formAction` notify-failure-aborts-redirect,
   honeypot short-circuit, locale projection)? Do NOT require the equivalence harness here.
8. **Regression risk.** 6.2 adds files only; does anything it adds change behaviour of an existing
   caller before 6.3 migrates them? (It shouldn't — nothing imports these yet.)

## Output

Give a verdict (approve / approve-with-concerns / request-changes), a list of BLOCKING issues
(must-fix before this commit is sound: principle violation, slice overreach/underreach, a cast
that hides a correctness hole, a wrong/blank `TranslationKey` path, a missing 6.2-slice test),
and non-blocking concerns. Cite `file:line` for every finding.
