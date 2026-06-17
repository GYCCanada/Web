# Stable list-item ids replace index-aligned merge

**Status:** accepted

## Context

The `/admin` content editor edits the one `SiteContent` document by **index-aligned
merge** (`app/lib/content/admin-form.ts`): the form names list fields positionally
(`team.0.name`, `conferences.2.speakers.1.bio`) and `deepMerge` overlays them onto the
encoded document element-by-element by index. This was a deliberate choice (it lets an
edit carry only the rendered fields while every unedited deep field survives) but it has a
structural limit: **it can only edit existing indices — it cannot add or remove list
items.** Growing or shrinking a list (adding a newly-announced speaker, removing a team
member) is impossible, which is the CMS's headline gap.

## Decision

Every CMS list item (speaker, seminar, team member, hotel, FAQ item, give-direction,
about-paragraph, …) carries a **stable `id`** (a `nanoid`; the repo already depends on
`nanoid`). The editor names fields by id (`speakers.<id>.name`), and the index-aligned
merge is replaced by **id-keyed merge**: add = append an item with a fresh id, remove =
drop that id, reorder = an explicit order array of ids. "Add item" appends an empty item
(generated id + empty required fields) and auto-saves the draft, so the id exists
server-side before a photo upload or field edit targets it. The bundled defaults are
migrated once to assign ids to their existing list items.

## Consequences

- The existing speakers/team editing behaviour changes: id-keyed, not positional. The
  `deepMerge`-by-index logic in `admin-form.ts` is rewritten, not extended.
- A present-but-empty appended item does not render publicly (section-skip is list-empty;
  an empty *required* field blocks publish, not draft save).
- Ids are content, not derived — they must round-trip through the schema and persist in the
  bucket document.
