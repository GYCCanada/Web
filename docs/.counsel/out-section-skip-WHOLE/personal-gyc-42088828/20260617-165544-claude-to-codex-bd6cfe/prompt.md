# Deep adversarial review — WHOLE PR: Branch 4 `reg-launch/section-skip`

You are the **counsel reviewer** (Codex) on a stacked-PR program for the GYC Canada
registration launch. This is a **holistic, adversarial, whole-PR** review of **Branch 4 only**
(`reg-launch/section-skip`) — every sub-commit assembled. Be skeptical. Your job is to find
where the assembled PR fails to fully realize its plan section, leaves the stack half-migrated,
regresses behavior, or violates the principles below. Reward nothing for effort; only correctness.

## What to produce

A holistic verdict on whether **the assembled Branch-4 PR fully realizes its plan section** and
**coheres across its two sub-commits** (no half-migrated caller, no dead code left between
slices, no behavior regression). Then a prioritized list:
- **BLOCKING** — must fix before this PR can be considered done (plan deviation, principle
  violation, incomplete deletion, broken gate, untested boundary, behavior regression, a skip
  gate that is wrong or that a regressed implementation could pass undetected).
- **CONCERNS** — non-blocking improvements / risks worth surfacing.
- A one-line **VERDICT**.

Scrutinize the **riskiest part hardest**. For Branch 4 the risk is: *are the section-skip gates
correct AND adequately pinned from the outside* — specifically that a regression which silently
re-enabled a section (or rendered a button with `href={undefined}`) would be **caught by a test**,
not pass green. Section-skip is the **Friday launch gate**: 2026 (RegFox-only) and 2025
(cancelled) MUST render cleanly with no empty sections.

## Principles this PR must uphold (load-bearing)

- `small-interface-deep-implementation` — Branch 4 adds NO new module; it deepens
  `ConferenceDetail` (Branch 3) with gating. Verify that's the right call (no shallow new
  abstraction, no leaked gating logic).
- `make-impossible-states-unrepresentable` — each section gate is independent; the discriminator
  is the boundary data (`string | undefined` / `[]`) that `toConference` already emits. Verify
  the component cannot render a section with absent data, and cannot render a button with an
  `undefined` href.
