# Counsel review — single just-landed commit (STANDARD review)

You are Codex, doing a **standard** (not deep) code review of ONE just-landed commit in a stacked-PR stack. Review **only this commit**, judged against the plan slice it claims to implement. Do not review the rest of the stack, prior commits, or future work — except to confirm this commit doesn't reach outside its slice.

## What to judge (answer each explicitly)

1. **Exact slice — no more, no less.** Does this commit implement *exactly* sub-commit 6.5's slice from the plan? Flag any scope creep (work belonging to 6.1–6.4 or 6.6/Branch 7) or any missing piece of 6.5.
2. **Module interface discipline (`small-interface-deep-implementation`).** Does it honor Branch 6's stated module shape (the `FormDefinition` closed kind-set, `definitionToSchema`/`decodeForm` decoder, the renderer, the action skeleton)? Is the new `optional: true` nestedGroup flag a justified deepening of the engine interface, or interface bloat / a one-off escape hatch?
3. **Subtract-before-you-add.** Does this commit make 6.5's share of the plan's deletions? The plan says 6.5 *renames* `registration-schema.ts` → `registration-schema.oracle.ts` (kept as oracle, deleted in 6.6) and replaces `registration-schema.test.ts` with the harness. Deleting the old oracle file is explicitly **6.6**, not 6.5. Confirm the subtract here is correct for the slice (rename + test-replacement), and that nothing that should die in 6.5 survives.
4. **Gate.** Does it pass `bun run typecheck && bun run lint && bun run build && bun test`? (The committer claims 633 pass. The reviewing harness will independently confirm; call out anything in the diff that looks gate-breaking.)
5. **Principle violations.** Especially: `correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO commenting-out), `make-impossible-states-unrepresentable`, `derive-dont-sync`, `boundary-discipline`, `migrate-callers-then-delete-legacy-apis`. The commit uses two `as unknown as` casts (`RegistrationStandardSchema` seam in `registration-form.tsx`; the `issuesOf` schema widening in the test). Judge whether these are legitimate "cast at the seam" idioms or correctness-violations the no-bail-out rule forbids.
6. **Test surface for THIS slice.** The plan's test surface for 6.5 is the **full failure-matrix + render-parity equivalence harness** (valid + every invalid variant: missing each required field, off-list literal, bad email/url, each cross-field rule, attendee/exhibitor branches, the `true`/`false`/`on` boolean tokens, volunteer optional flags) asserting **(a)** identical decoded output, **(b)** identical emitted `TranslationKey` sets, **(c)** render-level field-name + default-value parity. Does the harness actually enumerate this matrix? Are there gaps (a required field, a cross-field rule, or a boolean-token case the corpus misses)?
7. **Behavior regression.** Registration is **client-only today** (verified no-op server action — RegFox is the live channel, settled #9). The migration must preserve the client-validate + render path exactly. Does it? Scrutinize the ONE pinned delta (wholly-absent `extra` group: oracle anchors `extra.tos`, engine anchors `extra.howDidYouHear`) — is the claim that it's an out-of-form edge (the form always renders `extra` with defaults for an attendee) actually sound, or could a real user hit it? Also scrutinize `parent.email` being a bare `requiredText` (not `email` kind) — faithful to the oracle, or a silent loosening?

## Output

Give a verdict (approve / approve-with-concerns / request-changes), a list of **BLOCKING** issues (must-fix before this commit is sound), and a list of non-blocking concerns. Cite file paths + the specific diff hunk for each finding. Be adversarial but fair: this is the riskiest commit in the stack, so under-pinning is the failure mode to hunt.

---

## (a) THE FULL PLAN

@docs/registration-launch-plan.md

---

## (b) THE BRIEF (settled decisions — do NOT re-litigate)

@docs/registration-launch-brief.md

---

## (c) THIS COMMIT — id + intent + diff

**Commit:** `122ef66` — Branch 6 (`reg-launch/form-engine`), **sub-commit 6.5**.

**Intent (verbatim from the plan):** "Author `registration-spec.md` + rename old schema → `registration-schema.oracle.ts` + build registration definition; **full-matrix + render-parity equivalence harness green**; migrate all four registration callers."

The four registration callers (per the plan's `migrate-callers-then-delete`): `registration-form.tsx`, `2024/form/route.tsx`, `2025/form/route.tsx`, `2026/form/route.tsx`. Note: the three `{year}/form/route.tsx` files render the shared `registration-form.tsx`, so migrating the shared form migrates all four render paths; confirm that's a faithful reading and not a skipped caller.

**The relevant branch PR-plan section is "Branch 6 — `reg-launch/form-engine`" in the full plan above**, plus the "Riskiest commit + how the harness pins it" section.

**Full diff of this commit:**

@docs/.counsel/form-engine-6.5.diff
