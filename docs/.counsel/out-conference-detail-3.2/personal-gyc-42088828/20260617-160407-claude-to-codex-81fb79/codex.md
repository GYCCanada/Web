**Verdict: approve.**

**Blocking Issues**
None found.

This commit implements exactly sub-commit 3.2: it grows the read-boundary `Conference` interface, projects the three document-layer `Option` URLs into `string | undefined`, maps hotels into locale-specific `{ name, note? }[]`, drops list identity `id`, and adds `content.server.test.ts` projection coverage. I found no schema/defaults spill from 3.1, no component/render-test work from 3.3, and no loader/deletion work from 3.4.

`Option.getOrUndefined` is an acceptable realization of the plan’s `Option.isSome` convention: the important contract is document `Option` at decode, plain `undefined` at the React boundary. The helper `toHotel` is private and keeps the interface small rather than pushing bilingual/note/id handling to callers.

I don’t see a gate-risk in the changed code: `Option` is already imported, the indexed-access types are local and type-directed, and the optional `note` spread avoids materializing `note: undefined`. I did not execute the gate in this read-only session, but from review I would expect `bun run typecheck && bun run lint && bun run build && bun test` to pass for this slice.

**Non-Blocking Notes**
The tests are appropriately scoped for 3.2. They cover present URL projection, absent URL projection, empty hotel lists, hotel note omission, and per-locale note collapse across the 2024/2026/2025 defaults. There is no required subtraction in this sub-commit; the fork deletion and hard-coded JSX removal are explicitly 3.3/3.4 work.

No `as any`, `as unknown as`, TODO/stub/commented-out implementation, boundary leak, derive/sync issue, or existing-field regression spotted. Existing `registration`, `selectByYear`, and `selectCurrent` behavior is additive-only here.

**Receipts**
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.2.diff:33-104` — projection tests added.
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.2.diff:117-135` — boundary `Conference` growth.
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.2.diff:143-175` — private `toHotel` and `toConference` projection.
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:131-149` — actual boundary fields.
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:224-230` — `toHotel` drops `id`, collapses localized note.
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:274-277` — URL `Option` projections and hotels mapping.
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.test.ts:183-254` — test coverage for 2024/2026/2025.
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:125-142` — 3.2 contract and neighboring sub-commit boundaries.
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:35-42` — settled section-skip/detail-page decisions.
- `/Users/cvr/.brain/principles/small-interface-deep-implementation.md:7-19`, `/Users/cvr/.brain/principles/boundary-discipline.md:7-30`, `/Users/cvr/.brain/principles/subtract-before-you-add.md:7-15`, `/Users/cvr/.brain/principles/make-impossible-states-unrepresentable.md:15-19`, `/Users/cvr/.brain/principles/derive-dont-sync.md:7-17` — principles applied.