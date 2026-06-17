blocking[]: []

concerns[]:
- Stale doc pointers remain after deleting the artifacts. Non-blocking, but 6.6 should ideally sweep them because the subtraction orphaned its own references:
  - `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/defaults.ts:399-407` still cites deleted `forms/equivalence.contact.test.ts`.
  - `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/defaults.ts:493-519` still cites deleted `forms/equivalence.volunteer.test.ts`.
  - `/Users/cvr/Developer/personal/gyc/docs/forms/registration-spec.md:5-8` still says `registration-schema.oracle.ts` is kept until 6.6 and every row is asserted in deleted `equivalence.registration.test.ts`.
  These do not break runtime/typecheck, and they are not misleading enough to block the commit standing, but they are a real `subtract-before-you-add` cleanup miss.

overall verdict: approve / commit stands.

Answers:
1. Exact-slice fidelity: yes. Commit `546df51` deletes the three equivalence harnesses and `registration-schema.oracle.ts`, adds the surviving render-parity test, and adjusts registration’s seam so it no longer imports the oracle. No Branch 7 work appears.
2. Interface discipline: yes. The Branch 6 form-engine surface remains `definition.ts`, `render.tsx`, `decode.ts`, `action.ts`; this commit does not add a new public engine surface.
3. Subtraction completeness: production/code references are clean. `rg` found no import/reference to deleted harness/oracle files under `app/`, except stale docs/comments noted above.
4. Gate: passes based on the supplied reviewer run: typecheck clean, lint with one pre-existing untouched `require-yield` warning, build OK, `358 pass / 0 fail`. I did not rerun the gate in this read-only environment.
5. Principle violations: no blocking violation. The `as unknown as ReturnType<typeof Schema.toStandardSchemaV1<...>>` in `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/registration-form.tsx:104-118` is a type-only seam cast over unchanged runtime validation from `definitionToSchema(defaultRegistrationForm)`, not a shortcut that changes validation behavior.
6. Test surface: acceptable. The oracle-backed equivalence tests are removed, while render parity survives in `/Users/cvr/Developer/personal/gyc/app/lib/forms/registration-form.test.tsx:13-249`, including emitted field-name parity, default-key parity, and the `cameraOperator`/`photographer` regression class. Engine-level coverage remains in `definition.test.ts`, `decode.test.ts`, and `render.test.tsx`.
7. Behavior regression: none found. Registration runtime validation still derives from `/Users/cvr/Developer/personal/gyc/app/lib/forms/decode.ts:472-475` via `definitionToSchema(defaultRegistrationForm)` and is wrapped in `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/registration-form.tsx:104-118`; the action remains outside this slice.