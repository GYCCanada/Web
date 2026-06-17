# Counsel review — Branch `reg-launch/submissions`, sub-commit 7.2 (STANDARD review of ONE commit)

You are reviewing a SINGLE just-landed commit in a stacked-PR program. Review ONLY this
commit against the plan. Do not review the whole branch; do not propose work that belongs to
a later sub-commit. Be concrete and cite file:line. End with a clear verdict.

## Commit under review

- **id:** `581d563`
- **intent (Branch 7.2):** `Submissions.persist` service (persist-only) + tests.
- **diff:** see `docs/.counsel/submissions-7.2.diff` (full `git show HEAD`).

This commit must implement EXACTLY sub-commit 7.2's slice — the durable, persist-ONLY half of
the submission pipeline — no more, no less. The notify wiring and caller migration are 7.3.
The `Submission` schema itself already landed in 7.1.

## What 7.2 should contain (plan slice)

- A new `Submissions` service (`app/lib/forms/submissions.server.ts`) exposing exactly ONE op:
  `persist(form, decoded): Effect<Submission, StorageError>` — encode the decoded form to its
  definition-derived `Submission` envelope and `Storage.put` it at
  `submissions/<form>/<id>.json`, returning the stored record. **Persistence ONLY — no mailer.**
- `submissionKey(form, id)` added to the page/form registry (derived bucket key).
- Tests pinning: the durable write + returned record; on-bucket round-trip through the
  derived `submissionSchema(definition)`; distinct-ids → distinct-keys; persist-decoupled-from-
  notify (no mailer in the call path); the registration payload tracking the `FormDefinition`
  type (the registrar's read contract).

## Review questions (answer each)

1. **Exact slice — no more, no less.** Does it implement precisely 7.2? Any 7.3 work
   (notify/orchestrator, caller migration, mailer changes) leaking in early? Any 7.1 schema
   work duplicated here? Anything 7.2 requires that is missing?
2. **Module interface (`small-interface-deep-implementation`).** The branch's stated shape is
   `Submissions.persist` = ONE call, persistence only, returning the stored `Submission` BEFORE
   any notify. Is the surface exactly that one op? Is the depth real (the encode-as-validation,
   the derived codec, the clock/id/key derivation hidden behind it)?
3. **Deletions (`subtract-before-you-add`).** 7.2 is additive in the plan (the inline
   `mailer.send` subtraction is a 7.3 concern, after the skeleton swap). Confirm no deletion is
   owed by THIS sub-commit — or, if you think one is, name it.
4. **Principles.** `derive-dont-sync` (payload codec IS `submissionSchema(definition)` read via
   `Content.getForm`, id/key derived); `make-impossible-states-unrepresentable` (closed `FormId`,
   branded `IsoDate`/`ListItemId`); `boundary-discipline`; `correctness-over-pragmatism` (NO
   cast-to-any, NO stubs, NO commented-out code). Any violation? In particular scrutinise the
   `Effect.orDie` on the `IsoDate` decode and the encode — is "it dies rather than masquerading
   as a StorageError" the correct call, or does it hide a real failure mode?
5. **Test surface.** Does the plan's 7.2 test surface get covered (durable write, round-trip,
   persist-decoupled-from-notify ordering, registration-payload-matches-definition)? Any
   required test for THIS slice missing? Is the "decoupled from notify" property actually
   PROVEN, or only asserted by absence?
6. **Behavior regression.** Could this commit regress anything already landed (5.x read path,
   6.x decoder, the registry key templates)? Is `submissionKey` consistent with the other
   derived key templates in `registry.ts`?
7. **Gate.** Plan gate is `bun run typecheck && bun run lint && bun run build && bun test`.
   It was run: typecheck clean, lint only a pre-existing unrelated `require-yield` warning in
   `app/lib/effect/form.test.ts`, build OK, 383 pass / 0 fail. Flag if you believe the slice is
   under-tested despite green.

## Attached context

### A. Full synthesized plan

@docs/registration-launch-plan.md

### B. The specific branch PR-plan section

See "## Branch 7 — `reg-launch/submissions`" in the plan above (sub-commits 7.1 / 7.2 / 7.3).
7.2 is THIS commit.

### C. The commit diff

@docs/.counsel/submissions-7.2.diff
