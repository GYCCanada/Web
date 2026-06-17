# Counsel review: registration-launch Branch 4 (`reg-launch/section-skip`), sub-commit 4.1

You are reviewing a SINGLE just-landed commit in a stacked-PR stack. Review ONLY this
commit against the plan. Do not review the rest of the branch or stack. Be specific and
cite file:line. Decide a verdict: `approve`, `approve-with-concerns`, or `request-changes`.

## What to check (and ONLY this)

1. **Scope fidelity** — does this commit implement EXACTLY sub-commit 4.1's slice — "Gate
   each section on the `Option`/empty-array boundary data" — no more, no less? Sub-commit
   4.2 (the tests) is explicitly a SEPARATE later commit; tests are NOT expected here. Flag
   if this commit pulls 4.2's work forward, or leaves 4.1 work undone.
2. **`small-interface-deep-implementation`** — Branch 4's stated module shape is "no new
   module — `ConferenceDetail` (Branch 3) gains the gating; `toConference` already emits the
   section-presence discriminators (`undefined`/`[]`)." Verify NO new module/interface was
   added, NO schema change, NO `toConference` change — the gating is a pure presentation-seam
   concern branching on data the boundary already emits.
3. **`subtract-before-you-add`** — the plan's subtract for 4.1 is: "any remaining
   `// 1. two column…` author-note comments and dormant-render paths folded into
   `ConferenceDetail`; the gating replaces them." Did this commit make its share of the
   deletions? (Note: Branch 3's collapse may have already removed the JSX author-comments;
   if so, confirm none remain that 4.1 should have removed.)
4. **`make-impossible-states-unrepresentable` at the presentation seam** — the plan requires
   each gate INDEPENDENT: speakers and seminars gated separately; the map column
   (`mapEmbedUrl !== undefined`) and hotels column (`hotels.length > 0`) gated independently,
   with the whole `MapSection` skipped only when neither half has data; RegFox button /
   `RegistrationSection` on `registrationUrl !== undefined`; schedule button on `scheduleUrl`
   present; `FaqSection` always present. Verify each gate matches the plan's spec exactly.
5. **Settled #3 / CONTEXT §Section skip invariant** — skip is SECTION-LEVEL; items stay
   strict. A *present* item with a blank required bilingual field must remain a hard `Text`
   decode error UPSTREAM (in the schema, not the component). Verify the component does NOT
   silently tolerate half-filled content — it only skips whole absent/empty sections, never
   masks a malformed present item. NO JSX comments, NO dormant `eslint-disable` render paths.
6. **Gate** — `bun run typecheck && bun run lint && bun run build && bun test`. (Already run
   by the implementer: typecheck clean, lint only pre-existing unrelated warnings, build ok,
   251 pass / 0 fail. Confirm nothing in the diff would break it.)
7. **Behavior regression** — for a fully-populated conference (2024), every section must
   still render byte-identical to pre-commit (the gating is a no-op when data is present).
   Verify the gates wrap, never alter, the existing JSX. Confirm `2026` (RegFox-only) and
   `2025` (cancelled) skip cleanly per the plan's runtime-proof expectation.
8. **Missing tests for THIS slice** — 4.1's test surface belongs to 4.2 per the plan. Only
   flag a missing test if the plan attributes it to 4.1 specifically (it does not).

## Materials

### A. The full synthesized plan
See `docs/registration-launch-plan.md` (read it in full — every branch + sub-commit list).

### B. The specific branch PR-plan section — Branch 4 `reg-launch/section-skip`
Quoted verbatim from the plan:

> **Why fourth / last launch-critical:** with the data plumbed (Branch 3) and the component
> shared, skip becomes a pure component concern gating on the `Option`-derived boundary data.
> This is what makes 2026 (RegFox only) and 2025 (cancelled) render cleanly.
>
> **Module shape:** no new module — `ConferenceDetail` (Branch 3) gains the gating;
> `toConference` already emits the section-presence discriminators (`undefined`/`[]`).
> - `SpeakersAndSeminars`: renders only when `conference.speakers.length > 0` (seminars
>   likewise, independently).
> - `MapSection`: `mapEmbedUrl !== undefined` and `hotels.length > 0` gated independently
>   (each half).
> - `RegistrationSection` / RegFox button: `registrationUrl !== undefined`.
> - `scheduleUrl` button: present-only. `FaqSection`: always present (static links), unchanged.
>
> **How skip is data-driven (settled #3, CONTEXT §Section skip):** the `Option`/empty-array
> crosses the boundary as `undefined`/`[]` (Branch 3's `toConference`). The component branches
> on that — **no JSX comments, no `eslint-disable` dormant scaffolding**. Section-level skip;
> items stay strict: a *present* hotel with an empty `name` is a hard `Text` decode error (the
> both-locales invariant is never relaxed — validation lives in the schema, not the component).
>
> **Subtract:** any remaining `// 1. two column…` author-note comments and dormant-render
> paths folded into `ConferenceDetail`; the gating replaces them.
>
> **Test surface:** `conference-detail.test.tsx` grows — empty `speakers` omits the speakers
> section; absent `mapEmbedUrl` + empty `hotels` omits `MapSection`; absent `registrationUrl`
> omits the register button; `/2025` (all empty) renders hero + FAQ only. A *present* hotel
> missing `name` fails decode (`schema.test.ts`).
>
> **Sub-commits:**
> - (4.1) Gate each section on the `Option`/empty-array boundary data.
> - (4.2) Tests for every skip + the present-but-empty hard-error case.

### C. THIS commit
- **Commit:** `78fa969` — `feat(conference)(section-skip): gate each section on the Option/empty-array boundary data`
- **Intent:** sub-commit 4.1 — Gate each section on the `Option`/empty-array boundary data.
- **Diff:** `docs/.counsel/section-skip-4.1.diff` (read it — single file, `app/routes/($lang)+/conference-detail.tsx`, +142/−92).
- **Full current file** for context: `app/routes/($lang)+/conference-detail.tsx`.

## Output

Return: verdict; any BLOCKING items (must-fix before this commit is acceptable — plan
deviation, principle violation, incomplete deletion, broken gate, behavior regression,
a gate that doesn't match the plan's spec); and non-blocking concerns. Cite file:line.
