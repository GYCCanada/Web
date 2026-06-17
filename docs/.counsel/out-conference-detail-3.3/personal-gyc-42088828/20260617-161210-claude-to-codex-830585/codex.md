**verdict:** approve-with-concerns

**blocking:** none

**concerns:** one non-blocking handoff wording issue. The added comments say the three `/YYYY` loaders “render” this module already, but 3.3 explicitly stops before loader wiring; 3.4 owns that. The code itself does not overreach, so this is not a blocker, just a small future-state wording mismatch in `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:24` and `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:12`. The slice boundary is stated in `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-conference-detail-3.3/personal-gyc-42088828/20260617-161210-claude-to-codex-830585/prompt.md:16` and `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:141`.

Why I’m approving:

- Exact slice is right: the commit adds only `conference-detail.tsx` and `conference-detail.test.tsx`, matching 3.3’s “extract + test” job and leaving 3.4 to wire/delete forks. See `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.3.diff:31` and `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:141`.
- Public interface is the mandated one-prop boundary: `ConferenceDetail({ conference }: { conference: Conference })`, with all sections private below it. See `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:51`.
- The RegFox URL, schedule URL, map iframe `src`, and hotels are data-driven from `Conference`, not hard-coded in the new module. See `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:90`, `:178`, `:207`, `:217`, and `:565`; compare the 2024 hard-coded oracle at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:94`, `:183`, `:214`, `:226`, and `:575`.
- The boundary is plain `string | undefined` / array data, with `Option` projected before React sees it. See `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:143` and `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:274`.
- Test surface covers the required slice: full render, registration URL, schedule URL, map `src`, hotels, mobile breakpoint, and FR localization. See `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:128`.
- I did not rerun the gate; the prompt says it was already green, and I didn’t see a diff-level threat to it. See `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-conference-detail-3.3/personal-gyc-42088828/20260617-161210-claude-to-codex-830585/prompt.md:48`.

**Let Me Take More Off Your Plate**
- Next actions I can do right now: review 3.4’s loader wiring/deletion commit with the same slice discipline.
- Automations or systems I can set up: add a tiny counsel checklist script that verifies add-only vs delete/wire commits by sub-commit number.
- Things to delegate to your team: ask the implementer to adjust the two comments from “loaders render” to “loaders will render in 3.4” before stack handoff.