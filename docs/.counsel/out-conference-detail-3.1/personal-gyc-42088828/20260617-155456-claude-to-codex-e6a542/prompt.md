# Counsel review — registration-launch Branch 3, sub-commit 3.1 (STANDARD, single commit)

You are reviewing a SINGLE just-landed commit in a stacked-PR program. Review ONLY this commit
against the plan slice it claims to implement. Do not review the rest of the stack. Be concrete:
cite file:line. Return a verdict plus any BLOCKING items and lesser CONCERNS.

## What to judge (the only questions that matter for this review)

1. **Exact slice — no more, no less.** Does this commit implement EXACTLY sub-commit 3.1's slice
   from the plan (URL brand types with per-component XSS filters + `Hotel` struct + Conference
   schema growth via `OptionFromOptionalKey` + defaults for 2024/2025/2026)? Does it leak work
   that belongs to 3.2 (boundary `toConference` projection), 3.3 (the `ConferenceDetail`
   component), or 3.4 (loaders/deletions)? Does it omit anything 3.1 explicitly requires?
2. **`small-interface-deep-implementation` + the branch's stated module interface.** The branch
   module is `ConferenceDetail` (Branch 3); 3.1 is its schema/data substrate. Are the new brands
   and structs the right shape and depth?
3. **`subtract-before-you-add`.** 3.1 is additive schema growth; the deletions of the forked
   `/YYYY` pages land in 3.4. Is it correct that 3.1 carries NO deletion, or does the plan
   require 3.1 to subtract something it didn't?
4. **Gate.** typecheck + lint + build + test all pass (confirmed green locally: 237 tests pass,
   0 fail; the lint warnings are pre-existing in files this commit does not touch). Sanity-check
   that the test surface the plan requires for THIS slice is present.
5. **Principle violations.** Especially: `make-impossible-states-unrepresentable` (Option modeling,
   empty-string-URL-not-representable), `boundary-discipline` (the XSS brand earned at the schema),
   `correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO commented-out code). The plan is
   emphatic the URL brands must be per-component (parse + inspect components), NOT a substring or
   `origin` test. Verify the filters actually parse and inspect components.
6. **Missing test the plan's test surface requires for THIS slice.** Plan §Branch 3 test surface
   names: `schema.test.ts` — `ExternalHttpsUrl` rejects `http:`/`javascript:`/`data:`/credentialed;
   `GoogleMapsEmbedUrl` rejects non-`www.google.com` hosts AND `https://www.google.com/anything`
   (the path-vs-origin case), accepts `/maps/embed/...`. Is each present?
7. **Behavior regression.** Does growing `Conference` / `DraftConference` / defaults break any
   existing decode (the live `content/site.json` read path, the required-conferences invariant,
   the draft reconciliation)? Note: `registrationUrl`/`scheduleUrl`/`mapEmbedUrl` are
   `OptionFromOptionalKey` (absent is fine); `hotels` is a new REQUIRED array field on Conference —
   scrutinize whether existing stored/default documents lacking `hotels` would fail decode, and
   whether the defaults correctly supply `hotels` for every conference (2024 populated, 2025 `[]`,
   2026 `[]`).

## Specific things worth probing (don't limit yourself to these)

- `GoogleMapsEmbedUrl` is declared as `Schema.NonEmptyString.check(externalHttpsUrlFilter,
  googleMapsEmbedUrlFilter)`. The `googleMapsEmbedUrlFilter` checks host + path but does NOT
  re-check protocol/credentials — it relies on `externalHttpsUrlFilter` running first in the same
  `.check(...)`. Is that composition sound (both filters run; https + no-credentials still
  enforced)? The test `javascript:alert(1)//www.google.com/maps/embed` and
  `http://www.google.com/maps/embed` should be rejected — confirm the filter ordering makes that
  hold.
- Host-spoof case `https://www.google.com.evil.com/maps/embed`: does `url.host !== 'www.google.com'`
  correctly reject it? (`host` includes port; here host is `www.google.com.evil.com`.)
- `Hotel.note` is `Schema.optionalKey(Text)` (document layer) while `DraftHotel` relaxes
  `name`/`note` to `optionalKey(DraftText)`. Is the strict-vs-draft split consistent with how
  `Speaker`/`Seminar` are modeled, and does it honor settled #3 (present item with blank required
  bilingual field = hard error) and settled #10 (freshly-added item carries only its id)?
- Defaults: the 5 hotel ids are hard-coded nanoid-looking strings. Plan/ADR 0006 says ids are
  content that round-trip. Are these valid `ListItemId`s (the decode would fail otherwise — and the
  gate is green, so they decode; but flag if any look malformed or risk collision)?
- Does `DraftConference` need `OptionFromOptionalKey` handling for the three URL fields, or is
  spreading `...Conference.fields` (which already carries them) correct? Confirm no draft-decode
  hazard from the new optional URL fields.

## Context provided

- **Full synthesized plan:** docs/registration-launch-plan.md (read it; the Branch 3 section is
  lines ~103–143, sub-commits at ~138–143).
- **Branch PR plan section:** "Branch 3 — `reg-launch/conference-detail`" in that file.
- **Settled decisions / brief:** docs/registration-launch-brief.md (settled #3, #4, #9, #10).
- **Domain glossary:** CONTEXT.md (§Conference, §Section skip, §Registration channel, §Hiatus).
- **This commit's intent:** sub-commit 3.1 — URL brand types (per-component XSS filters) + Hotel +
  Conference schema growth (OptionFromOptionalKey) + defaults (2024/2025/2026).
- **This commit's full diff:** docs/.counsel/conference-detail-3.1.diff (commit
  f6b147881242abef6b0f050e10086ad0b637934e). Touches only:
  `app/lib/content/schema.ts`, `app/lib/content/schema.test.ts`, `app/lib/content/defaults.ts`.

Read the diff and the cited plan/brief/CONTEXT sections, then return: a verdict (approve /
approve-with-concerns / request-changes), a list of BLOCKING items (must-fix before proceeding:
plan deviation, principle violation, incomplete deletion, broken gate, untested boundary, behavior
regression), and lesser CONCERNS. Keep it tight and cite file:line.
