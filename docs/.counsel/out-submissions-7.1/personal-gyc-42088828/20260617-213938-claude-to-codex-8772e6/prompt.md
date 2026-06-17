# Counsel review — Branch 7 (`reg-launch/submissions`), sub-commit 7.1

You are doing a STANDARD code review of a SINGLE just-landed commit in a stacked-PR
implementation of the GYC registration-launch plan. Review ONLY this one commit
against the plan slice it claims. Do not review the rest of the stack.

## Commit under review

- Branch: `reg-launch/submissions`
- Sub-commit: **7.1 — Submission schema (payload derived from FormDefinition)**
- Commit id: `8b40426`
- Title: `feat(forms)(submissions): Submission schema with payload derived from FormDefinition`
- Diff: see `docs/.counsel/submissions-7.1.diff` (full `git show` of the commit).

The commit adds exactly two files:
- `app/lib/forms/submission.ts` (104 lines) — the schema + envelope + id minter.
- `app/lib/forms/submission.test.ts` (197 lines) — round-trip / derivation / envelope tests.

## What 7.1 is supposed to be (from the plan)

From the plan's Branch 7 section (`docs/registration-launch-plan.md`, lines ~260-281):

> **Branch 7 — `reg-launch/submissions` (CONTEXT §Submission, settled #8)**
> Schema changes: `Submission` schema (`forms/submission.ts`) =
> `Struct({ id: ListItemId, form: Literal, submittedAt: IsoDate, payload })`.
> Per-form `payload` typing **derived from the `FormDefinition`** (derive-dont-sync —
> the submission shape is the decoded form type, not re-declared).
>
> Sub-commits:
> - (7.1) `Submission` schema (payload derived from `FormDefinition`).
> - (7.2) `Submissions.persist` service (persist-only) + tests.
> - (7.3) Wire persist-then-notify into the form action skeleton; migrate
>   contact/volunteer/registration (registration's net-new server persist lands here).

So 7.1's slice is JUST the schema + its derivation/round-trip tests. The persist
service and the persist-then-notify wiring are explicitly LATER sub-commits (7.2, 7.3)
and MUST NOT appear in this commit.

## Settled decisions (do NOT re-litigate)

- Submission is a persisted bucket object `submissions/<form>/<id>.json` + an email
  notification OF the record (settled #8). The email is a notification, not the record.
- `payload` typing is derived from `FormDefinition`, not re-declared (derive-dont-sync).
- `FormId` is the closed literal set `contact | volunteer | registration`.
- This branch is post-launch CMS expansion; RegFox carries the live 2026 channel.

## Context you have

- FULL plan: `docs/registration-launch-plan.md`.
- Brief (settled decisions, non-goals): `docs/registration-launch-brief.md`.
- The commit diff: `docs/.counsel/submissions-7.1.diff`.
- Dependencies this commit builds on (already landed in earlier branches):
  - `definitionToSchema(definition): Schema.Codec<DecodedForm, Encoded>` in
    `app/lib/forms/decode.ts:495` — compiles a `FormDefinition` into the SAME codec
    `decodeForm` validates submissions with.
  - `FormId` (closed literal) in `app/lib/content/pages/registry.ts:87`.
  - `ListItemId` (branded nanoid), `IsoDate` (branded calendar date), `newListItemId`
    in `app/lib/content/schema.ts`.

## Gate (already run by the implementer — all green)

`bun run typecheck && bun run lint && bun run build && bun test`
→ typecheck clean, lint only a pre-existing unrelated warning, build OK,
**378 pass / 0 fail**.

## Review questions — answer each

1. **Exact slice.** Does this commit implement EXACTLY sub-commit 7.1's slice — the
   `Submission` schema with payload derived from `FormDefinition`, plus its tests —
   and NOTHING from 7.2 (persist service) or 7.3 (action wiring)? Flag any scope
   creep (a persist service, a mailer, a Storage call, a route change) or any
   under-delivery (missing the derivation, missing round-trip proof).

2. **`derive-dont-sync`.** The plan's headline property is that the payload shape is
   DERIVED from `FormDefinition`, never re-declared. The commit implements this as a
   FACTORY: `submissionSchema(definition)` embeds `definitionToSchema(definition)` as
   its `payload` codec. Is this a genuine derivation (no parallel per-form payload
   struct that could drift), or is there hidden duplication? Is the factory the right
   shape vs the plan's literal `Struct({...payload})` sketch (the plan sketches a
   struct; the implementation makes it parameterized — is that a faithful, better
   realization or a deviation that needs justifying)?

3. **`make-impossible-states-unrepresentable`.** The envelope is
   `{ id: ListItemId, form: FormId, submittedAt: IsoDate }` — closed FormId literal,
   branded id, branded date. Is the envelope watertight? Are the tests proving the
   impossible states are actually rejected (off-list form, bad id, non-calendar date)?

4. **`small-interface-deep-implementation`.** The module exposes `submissionSchema`
   (factory), `submissionEnvelope`/`SubmissionEnvelope` (metadata-only struct),
   `Submission`/`SubmissionEncoded` types, `newSubmissionId`. Is `SubmissionEnvelope`
   (read metadata without the field graph) a justified part of the interface for this
   slice, or speculative surface that belongs to a later sub-commit (7.2's listing /
   the future registrar)? Is the interface as small as it can be while still proving
   the derivation?

5. **Subtract-before-you-add.** Branch 7's stated deletion (the inline
   `mailer.send({ subject, content })` bodies) is explicitly assigned to sub-commit
   7.3, not 7.1. Is it correct that 7.1 carries NO deletion (it is purely additive —
   a new schema module), or does the plan imply a deletion this commit should have
   made? Confirm 7.1 is legitimately add-only.

6. **Gate.** Anything that would break typecheck/lint/build/test that the implementer
   missed? Any test that asserts a tautology / proves nothing? Any `as never` /
   `as unknown as` cast that hides a type hole (note: `definitionToSchema` itself
   returns via `as unknown as Schema.Codec` — that's in a prior commit, not this one;
   judge only what 7.1 adds)?

7. **Test surface the plan requires for THIS slice.** The plan's Branch 7 test surface:
   "`submissions.test.ts` — `persist` writes the object … ; the registration
   `Submission` shape matches the decoded `FormDefinition` type (the future
   registrar's read contract)." The persist tests belong to 7.2. For 7.1, the
   relevant requirement is the derivation + round-trip + envelope. Are all THREE
   covered? Is anything 7.1 needs to prove missing (e.g. does it prove the payload
   tracks DIFFERENT definitions, not just one)?

8. **Behavior regression.** This is a net-new module (no callers yet). Confirm it
   cannot regress existing behavior. If you see any export name collision or any
   change to a shared module, flag it.

## Output

Give a concise verdict: is 7.1 correctly scoped, faithful to the plan and principles,
gate-green, and test-complete for its slice? List any BLOCKING issues (must fix before
proceeding) separately from non-blocking concerns. If clean, say so plainly.
