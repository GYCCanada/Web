# Codex counsel — STANDARD review of a single just-landed commit

You are reviewing ONE commit in a stacked-PR program. Be surgical: review ONLY this
commit, against the plan, for exactly its slice. Do not review the whole branch.

## Commit under review

- **Branch:** `reg-launch/conference-detail` (Branch 3).
- **Sub-commit 3.3:** "Extract `ConferenceDetail` from the 2024 fork (the spec) + `conference-detail.test.tsx`."
- **Commit:** `66c62d7` — `feat(conference)(conference-detail): extract data-driven ConferenceDetail from the 2024 fork`.
- **Diff:** `docs/.counsel/conference-detail-3.3.diff` (read it in full).
- **Files added:** `app/routes/($lang)+/conference-detail.tsx` (607), `app/routes/($lang)+/conference-detail.test.tsx` (206). No deletions in this commit.

## Intent of THIS slice (3.3)

Per the plan, 3.3 is ONLY: extract the `ConferenceDetail` module from the 2024 fork
(which is the behavioral spec — the byte-identical 2024 render is the oracle), and add
`conference-detail.test.tsx`. It is NOT:
- 3.4's job to point the three loaders at it, delete the three forks, or audit the home route.
- Branch 4's job to gate/skip sections on absent data — here data flows through unconditionally.
- 3.1/3.2's job (schema URL brands, `Hotel`, `OptionFromOptionalKey`, `toConference` projection) — those landed earlier.

So this commit should ADD the shared module + its test, leave the three forks still in
place (deleted in 3.4), and contain NO subtractions (the subtraction is 3.4's share).

## What to check (the review questions)

1. **Exact slice — no more, no less.** Does the commit implement exactly 3.3's slice? Does
   it bleed into 3.4 (deleting forks / wiring loaders / home audit) or Branch 4 (section
   skip gating)? Does it under-deliver (missing the module or the test)?
2. **`small-interface-deep-implementation` + the branch's stated module interface.** The plan
   mandates the public surface is ONE prop — the boundary `Conference` —
   `<ConferenceDetail conference={conference} />`. Every section (`Hero`/`MobileHero`/
   `DesktopHero`, `MapSection`, `SpeakersAndSeminars`, `SpeakerCard` + card-rotation
   machinery, `RegistrationSection`, `FaqSection`) must be hidden inside. Is the interface
   actually one prop with everything else private? Any leaked internals?
3. **`boundary-discipline` / `derive-dont-sync`.** The plan requires the formerly hard-coded
   RegFox link, schedule link, map iframe `src`, and hotel `<li>`s to be read off
   `registrationUrl` / `scheduleUrl` / `mapEmbedUrl` / `hotels`. Verify NO hard-coded URL /
   hotel literal survives in the new module. The component must consume plain
   `string | undefined` and never see an `Option`.
4. **`subtract-before-you-add` — this commit's share of deletions.** The plan's Branch-3
   deletions (collapse the three ~600-line forks) are explicitly 3.4's share, not 3.3's.
   So 3.3 legitimately adds-only. Confirm this is the right reading (3.3 is the extraction;
   3.4 is the migrate-callers-then-delete). If you think 3.3 should itself delete something,
   say so — but weigh `migrate-callers-then-delete-legacy-apis`: the forks can't be deleted
   until 3.4 points the loaders at the new module.
5. **Gate.** `bun run typecheck && bun run lint && bun run build && bun test` — already run
   green by the implementer (249 tests pass, 0 fail; lint has only 2 pre-existing unrelated
   warnings; build OK). Flag anything in the diff that would threaten the gate.
6. **Principle violations.** Any `cast-to-any`, stub, commented-out code,
   `make-impossible-states-unrepresentable` regressions, or `correctness-over-pragmatism`
   shortcuts? (E.g. fidelity drift from the 2024 spec that silently changes behavior.)
7. **Test surface for this slice.** The plan's test surface for 3.3 is
   `conference-detail.test.tsx` (render-to-string): a fully-populated conference renders all
   sections; the RegFox button uses `registrationUrl`; the map iframe uses `mapEmbedUrl`.
   Does the test prove these? Is it asserting boundary data (not hard-coded constants)? Any
   missing assertion the plan's surface requires for THIS slice (note: schema.test.ts URL-brand
   tests belong to 3.1, section-skip tests to Branch 4 — out of scope here)?
8. **Behavior regression vs the 2024 spec.** The 2024 fork is the oracle. Did the extraction
   drift — wrong breakpoint logic, dropped `target="_blank"`, changed bible-gateway link,
   lost framer-motion card rotation, altered hotel note rendering, etc.?

## Grounding (read as needed)

- **Full plan:** `docs/registration-launch-plan.md` — especially the Stack-order table and
  "Branch 3 — `reg-launch/conference-detail`" section (lines ~103-143), including the 3.3
  sub-commit bullet (line 141) and the subtract/test-surface paragraphs.
- **Settled decisions (do NOT re-litigate):** `docs/registration-launch-brief.md` settled #4.
- **The 2024 fork (the spec/oracle):** `app/routes/($lang)+/2024/_index.tsx` (617 lines, still
  present — deleted in 3.4). Compare the extracted module against it for fidelity.
- **The boundary:** `app/lib/content.server.ts` `interface Conference` (line ~99) and
  `toConference` (`registrationUrl`/`scheduleUrl`/`mapEmbedUrl`/`hotels` projection, ~line 274).

## Output

Return a structured verdict:
- **verdict** (approve / approve-with-concerns / request-changes),
- **blocking** issues (MUST-fix before proceeding: plan deviation, principle violation,
  incomplete/over-reaching slice, broken gate, untested boundary, behavior regression),
- **concerns** (non-blocking).
Cite specific file:line for every finding.
