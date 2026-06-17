# Counsel review — registration-launch Branch 6 (`reg-launch/form-engine`), sub-commit 6.6

You are Codex, performing a STANDARD (not deep) review of a SINGLE just-landed commit
against a settled stacked-PR plan. Review **only this commit**, against **only its
sub-commit slice**. Do not propose scope beyond 6.6.

## What to judge (answer each explicitly)

1. **Exact-slice fidelity.** Does this commit implement *exactly* sub-commit 6.6's slice —
   "Delete the three old schemas + oracle once the harness is green" — no more, no less?
   Flag any work that belongs to an earlier sub-commit (6.1–6.5) or a later branch (7),
   and any part of 6.6's slice that is missing.
2. **`small-interface-deep-implementation` + the branch's stated module interface.** Branch 6's
   interface is the Form engine (`forms/definition.ts`, `forms/render.tsx`, `forms/decode.ts`,
   `forms/action.ts`). Does 6.6 keep that interface intact while removing the migration
   scaffolding, without leaking a new surface?
3. **`subtract-before-you-add` — this commit's share of the plan's deletions.** The plan
   (Branch 6 "Subtract") lists, deletable *only after the harness is green*:
   `registration-schema.oracle.ts` (the ~350-line oracle), the hand-written
   contact/volunteer schema blocks, the triplicated `routeFormAction` bodies, and
   `registration-schema.test.ts` → replaced by the harness then engine-level tests.
   6.6 is specifically the FINAL subtraction: delete the three old schemas + the oracle now
   that every migration is green. Does this commit make that subtraction cleanly and
   completely, leaving NO dangling reference to the deleted artifacts?
4. **Gate.** Does it pass `bun run typecheck && bun run lint && bun run build && bun test`?
   (Reviewer ran it: typecheck clean; lint = 1 pre-existing untouched `require-yield` warning;
   build OK; 358 pass / 0 fail.)
5. **Principle violations.** Any `correctness-over-pragmatism` violation (cast-to-any to silence
   types, stub, commented-out code), `migrate-callers-then-delete-legacy-apis`,
   `make-impossible-states-unrepresentable`, `derive-dont-sync`, `boundary-discipline`.
   Note: the commit casts the engine StandardSchema to a local `RegistrantInput` Schema's
   StandardSchema "at the seam" (`as unknown as ReturnType<typeof Schema.toStandardSchemaV1<…>>`).
   Judge whether this is the codebase's accepted seam-cast idiom (TYPE-only over an unchanged
   engine runtime; validation still flows from `definitionToSchema(defaultRegistrationForm)`)
   or a correctness violation.
6. **Test surface.** The plan's test surface for Branch 6 (post-oracle) is:
   `forms/definition.test.ts`, `forms/decode.test.ts`, `forms/render.test.tsx`, PLUS the
   registration RENDER-parity tests that must OUTLIVE the oracle (render-level field-name +
   default-value parity vs the live `<RegistrationForm>` — the only path registration exercises
   in prod, settled #9; the `cameraOperator`/`photographer` regression guard). Does 6.6
   correctly KEEP the render-parity tests (moved to `forms/registration-form.test.tsx`) while
   deleting the equivalence harnesses (which depended on the oracle)? Is any required coverage
   lost when the three `equivalence.*.test.*` files are deleted?
7. **Behavior regression.** Does deleting the oracle + harnesses regress any production behavior?
   Registration's live path is client validation + render (action is a verified no-op, RegFox is
   the live channel). `registration-form.tsx` no longer imports the oracle's `.Type`; it now owns
   a local `RegistrantInput` Schema for conform's field-accessor metadata. Confirm runtime
   validation is unchanged (still `definitionToSchema(defaultRegistrationForm)`).

## Reviewer's own findings (verify or refute — do not just echo)

- **Stale doc references to deleted files (CONCERN, likely non-blocking).** The commit message
  claims "Stale oracle-path doc references in decode.ts and defaults.ts updated to past tense,"
  but it updated only the `defaultRegistrationForm` block of `defaults.ts`. Still stale after 6.6:
  - `app/lib/content/pages/defaults.ts:~402` (`defaultContactForm` doc) cites
    `forms/equivalence.contact.test.ts` — a file this commit DELETES.
  - `app/lib/content/pages/defaults.ts:~496` (`defaultVolunteerForm` doc) cites
    `forms/equivalence.volunteer.test.ts` — deleted.
  - `docs/forms/registration-spec.md:1-8` still says the oracle is kept "until 6.6" and that
    "Every row here is an assertion in `app/lib/forms/equivalence.registration.test.ts`" — deleted.
  Judge: are these load-bearing (do they break anything / mislead a future agent badly), and
  does leaving them violate `subtract-before-you-add` (a deletion that orphans its own pointers)?
  Should 6.6 have swept them, or is a doc-only follow-up acceptable?

## Inputs

- **Full synthesized plan:** `docs/registration-launch-plan.md` (read it; Branch 6 section is
  lines ~215–256, the "Riskiest commit" section ~285–287, ordering hazards ~289–296).
- **The commit's diff:** `docs/.counsel/form-engine-6.6.diff` (commit
  `546df51` — `feat(forms)(form-engine): delete the three old schemas + oracle once the harness is green`).
- **Commit intent (6.6):** Delete the three old schemas + oracle once the harness is green.
  Net −1533 lines. Deletes `equivalence.contact.test.ts`, `equivalence.volunteer.test.ts`,
  `equivalence.registration.test.tsx`, `registration-schema.oracle.ts`; adds
  `forms/registration-form.test.tsx` (the surviving render-parity tests); rewrites the
  `registration-form.tsx` seam to a local `RegistrantInput` Schema; past-tenses some doc comments.

## Output

A concise structured verdict: `blocking[]` (must-fix before this commit stands), `concerns[]`
(noted, non-blocking), and an overall verdict. Be specific with file paths. Do not redesign the
branch; judge THIS slice.
