# Codex counsel — STANDARD review of ONE just-landed commit (per-page-content 5.2)

You are doing a focused, standard (not deep) code review of a SINGLE commit in a stacked-PR
program. Review ONLY this commit against the plan. Do not review the whole PR. Do not
re-litigate settled decisions. Be concrete: cite file:line.

## What to judge (and ONLY this)

1. Does the commit implement EXACTLY sub-commit 5.2's slice — no more, no less? It must
   widen the scope machinery + generalize reconciliation per-object, but must NOT migrate
   routes (that is 5.4), must NOT add the `Content.getPage`/`getForm` read path (that is 5.3),
   must NOT add per-page `/admin` sections (that is 5.5). New page/form SCHEMAS + defaults are
   5.1 (already landed) — this commit only adds the registry that maps id → schema/default/keys.
2. Does it honor `small-interface-deep-implementation` and the branch's stated module
   interface (DraftEditor's five-call surface: load / editDocument / applyImageUpload /
   applyListOps / publish — unchanged surface, just widened scope param)?
3. Does it make THIS commit's share of the plan's deletions (`subtract-before-you-add`)?
   The plan's 5.2 deletion: the now-orphaned `Content.AdminContent`/`AdminContentSource`
   (load returns the scope-generic `Loaded<S>` instead). Is the deletion complete (no dangling
   callers, no parallel API kept alive — `migrate-callers-then-delete-legacy-apis`)?
4. Does it pass the gate? (Reviewer ran it: typecheck OK, lint OK [2 pre-existing warnings
   unrelated], build OK, `bun test` = 297 pass / 0 fail. Confirm nothing in the diff would
   regress that.)
5. Does it violate any principle? Watch for: `make-impossible-states-unrepresentable`
   (closed PageId/FormId; no free-string object names), `derive-dont-sync` (keys/schemas/
   defaults enumerated ONCE in the registry, not re-declared), `boundary-discipline`
   (decode once at the draft boundary), `correctness-over-pragmatism` (NO cast-to-any, NO
   stubs, NO commented-out code). NOTE the `as Effect.Effect<Json, ...>` casts in the
   ScopeCodec bundle and the `as ScopeEncoded<S>` / `as Loaded<S>` casts at the public method
   boundary — judge whether the type-erasure-at-the-seam comment justifies them or whether
   they hide a real soundness gap. The Form draft/publish codecs are deliberately the SAME
   strict schema (no lax draft variant yet) — is that an honest current state or a stub?
6. Does it miss a test the plan's 5.2 test surface requires for THIS slice? The plan asks for:
   per-object scopeKeys (page/form, no collisions); per-object load reconciliation
   (defaults / published / draft-no-published / draft-newer / stale); page edit → reopen →
   publish → live object; per-object blast-radius isolation (a FAQ edit never touches
   content/site.json); form scope round-trip.
7. Does it regress any behavior? The SITE scope path must remain byte-identical to before
   (the equivalence corpus + same-second publish regression test must still hold).

## (a) The FULL synthesized plan

@/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md

## (b) The specific branch section — Branch 5 — `reg-launch/per-page-content`

See the plan's "Branch 5 — `reg-launch/per-page-content` (Candidate 5, ADR 0008)" section,
especially the sub-commit list. This commit is sub-commit (5.2):

> (5.2) `ContentScope` widened to page/form; `scopeKeys` gains page/form key-pairs;
> `DraftEditor.load`/`publish` reconciliation generalized per-object; tests (wiring proven
> before any route migrates).

Branch 5's stated key resolutions this commit realizes:
- The single-object reconciliation generalizes over `scopeKeys(scope)` → `{ draftKey,
  publishedKey }`; each page/form object gets its OWN draft/published pair, its own
  head-compare reconciliation. Closed by WIDENING Branch 1's already-scoped interface, not
  retrofitting.
- `ContentScope` (introduced single-inhabitant in Branch 1) widens here to
  `| { kind: 'page'; page: PageId } | { kind: 'form'; form: FormId }`.

## (c) THIS commit — id + intent + diff

- Commit: `e3f28358` — `feat(cms)(per-page-content): widen ContentScope to page/form; per-object DraftEditor reconciliation`
- Intent: sub-commit 5.2 — ContentScope widened to page/form; scopeKeys gains page/form
  key-pairs; DraftEditor.load/publish reconciliation generalized per-object; tests.
- Full diff:

@/Users/cvr/Developer/personal/gyc/docs/.counsel/per-page-content-5.2.diff

## Output

Give a verdict (approve / approve-with-concerns / request-changes) and a SHORT list of:
- BLOCKING items (must fix before proceeding): plan deviation, principle violation,
  incomplete deletion, broken gate, untested boundary the plan's 5.2 surface requires,
  behavior regression.
- Non-blocking concerns (nice-to-have).
Cite file:line. Do not pad. If it's clean, say so plainly.