- `subtract-before-you-add` — the plan says Branch 4 subtracts "any remaining `// 1. two
  column…` author-note comments and dormant-render paths." Verify NONE remain (the collapse in
  Branch 3 may already have removed them — confirm, don't assume).
- `derive-dont-sync` — skip is **derived** from the boundary data each render, never a synced
  flag.
- `prove-it-works` — every gate must be pinned by an OUTSIDE-IN test (rendered HTML asserted
  absent), not merely by reading the code. **Hunt for any gate whose test would still pass if
  the gate were deleted.**
- `boundary-discipline` — validation (the both-locales `Text` invariant) lives in the schema,
  never the component. Skip is **section-LEVEL**; items stay strict. A present hotel with a
  blank `name` must be a hard decode error, NOT a silently-skipped item.
- `correctness-over-pragmatism` — NO cast-to-any, NO stubs, NO commenting-out.

## The FULL plan (read in full)

`docs/registration-launch-plan.md` — the synthesized stacked plan, every branch + sub-commit.
Pay special attention to **"## Branch 4 — `reg-launch/section-skip`"** (the section this PR
realizes), and to **Branch 3** (`reg-launch/conference-detail`, the prior stack branch this one
builds on — its `toConference` `Option → string|undefined` projection and its `ConferenceDetail`
module are the substrate Branch 4 gates).

## The settled decisions (do NOT re-litigate — judge fidelity TO them)

`docs/registration-launch-brief.md` — especially settled **#3** (section skip = section-level,
items stay strict; `Text` both-locales invariant never relaxed), **#4** (one shared
data-driven `ConferenceDetail`; Conference grows optional/empty-able section-skippable fields),
**#9** (2026 channel = RegFox via `registrationUrl` button), and **#11** (this is the last
launch-critical branch — the Friday ship line).

## Branch 4 plan section — exact realization targets

From `docs/registration-launch-plan.md` "Branch 4":

- **No new module** — `ConferenceDetail` gains the gating; `toConference` already emits the
  presence discriminators (`undefined`/`[]`).
- `SpeakersAndSeminars`: speakers section renders only when `speakers.length > 0`; seminars
  likewise, **independently**.
- `MapSection`: map (`mapEmbedUrl !== undefined`) and hotels (`hotels.length > 0`) gated
  **independently** (each half); whole section skipped when neither half has data.
- `RegistrationSection` / RegFox button: `registrationUrl !== undefined`.
- `scheduleUrl` button: present-only.
- `FaqSection`: **always present** (static links), unchanged.
- Skip is data-driven: **no JSX comments, no `eslint-disable` dormant scaffolding**.
- Item strictness: a *present* hotel with empty `name` is a hard `Text` decode error.

**Sub-commits:** (4.1) gate each section on the boundary data; (4.2) tests for every skip + the
present-but-empty hard-error case.

## The assembled whole-PR diff

`docs/.counsel/section-skip-WHOLE.diff` — the full diff of Branch 4 vs its **prior stack branch**
`conference-detail` (i.e. `git diff conference-detail...section-skip`). It is the assembled
result of both sub-commits (78fa969 gating + fcc0272 tests). Three files touched:
`app/routes/($lang)+/conference-detail.tsx` (the gating),
`app/routes/($lang)+/conference-detail.test.tsx` (the skip render tests), and
`app/lib/content/schema.test.ts` (the present-but-empty hard-error tests).

## Specific things to scrutinize hardest (adversarial checklist)

1. **Does every gate have an outside-in test that would FAIL if the gate were removed?** Walk
   each gate (speakers, seminars, map-half, hotels-half, whole-MapSection, RegistrationSection,
   register hero button, schedule hero button) and ask: if I deleted this `if … return null` /
   ternary, does a test go red? Note the schedule-button test's stated reasoning (it asserts the
   `registration.schedule` *label* is absent, because React drops an `undefined` href attribute
   so an href-only assertion would not catch a regressed unconditional button). **Verify that
   reasoning holds and that the same trap is not present, untested, on the register button or any
   other gate.** Is there a gate that a regression could re-enable while still passing green?

2. **Two registration render paths.** `registration.register` (hero button, lines ~116/202) and
   `registration.register.title` (the `RegistrationSection`, line ~610) are DIFFERENT keys. Both
   gate on `registrationUrl`. The 2026 test asserts `registration.register.title` present and the
   RegFox href present. **Is the hero register button ALSO covered? Is there any registration
   render path that is NOT gated, or gated inconsistently between the two paths?**

3. **`MapSection` independence.** The diff gates each half independently AND skips the whole
   section when neither half has data. Confirm the tests prove ALL FOUR quadrants: (map only),
   (hotels only), (both — the existing Branch-3 full render), (neither — whole section gone). Is
   the "hotels-description copy" (`registration.hotels.description.facebook`) — which lives in the
   hotels half — correctly gone when hotels is empty, and is that asserted?

4. **The present-but-empty hard-error (item strictness, settled #3).** The `schema.test.ts`
   additions construct a `Hotel` via a `withExtraHotel` helper typed `unknown`. Scrutinize: does
   this genuinely prove that a present hotel with a blank/missing `name` fails STRICT (publish)
   decode? Does it prove the inverse (a complete hotel decodes)? Is the half-filled optional
   `note` case correct (optionality = absence, not tolerating a half-filled present value)? Could
   any of these tests pass for the wrong reason (e.g. failing decode for an unrelated reason like
   the `unknown` cast bypassing something)?

5. **Behavior regression vs Branch 3.** Branch 3 established the fully-populated 2024 render as
   the spec (byte-identical to the old fork except one pinned hotel-typo delta). Branch 4 wraps
   sections in gates. **For a fully-populated conference (2024), is the rendered output
   unchanged?** A ternary returning the same JSX should be inert when data is present — confirm no
   structural/wrapper change leaked in that would alter the 2024 render. Are the Branch-3 full
   render tests still present and green alongside the new skip tests?

6. **Cohesion across the two sub-commits.** 4.1 (gating) without 4.2 (tests) would be untested;
   together do they form a complete slice? Any dead code, any half-migrated section, any gate
   added in 4.1 but never tested in 4.2 (or vice-versa, a test for a gate that doesn't exist)?

7. **Dormant scaffolding subtraction.** The plan's Branch-4 "Subtract" says to remove "any
   remaining `// 1. two column…` author-note comments and dormant-render paths." Confirm the
   final `conference-detail.tsx` has NO such comments and NO `eslint-disable`-dormant paths. If
   Branch 3's collapse already removed them, say so — but verify, don't assume.

8. **The both-locales invariant under skip.** Confirm the component NEVER relaxes validation: it
   only omits whole sections; it never renders a half-filled item. The strictness is proven in
   `schema.test.ts`, the omission in `conference-detail.test.tsx`. Is that division correct, or is
   there a path where the component would paper over invalid content?

9. **`/2025` and `/fr/2025`.** The cancelled-year shape (all optional absent) must render hero +
   FAQ only, EN and FR. Confirm both are tested and that the FR test meaningfully differs from EN
   (asserts FR translation keys), proving locale isn't accidentally hard-coded.

Report BLOCKING items first (with file:line where possible), then CONCERNS, then a one-line
VERDICT on whether the assembled Branch-4 PR fully realizes its plan section and is launch-ready.
