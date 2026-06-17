# Counsel review: commit 6.3 (Branch 6 — `reg-launch/form-engine`)

You are doing a STANDARD code review of a SINGLE just-landed sub-commit in a stacked-PR stack
implementing the GYC registration launch. Review ONLY this one commit against the plan. Do not
review the whole branch or re-litigate settled decisions.

## What to judge (answer each explicitly)

1. **Scope fidelity** — does the commit implement EXACTLY sub-commit 6.3's slice — no more, no
   less? 6.3 is: "Migrate **contact** to the engine; harness green for contact." It must NOT
   pull in volunteer (6.4), registration (6.5), the oracle deletion (6.6), or anything from
   Branch 7. It MUST land the contact migration + the contact equivalence harness.
2. **`small-interface-deep-implementation`** — does it honor the branch's stated module
   interface? The Form engine's surface is `FormDefinition` (data) + `definitionToSchema`/
   `decodeForm` (decoder) + `<FormFields>` (renderer) + `formAction({ form, notify, success })`
   (action skeleton). 6.3 should consume these, and the contact route should shrink to a
   `formAction` call + a `notify` callback — NOT grow a new parallel surface.
3. **`subtract-before-you-add`** — does this commit make its share of the plan's deletions? The
   branch deletes the hand-written `schema`/`clientSchema`/`Method`/cross-field-filter blocks in
   `contact.tsx` (6.3's share — the FULL oracle deletion is 6.6, gated on ALL forms migrating).
   Verify the hand-tuned contact schema is genuinely gone from the route (not duplicated), and
   that the old `contact-schema.test.ts` deletion is justified (coverage subsumed by the harness).
4. **Gate** — `bun run typecheck && bun run lint && bun run build && bun test`. (Reviewer ran it:
   434 pass / 0 fail; lint shows only one PRE-EXISTING `require-yield` warning in
   `app/lib/effect/form.test.ts:122`, unrelated to this commit. Confirm nothing here regresses it.)
5. **Principle violations** — any `cast-to-any`, stub, commented-out code, or
   `make-impossible-states-unrepresentable` / `boundary-discipline` / `derive-dont-sync`
   violation? The diff DOES contain two `as` casts in `decode.ts` (`definitionToSchema`'s return
   + `makePresenceFilter(...) as never`) and one in the harness (`engineCodec as ...`). Judge
   whether these are load-bearing-at-a-schema-boundary (acceptable) or type-laundering hiding a
   real unsoundness.
6. **Missing tests** — does the commit miss a test the plan's test surface requires for THIS
   slice? The plan (Branch 6, "The equivalence harness") demands for the contact migration: a
   FULL failure-matrix corpus (valid + EVERY invalid variant: missing each required field,
   off-list literal, bad email, the method-gated cross-field rules violated independently,
   invalid-type duplicate-name arrays) through BOTH oracle and engine, asserting (a) identical
   decoded output AND (b) identical emitted `TranslationKey` sets. Does the harness cover the
   matrix, or is it the "thin existing corpus" both original reviews warned against?
7. **Behavior regression** — could a real contact submission (EN or FR) behave differently than
   before this commit? Pay attention to: the order-independent client-collect-all comparison
   used instead of server abort-first ordering; the ONE pinned key alias (`name` invalid-type →
   oracle `contact.form.name.error` vs engine `contact.form.name.required`); the
   `optional: true` email/phone wrapper annotation; the `multiline` textarea presentation flag.
   Is each of these a genuine no-user-visible-difference, or a hidden behavior change?

## Severity contract

Return BLOCKING items only for: scope deviation (more/less than 6.3), a principle violation, an
incomplete/over-eager deletion, a broken gate, an untested boundary the plan's 6.3 test surface
requires, or a real behavior regression. Everything else is a non-blocking concern. Be concrete:
cite file + line.

---

## (a) THE FULL PLAN

@docs/registration-launch-plan.md

---

## (b) THE BRANCH PR-PLAN SECTION — Branch 6 (`reg-launch/form-engine`)

The relevant section is "Branch 6 — `reg-launch/form-engine` (Candidate 6, ADR 0007) — RISKIEST"
in the plan above (module shape, the equivalence harness, the phantom-server-decode resolution,
the subtract list, the test surface, and the sub-commit list 6.1–6.6). This commit is **6.3**:

> (6.3) Migrate **contact** to the engine; harness green for contact.

Contact migrates FIRST (simpler than registration, same harness) to de-risk the engine before
the riskiest migration (6.5). The oracle is KEPT (here, inside the contact harness) and is
deleted only at 6.6 once every form has migrated.

---

## (c) THIS COMMIT

- **id/intent:** 6.3 — Migrate contact to the engine; harness green for contact.
- **diff:** @docs/.counsel/form-engine-6.3.diff

Files touched (9): `app/lib/content/pages/defaults.ts` (+`defaultContactForm` field graph +
rules), `app/lib/forms/action.test.ts` (skeleton test moved off the now-populated `contact` graph
onto the still-empty `volunteer` graph), `app/lib/forms/action.ts` (`notify` context widened to
include `Mailer.Service`), `app/lib/forms/decode.ts` (engine fix: `optional: true` text/email/url
wrapper annotated with the invalid-type message), `app/lib/forms/definition.ts` (added `multiline`
presentation flag on `requiredText`/`optionalText`), `app/lib/forms/equivalence.contact.test.ts`
(NEW — the contact equivalence harness), `app/lib/forms/render.tsx` (renders `<textarea>` when
`multiline`), `app/routes/($lang)+/contact-schema.test.ts` (DELETED), `app/routes/($lang)+/contact.tsx`
(hand-tuned schema deleted; route now `formAction(...)` + `<FormFields>`).

Review now. Return: blocking[], concerns[], verdict.
