**Verdict: block**

**Blocking Issues**
1. `/Users/cvr/Developer/personal/gyc/app/lib/content/id-backfill.ts:86-90` masks malformed `hotels` values. The code supplies `[]` whenever `backfillItems(conference['hotels'])` returns `undefined`, which includes a present-but-invalid value like `null`, object, or string. Because `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:380-383` runs this before strict decode, bad authored content can silently become “no hotels” instead of failing validation. This contradicts the normalizer’s own “absence, not repair” contract at `/Users/cvr/Developer/personal/gyc/app/lib/content/id-backfill.ts:17-19` and the strict required `hotels` schema at `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:451-454`. Fix: only default when the key is absent; if present and non-array, leave it for the decoder. Add a test beside `/Users/cvr/Developer/personal/gyc/app/lib/content/id-backfill.test.ts:106-124`.

2. `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:136` requires byte-identical 2024 rendering, but the hotel text changed. The old fork’s 2024 spec line is visible in `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-WHOLE.diff:907-910`; the new data at `/Users/cvr/Developer/personal/gyc/app/lib/content/defaults.ts:109-114`, rendered by `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:207-212`, changes punctuation/quotes in the Fairfield/Holiday Inn line. That is a real render regression against “the forked file was the spec.” Fix the default `note` to reproduce the old rendered text exactly, then add a regression assertion that would catch this.

**Non-Blocking Concerns**
- `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.ts:178-188` accepts any path starting with `/maps/embed`, including `/maps/embedFOO`. I do not think this is an immediate host-spoof bypass because protocol, host, and credentials are constrained, but the brand should probably tighten to `pathname === '/maps/embed' || pathname.startsWith('/maps/embed/')`; add a test in `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts:230-267`.
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:34-82` uses a synthetic fixture and broad `contains` checks, so it did not prove the 2024 fork equivalence. The current regression is exactly the kind of thing a fixture-from-defaults or snapshot-style comparison should catch.

**What Looks Sound**
The deep-module shape is correct: `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.tsx:51-63` exposes one prop and hides the sections/card machinery; `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2024/_index.tsx:26-35`, `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2025/_index.tsx:26-35`, and `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/2026/_index.tsx:26-35` are thin loaders. Option projection is also coherent at `/Users/cvr/Developer/personal/gyc/app/lib/content.server.ts:274-277`, and the home route remains a teaser rather than a fourth detail fork at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/_index.tsx:197-303`.

Tests not run; this was a static adversarial review.

**References Used**
`/Users/cvr/Developer/personal/gyc/docs/.counsel/out-conference-detail-WHOLE/personal-gyc-42088828/20260617-162652-claude-to-codex-338b28/prompt.md`; `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md`; `/Users/cvr/Developer/personal/gyc/docs/registration-launch-brief.md`; `/Users/cvr/Developer/personal/gyc/docs/.counsel/conference-detail-WHOLE.diff`; changed source/test files cited above; `/Users/cvr/.brain/principles/never-block-on-the-human.md`; `/Users/cvr/.brain/principles/redesign-from-first-principles.md`.

**Let Me Take More Off Your Plate**
- Right now: patch both blockers and add the two missing regression tests.
- Automation/system: add a 2024 pre-branch render-equivalence harness for future detail-page refactors.
- Delegate: ask a teammate to re-review Branch 4 skip gating after this branch stops masking malformed `hotels`.