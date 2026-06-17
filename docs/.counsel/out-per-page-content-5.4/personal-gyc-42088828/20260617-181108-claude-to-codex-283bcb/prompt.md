# Counsel review — single commit 5.4 (per-page-content branch)

You are Codex doing a STANDARD code review of ONE just-landed commit in a stacked PR.
Review ONLY this commit against the plan slice it claims. Do not review the whole branch,
prior commits, or future commits except as context for what this slice must and must NOT do.

## What to judge (answer each explicitly)

1. **Exact slice — no more, no less.** Does this commit implement EXACTLY sub-commit 5.4's
   slice: "Migrate evergreen routes (incl. home) to `getPage`; delete the per-page flat
   translation keys"? Flag scope creep (work belonging to 5.5 admin sections, or 6.x forms)
   AND under-delivery (a route/page that should have migrated but didn't).
2. **small-interface-deep-implementation + the branch's module interface.** Branch 5's read
   path is `Content.getPage(id)` returning a typed bilingual Page; routes project to the
   current locale at the boundary. Is the projection module (`app/lib/content/pages/project.ts`)
   a proper boundary converter (the `toConference` analogue), keeping the `Content` surface
   small? Is the `RichText` renderer (`app/ui/rich-text.tsx`) a single closed-token renderer,
   not arbitrary HTML?
3. **subtract-before-you-add — this commit's share of the plan's deletions.** Branch 5's
   subtract is the 352-key flat-translation god-bag retirement: `faq.*`, `give.*` copy,
   `about.*`, `volunteer.*`, `contact.*`, home-evergreen `main.*` keys deleted from
   `translations.ts` (and defaults), with UI-chrome keys (nav, buttons, form labels) RETAINED.
   Did 5.4 actually delete the per-page copy keys it migrated (deletion test: do the flat keys
   genuinely vanish)? Did it correctly KEEP chrome keys? Any key migrated to a Page object but
   left dangling in `translations.ts` (dead key), or any key deleted that a surviving route
   still calls (broken `translate`)?
4. **Gate.** `bun run typecheck && bun run lint && bun run build && bun test`. (Reviewer ran
   it: typecheck pass, lint clean except one PRE-EXISTING unrelated `require-yield` warning in
   `form.test.ts`, build OK, 316 pass / 0 fail.) Call out anything that looks gate-fragile.
5. **Principle violations.** No cast-to-any, no stubs, no commented-out code as a substitute
   for migration, boundary-discipline (React never sees bilingual `Text` or a branded href or
   an `Option`), make-impossible-states-unrepresentable (closed RichText token set),
   derive-dont-sync (the projection computed from the one decoded object, not re-declared).
6. **Test surface the plan requires for THIS slice.** Plan's Branch-5 test surface includes
   `RichText` token round-trip and per-locale projection. This commit adds `project.test.ts`
   (per-locale projection + link-href carry-through + `\n\n` preserved) and `rich-text.test.tsx`
   (token→DOM, `\n\n`→`<br/><br/>`). Is that the right test surface for a route-migration +
   key-deletion slice, or is a behavior-parity assertion missing?
7. **Behavior regression.** The migrated routes must render EN+FR identically to the deleted
   flat-key versions. The commit message documents CONSCIOUS styling deltas (home tagline loses
   the gradient-underlined movement/for words; join subtitle loses its `{{br}}` break;
   give/volunteer titles render plain, no italic movement) on the grounds that the 5.1 schemas
   (already committed) do not model these. Judge: are these acceptable as conscious deltas for a
   CMS-migration slice, or does any of them constitute a real content regression that should
   block? Is the `\n\n`→`<br/><br/>` reconstruction faithful to the old literal `<br/><br/>`?

## Context for your judgment

- Sub-commit id + intent: **5.4 — Migrate evergreen routes (incl. home) to `getPage`; delete
  the per-page flat translation keys.** Branch: `reg-launch/per-page-content` (Candidate 5,
  ADR 0008). It is NOT launch-critical (RegFox carries Friday).
- The 5.1 schemas (`RichText` + six Page schemas + `HomePage`), 5.2 (widened `ContentScope`),
  and 5.3 (`Content.getPage`/`getForm` multi-object read path) are ALREADY committed (prior
  commits in this branch) — 5.4 is the route migration + key deletion that consumes them.
- The archive route (`app/routes/($lang)+/archive+/_index.tsx`) is an EMPTY placeholder (renders
  an empty div, uses no translate keys), so it carries no flat keys to migrate — out of 5.4's
  deletion scope by construction. The `ArchivePage` schema/`toArchiveView` exist but no route
  consumes them yet. Flag if you think this is wrong.
- `give.directions` (the section HEADER label, distinct from the deleted `give.directions.1-4`
  list items) is RETAINED in `translations.ts` as a chrome label. Judge whether that's the
  right chrome/copy boundary.

## Files

- FULL synthesized plan: `docs/registration-launch-plan.md` (read the whole thing; Branch 5
  section is lines ~172-211).
- Settled decisions / brief: `docs/registration-launch-brief.md`.
- ADR 0008: `docs/adr/0008-per-page-storage-objects.md`.
- THIS commit's diff: `docs/.counsel/per-page-content-5.4.diff` (the full `git show`).

## Output

Give a verdict (approve / approve-with-concerns / request-changes), an explicit list of any
BLOCKING items (must-fix before the branch proceeds), and non-blocking concerns. Be concrete:
cite file paths/lines. If the slice is exactly right and gate-green, say so plainly — do not
manufacture work.
