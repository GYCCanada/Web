# Codex counsel — STANDARD review of ONE just-landed sub-commit

You are reviewing a SINGLE commit in a stacked-PR program for the GYC site. Review **only this
commit** against the plan. Do not review the whole branch, do not propose work beyond this
sub-commit's slice. Be specific and cite file:line.

## What to judge (the rubric)

Review this one commit against the plan and answer each:

1. **Exact slice** — does it implement *exactly* sub-commit 2.1's slice — no more, no less?
   (2.1 = `ListItemId` brand + `id` on list-item schemas + defaults migration + read-path
   id-backfill normalization + tests. NOT the `ListEdit` module, NOT admin UI, NOT the deletions
   of the index-merge branch — those are 2.2/2.3/2.4.)
2. **small-interface-deep-implementation** — does it honor the branch's stated module interface?
   Is the id-backfill a deep normalization behind a one-function surface, or did it leak shape?
3. **subtract-before-you-add** — 2.1 is an additive slice (the deletions of the index-merge
   branch / numeric setPath / positional field-name templates are explicitly deferred to 2.4).
   Confirm that's the correct reading of the plan, and that 2.1 added nothing it should later
   delete (no parallel schema, no second decode path that 2.2+ must retire).
4. **Gate** — would it pass `bun run typecheck && bun run lint && bun run build && bun test`?
   (It does locally: 197 pass / 0 fail. Flag anything you believe is fragile regardless.)
5. **Principle violations** — any `make-impossible-states-unrepresentable`, `boundary-discipline`,
   `derive-dont-sync`, `correctness-over-pragmatism` (NO cast-to-any / stubs / commenting-out)
   violations? Specifically scrutinize: the `ListItemId` pattern (`/^[A-Za-z0-9_-]{21}$/`), the
   `nanoid` URL-safe-alphabet assumption, the backfill's "never mint over an existing id (even a
   bad one)" choice, and whether running backfill on BOTH the public read path AND the admin
   draft/published path (but NOT the single edit boundary `decodeDocument`) is the right seam.
6. **Missing tests** — does the plan's test surface for THIS slice (schema.test.ts for
   `ListItemId`; the id-backfill normalization: id-less doc decodes, ids assigned, idempotent on
   re-decode; a public-read deploy-safety integration test) have a hole?
7. **Behavior regression** — could this commit regress any existing behavior (the existing
   speakers/team/seminar decode, the defaults, the draft/publish reconciliation)?

## Hazard to scrutinize hardest

The plan calls the read-path id-backfill "the single most important non-obvious hazard in Branch
2": adding a *required* `id` makes every already-published `content/site.json` (which has no ids)
FAIL decode on read, breaking the live site on deploy. Verify the backfill actually closes this:
that it runs BEFORE decode on every read path that touches a possibly-legacy bucket document, that
it is idempotent, and that it never masks a genuinely-invalid id.

One detail worth a look: `withId` returns `{ id: newListItemId(), ...item }` — id first, then
spread. Consider whether key-ordering or an `id: undefined` present-key edge matters for decode
correctness/idempotence (note `'id' in item` is the guard, so an explicit `id: undefined` key
would be treated as present and left for the decoder).

## Inputs

- **Full synthesized plan:** `docs/registration-launch-plan.md` (read it; the stack order, the
  ordering hazards, and every branch section are here).
- **This commit's branch section:** "Branch 2 — `reg-launch/list-edit` (ADR 0006, Candidate 4)" in
  that plan — the module shape, schema changes, defaults migration + read-safety paragraph, the
  test surface, and the sub-commit list (2.1–2.4).
- **ADR 0006:** `docs/adr/0006-stable-list-item-ids.md` (the decision + the new consequences
  paragraph this commit added).
- **This commit's intent (2.1):** `ListItemId` brand + `id` on list-item schemas + defaults
  migration + read-path id-backfill normalization + tests.
- **This commit's full diff:** `docs/.counsel/list-edit-2.1.diff`.

## Output

A concise structured review: a verdict (approve / approve-with-nits / request-changes), a list of
BLOCKING items (must-fix before the branch proceeds: plan deviation, principle violation,
incomplete slice, broken gate, untested boundary, behavior regression), and a list of non-blocking
concerns/nits. Cite file:line. Keep it tight.
