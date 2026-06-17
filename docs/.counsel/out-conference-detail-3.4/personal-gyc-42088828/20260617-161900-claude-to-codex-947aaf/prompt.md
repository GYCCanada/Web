# Counsel review — single commit (Branch 3, sub-commit 3.4)

You are Codex, reviewing ONE just-landed commit on a stacked PR. Be a strict,
specific reviewer. Review ONLY this commit (sub-commit 3.4) against the plan —
not the whole branch, not earlier sub-commits (3.1/3.2/3.3 already landed and
were reviewed). Cite file:line. Do not re-litigate settled decisions.

## What to decide

1. Does this commit implement EXACTLY sub-commit 3.4's slice — no more, no less?
   - 3.4 = "Point all three loaders at it, delete all three forked files; audit
     + reconcile home-route conference rendering."
   - Scope creep (work belonging to 3.1/3.2/3.3, or to Branch 4 section-skip) is
     a finding. Under-delivery (a fork not collapsed, a deletion not made) is a finding.
2. Honors `small-interface-deep-implementation` + the branch's stated module
   interface: `<ConferenceDetail conference={conference} />` — ONE prop, the
   boundary `Conference`; all three year routes render exactly this; loaders are thin
   `getConference(locale, year)` → pass-through. Do the three loaders match this shape?
3. Makes this commit's share of the plan's deletions (`subtract-before-you-add`):
   the ~600 lines of forked JSX in EACH of the three files (`2024`, `2025`, `2026`)
   must genuinely vanish (the candidate-1 deletion). The plan is explicit that
   deleting only 2024/2026 and leaving 2025 drifting is a half-done subtract.
   Confirm all THREE collapse.
4. Honors the home-route audit obligation (the plan's codex→claude CONCERN,
   Branch 3 section, lines ~113): "any conference *section* reused on home must
   render through ConferenceDetail's shared sections, not a fourth fork. If home
   renders only a hero teaser (not the full detail), that is explicitly noted and
   left as-is. No fourth divergence point survives this branch." Did the commit
   actually audit `_index.tsx` (the home route) and reconcile / correctly note it?
5. Passes the gate (`bun run typecheck && bun run lint && bun run build && bun test`).
   I will tell you it passed; flag anything in the diff that looks like it should
   NOT pass or that masks a failure.
6. Violates any principle: `make-impossible-states-unrepresentable`,
   `boundary-discipline`, `derive-dont-sync`, `migrate-callers-then-delete-legacy-apis`,
   `correctness-over-pragmatism` (NO cast-to-any / stubs / commented-out code), `prove-it-works`.
7. Misses a test the plan's test surface requires FOR THIS SLICE, or regresses behavior.
   Note: the plan's `conference-detail.test.tsx` render test belongs to 3.3 (already
   landed). 3.4 is a pointing+deletion+audit slice. Consider whether 3.4 needs its own
   new test, or whether the existing render test + gate green is the right proof for a
   pure delegation/deletion commit. Call out if you think a loader-level or route-level
   test is genuinely required here vs. plan-adequate.

Also assess the commit's incidental change: the meta `title` now uses the route's
literal year ('2024'/'2025'/'2026') instead of `new Date().getFullYear()`. The commit
message frames this as fixing a latent bug (every /YYYY route rendered the CURRENT year
in its title). Is this in-scope for 3.4 (it touches the same three files being collapsed),
or scope creep? Is it correct? Note the home route `_index.tsx` still uses
`new Date().getFullYear()` in its meta description — is leaving that untouched correct
for 3.4's slice (home is not a /YYYY conference-detail fork), or an inconsistency to flag?

## This commit

- Commit: `32f0f52` — `feat(conference)(conference-detail): collapse all three forks onto ConferenceDetail; audit home render`
- Intent (sub-commit 3.4): Point all three loaders at the shared `ConferenceDetail`,
  delete all three forked detail files' JSX; audit + reconcile home-route conference rendering.
- Diff: `docs/.counsel/conference-detail-3.4.diff` (in repo root). The only
  source files changed are the three route files
  (`app/routes/($lang)+/{2024,2025,2026}/_index.tsx`); the rest of the diff is
  `docs/.counsel/**` counsel artifacts (ignore them).

## Grounding (read these)

- FULL synthesized plan: `docs/registration-launch-plan.md` — read it.
- Specifically the section **"Branch 3 — `reg-launch/conference-detail`"**
  (Candidate 1, settled #4), and its sub-commit list (3.1–3.4).
- The shared module landed in 3.3: `app/routes/($lang)+/conference-detail.tsx`
  (its header docstring states the interface + principle intent).
- The boundary `Conference` interface + `getConference(locale, year)`:
  `app/lib/content.server.ts` (~:388 interface, ~:489 `getConference` impl).
- The home route under audit: `app/routes/($lang)+/_index.tsx`
  (uses `getCurrentConference`, renders its own `Hero`/`TimeLeft` evergreen teaser).
- Settled decisions / non-goals: `docs/registration-launch-brief.md`.

## Output

Return a focused review:
- A clear verdict (approve / approve-with-concerns / request-changes).
- BLOCKING items (must fix before this commit is sound) — with file:line.
- Non-blocking concerns.
Keep it tight. Only findings grounded in the diff + plan. No restating the plan back.
