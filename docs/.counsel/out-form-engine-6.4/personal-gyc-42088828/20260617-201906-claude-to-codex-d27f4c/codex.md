**Verdict: request-changes**

**Blocking Issues**

1. Volunteer’s method-gated UI regressed: email and phone now render unconditionally.
Old volunteer rendered `email` only for `method === "email" || "both"` and `phone` only for `method === "phone" || "both"` at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx` pre-commit lines 307-330. The new route delegates to `<FormFields>` at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:169-172`; `FormFields` renders every top-level `definition.fields` entry unconditionally at `/Users/cvr/Developer/personal/gyc/app/lib/forms/render.tsx:237-245`; and `defaultVolunteerForm` places both `email` and `phone` as top-level fields at `/Users/cvr/Developer/personal/gyc/app/lib/content/pages/defaults.ts:552-573`. That violates the branch promise that the engine absorbs the duplicated “method-discriminator + cross-field-filter UI” rather than changing it, and it is outside the two pinned deltas.

2. The 6.4 harness does not catch that UI regression.
The harness asserts decoded success parity, emitted validation key parity, and rendered error-string parity at `/Users/cvr/Developer/personal/gyc/app/lib/forms/equivalence.volunteer.test.ts:320-347`, but it does not assert volunteer field visibility/name/default render parity. Because this slice migrates the actual route UI to `<FormFields>`, and the old behavior had conditional email/phone rendering, the test surface is incomplete for the behavioral risk that actually regressed.

**Non-Blocking Concerns**

- The `email` delta is explicit and defensible as a correctness tightening, but it is broader than just “malformed accepted payloads”: empty-present email now emits both `.required` and `.error`, pinned at `/Users/cvr/Developer/personal/gyc/app/lib/forms/equivalence.volunteer.test.ts:403-414`. That is contained to `email`, but it is still a user-visible error-set change.
- Phone and age input chrome changed: old phone was `type="tel"` and old age was `type="number"` at pre-commit `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:320-339`; generic `requiredText` renders an untyped input at `/Users/cvr/Developer/personal/gyc/app/lib/forms/render.tsx:61-73`. This is likely less serious than the conditional-render regression, but it is another unpinned UI behavior change.
- I did not rerun `bun run typecheck && bun run lint && bun run build && bun test` in this read-only sandbox. I can only judge the supplied gate claim and the commit message’s stated result.

**Explicit Checks**

- Exact-slice fidelity: mostly yes, except the UI regression means the volunteer migration is not behavior-preserving for 6.4.
- Small interface/deep implementation: route does use `Content.getForm`, `FormDefinition`, `<FormFields>`, `decodeForm` through `formAction`, and keeps form-specific mailer logic localized around `notify` at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:44-51` and `:95-124`.
- Subtract-before-you-add: old route schema is gone from the route, `volunteer-schema.test.ts` is deleted, and the oracle exists only in `/Users/cvr/Developer/personal/gyc/app/lib/forms/equivalence.volunteer.test.ts:65-135`, which matches ADR 0007’s oracle-retention rule.
- Positions drop: seems correct. Pre-migration loader hardcoded `positions: []` at pre-commit `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:156-164`, so the checkbox block never rendered; the notify line remains preserved at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx:104-110`.
- Principle violations: no obvious `any`/stub/commented-out-code issue found in the reviewed slice, but the conditional UI regression violates the behavior-preserving migration principle behind ADR 0007.

**File References Used**

`/Users/cvr/Developer/personal/gyc/docs/.counsel/out-form-engine-6.4/personal-gyc-42088828/20260617-201906-claude-to-codex-d27f4c/prompt.md`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`  
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`  
`/Users/cvr/Developer/personal/gyc/docs/adr/0007-structural-form-builder.md`  
`/Users/cvr/Developer/personal/gyc/docs/.counsel/form-engine-6.4.diff`  
`/Users/cvr/Developer/personal/gyc/app/lib/content/pages/defaults.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/action.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/action.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/decode.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/definition.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/equivalence.volunteer.test.ts`  
`/Users/cvr/Developer/personal/gyc/app/lib/forms/render.tsx`  
`/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer.tsx`  
`/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/volunteer-schema.test.ts`