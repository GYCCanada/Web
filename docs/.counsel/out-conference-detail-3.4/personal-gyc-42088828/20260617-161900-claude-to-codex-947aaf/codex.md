**Verdict: approve**

**Blocking Items**

None.

The commit implements exactly sub-commit 3.4’s slice. All three year routes now import `ConferenceDetail`, call `content.getConference(locale, literalYear)`, and render exactly `<ConferenceDetail conference={conference} />` with no remaining forked detail JSX:

- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:8`, `:30`, `:35`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx:8`, `:30`, `:35`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx:8`, `:30`, `:35`

The subtract test is satisfied: the route files collapsed from 617/622/622 lines to 36 lines each, and the diff deletes 587/594/592 lines from the three forks. This matches the Branch 3 plan requiring all three routes to collapse and all three forked JSX copies to vanish.

The home-route audit is acceptable. `_index.tsx` still loads `getCurrentConference` and renders a distinct home hero/countdown teaser, not `MapSection`, `SpeakersAndSeminars`, `RegistrationSection`, `FaqSection`, or `ConferenceDetail` sections. The commit message explicitly records that audit and leaves the teaser as-is, which matches the plan’s allowed outcome.

The meta title change is in-scope and correct: it touches only the three files being collapsed, fixes the latent “current year title on historical routes” bug, and keeps each `/YYYY` title aligned with the route year. Leaving home meta’s `new Date().getFullYear()` untouched is correct for this slice because home is not a literal year detail route.

**Non-Blocking Concerns**

None for this commit.

No new loader/route-level test is required for 3.4. This is a pure delegation/deletion commit; the existing `conference-detail.test.tsx` surface from 3.3 plus the reported green gate is adequate proof. Branch 4 owns the remaining section-skip behavior, so the currently ungated shared sections are not a 3.4 regression.

**File References Used**

- `/Users/cvr/Developer/personal/gyc/docs/.counsel/out-conference-detail-3.4/personal-gyc-42088828/20260617-161900-claude-to-codex-947aaf/prompt.md:1`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:103`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:107`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:111`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:113`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:129`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:142`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:30`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:38`
- `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md:56`
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.4.diff:5`
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.4.diff:12`
- `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-3.4.diff:20`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:30`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:35`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx:30`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx:35`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx:8`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx:30`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx:35`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:24`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:51`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:36`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:56`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:93`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:197`
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:305`
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:390`
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:491`
- `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:503`