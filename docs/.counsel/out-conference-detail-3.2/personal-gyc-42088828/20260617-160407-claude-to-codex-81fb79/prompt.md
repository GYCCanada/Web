# Counsel review — single commit: conference-detail sub-commit 3.2

You are Codex, doing a STANDARD code review of ONE just-landed git commit in the GYC
registration-launch stacked-PR stack. Review ONLY this commit against the plan slice it
claims to implement. Do not review the whole branch or the whole program — just this commit.

## What this commit claims to be

- **Branch:** `reg-launch/conference-detail` (Branch 3 of the stack).
- **Sub-commit:** **3.2 — Boundary interface growth + `toConference` `Option`→`string|undefined` projection + `content.server.test.ts`.**
- **Commit id:** `83e8566` — `feat(conference)(conference-detail): boundary Conference growth + toConference Option projection`
- **Diff to review:** `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.2.diff` (the `git show` of this commit, full message + patch).

Read the diff file in full before reviewing.

## The full plan (program context)

The complete synthesized stacked-PR plan is at:
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`

Read it. The settled decisions / non-goals brief is at:
`/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md` (settled decisions — do NOT re-litigate them).

## The specific branch PR-plan section (the contract for THIS commit)

From the plan, **Branch 3 — `reg-launch/conference-detail`**. The load-bearing parts for sub-commit 3.2:

- **Read-path (`content.server.ts`):** `toConference` projects the new fields into the boundary
  `Conference` interface as `registrationUrl: string | undefined`, `scheduleUrl: string | undefined`,
  `mapEmbedUrl: string | undefined`, `hotels: {name, note?}[]`. **The document uses `OptionFromOptionalKey`;
  the boundary projects to `string | undefined` so React never sees `Option<string>`.** This is the
  convention for ALL new optional Conference fields. The boundary `Conference` interface grows the
  same optional fields. The plan text references "the existing `registration` pattern at
  `content.server.ts:214`" (an `Option.isSome` gate) as the convention to match.
- The document-layer `OptionFromOptionalKey` URLs + `Hotel = Struct({ id, name, note? })` + Conference
  schema growth + defaults (2024 full, 2026 registrationUrl-only, 2025 nothing) were ALREADY landed in
  **sub-commit 3.1** (commit `4bdb7db`). 3.2 must NOT re-do 3.1's schema/defaults work — it consumes it.
- **Test surface for Branch 3** (the parts relevant to 3.2): `content.server.test.ts` is the projection
  test. (The render test `conference-detail.test.tsx` and the schema brand tests belong to 3.3/3.1, NOT 3.2.)
- **Section-presence discriminator (sets up Branch 4):** an absent URL must project to `undefined`,
  an absent/empty hotel list to `[]`, so Branch 4's section-skip can gate on
  `registrationUrl !== undefined` / `mapEmbedUrl !== undefined` / `hotels.length > 0`.

**Sub-commit list for Branch 3 (so you can judge "exactly this slice, no more, no less"):**
- (3.1) URL brand types + `Hotel` + Conference schema growth (`OptionFromOptionalKey`) + defaults. — ALREADY LANDED.
- (3.2) **Boundary interface growth + `toConference` `Option`→`string|undefined` projection + `content.server.test.ts`.** — THIS COMMIT.
- (3.3) Extract `ConferenceDetail` from the 2024 fork + `conference-detail.test.tsx`. — LATER.
- (3.4) Point all three loaders at it, delete all three forked files; audit + reconcile home-route conference rendering. — LATER.

## Your review questions (answer each, against THIS commit only)

1. **Exactly this slice?** Does the commit implement precisely sub-commit 3.2's slice — boundary
   `Conference` interface growth (the 4 new fields) + `toConference` projection of the document `Option`s
   to `string | undefined` / `{name, note?}[]` + `content.server.test.ts` coverage — and NOTHING that
   belongs to 3.1 (schema/defaults), 3.3 (component extraction / render test), or 3.4 (loaders/deletes)?
   Flag any scope spill in either direction (doing too much, or leaving part of 3.2 undone).

2. **`small-interface-deep-implementation` + the branch's stated boundary contract:** Does the boundary
   shape match the plan exactly (`string | undefined` for the three URLs, `{name, note?}[]` for hotels,
   no `Option` leaking to React, the list-identity `id` dropped from the read shape)? Is `toHotel` a
   reasonable private helper or interface bloat? The plan said "via `Option.isSome` gating (the existing
   `registration` pattern)"; the commit uses `Option.getOrUndefined`. Is that an acceptable realization
   of the same convention (projecting `Option<string>` → `string | undefined`), or a deviation that
   matters? Is the projection consistent across all four new fields?

3. **`subtract-before-you-add`:** Sub-commit 3.2 is a pure boundary-growth + projection slice; the plan's
   deletions for Branch 3 (the three ~600-line forks, hard-coded URLs/hotels/iframe) land in 3.3/3.4.
   Confirm 3.2 is NOT expected to delete anything here, OR identify any subtraction it should have made
   but didn't (e.g., should any now-dead projection / placeholder be removed as part of this slice?).

4. **Gate:** Would this commit pass `bun run typecheck && bun run lint && bun run build && bun test`?
   Look for type holes (the optional-`note` spread `...(hotel.note === undefined ? {} : {...})` and the
   `Conference['hotels'][number]` / `DocConference['hotels'][number]` indexed-access types), exhaustiveness,
   and whether the new tests actually assert the projection (Option→undefined, empty list→[], per-locale
   note collapse).

5. **Principle violations:** Any `as any` / `as unknown as` / stub / commented-out code / TODO?
   Any `make-impossible-states-unrepresentable` regression (e.g., a representable empty-string URL that
   should have been blocked at decode in 3.1)? Any `boundary-discipline` leak (document type escaping to
   the read shape)? Any `derive-dont-sync` issue?

6. **Missing test for this slice?** The plan's test surface for 3.2 is the `content.server.test.ts`
   projection. Does the commit cover: each URL present→verbatim string, absent→`undefined`; hotels
   present→`{name, note?}[]` with per-locale note collapse and `note` omitted when the doc has none;
   empty/absent hotel list→`[]`; across the 2024 (full) / 2026 (registrationUrl-only) / 2025 (cancelled,
   all-absent) defaults? Identify any projection branch the slice requires but does not test.

7. **Behavior regression?** Does growing the boundary interface + projection change any EXISTING
   `Conference` field's behavior, or only add the four new fields? Any risk to the existing `registration`
   / `selectByYear` / `selectCurrent` consumers?

## Output

Give a concise, decisive review. Lead with a verdict (approve / approve-with-nits / request-changes).
List BLOCKING issues first (must-fix before this commit is sound: scope spill, principle violation,
gate failure, missing required test for this slice, behavior regression), then non-blocking concerns/nits.
Cite specific file paths + line ranges from the diff. Do not re-litigate settled decisions in the brief.
