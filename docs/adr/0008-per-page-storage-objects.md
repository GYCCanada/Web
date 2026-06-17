# Per-page content objects + per-form objects

**Status:** accepted
**Supersedes:** the single-document read path established in `docs/cms-plan.md` (C2/C3),
where all editable content lived in one `content/site.json`.

## Context

The original CMS (ADR 0001 follow-through, `cms-plan.md`) stored **all** editable content
as one bilingual `SiteContent` document at `content/site.json`, read and cached as a
single object by the `Content` service. The CMS expansion adds a typed schema per
evergreen Page (about, faq, give, contact, volunteer, archive) and data-driven Form
definitions for the three forms. Folding all of that into the one document makes it large
and gives any single bad edit a whole-site blast radius: one malformed page fails the
entire decode, and every publish rewrites the whole document.

## Decision

Split storage into **per-page content objects and per-form objects**, with shared Effect
Schema *types* across them:

- `content/site.json` — conference, team, translations (unchanged core).
- `content/pages/<page>.json` — one object per Page.
- `forms/<form>.json` — one object per Form definition.
- `submissions/<form>/<id>.json` — one object per Submission.

The `Content` service is refactored to read a **set** of objects, each with its own decode
boundary, fallback-to-bundled-default, and independent cache-bust. A missing or empty page
object falls back to its default or skips (section-skip), so editing one page can never
break another's decode, and publishes are small and focused.

## Consequences

- Reverses the C2/C3 "one document, one cache, one publish" design — a future reader needs
  this ADR to know the split was deliberate, not drift.
- The `Content` read path becomes a multi-object loader; the required-conferences
  invariant stays on `content/site.json` only.
- Editing the About page busts only its object's cache, not the conference cache.
