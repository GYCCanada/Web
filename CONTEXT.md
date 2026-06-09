# GYC Canada — Context

GYC Canada (Generation of Youth for Christ Canada) is a Canadian Seventh-day Adventist
youth ministry. This repository is its public-facing **conference website** — bilingual
(English / French), one site covering each year's annual conference plus evergreen pages
(about, team, FAQ, contact, give, volunteer, archive).

## Glossary

### Conference

A single annual gathering, identified by its **year** and addressed by a year **slug**
(`/2024`, `/2025`, `/2026`). A Conference carries a `theme`, a `bible` reference, `dates`,
a `location`, a `tagline`, and arrays of `speakers` and `seminars`. Each Conference exists
in both locales (EN / FR). Conferences are stored as static data; there is no live CMS
backing them (see "CMS" below).

### Current Conference

The Conference the site is currently promoting. Selected by date: the first Conference
whose start date is still in the future, falling back to the most recent one. Adding a
new future-dated Conference automatically makes it the Current Conference — there is no
manual "active" flag.

### Theme

Two senses, kept distinct:

- **Theme name** — the conference's title/motto (e.g. "While It Is Day", "A Still Small
  Voice", "Speak"). Stored as `title`.
- **Theme colour** — a single hex accent colour for that year's visual identity, stored
  in the (poorly named) `theme` field. NOTE: this field name is misleading and is a
  candidate for renaming during the revival (see decision log).

### Locale

The language/region the site is rendered in: `en` or `fr`. Expressed in the URL via an
optional leading segment (`/about` = English default, `/fr/about` = French). Every piece
of conference and UI content exists in both Locales.

### Hiatus

GYC Canada took a **one-year hiatus** — the planned 2025 conference in Montreal was
cancelled and no 2026-prior conference ran. 2026 ("Speak", Calgary) is the **return**
conference. The 2025 entry remains in the data as a cancelled/archived year.

### CMS

Conference content is authored directly as **typed TypeScript data** (not through a
content-management UI). A PayloadCMS scaffold once existed (`apps/cms`) but defined no
content collections, was never wired to the site, and has been deleted (see ADR 0001).
"Editing the content" means editing the conference data file and redeploying.

A future **custom CMS** is planned as a separate project: home-grown, bun-native, and
**database-backed** (live editing without redeploy), in the style of `paulo-suzanne`'s
admin panel. It will not revive Payload/MongoDB. Until it exists, the typed-data model
above is the source of truth.

### Speaker

A person presenting at a Conference. Two roles:

- **Plenary speaker** — gives a main session (morning/evening plenary); listed in
  `speakers` with an `activity` label.
- **Seminar speaker** — leads a breakout seminar; nested inside a `seminars` entry.

A Conference may have an empty `speakers`/`seminars` list when speakers are **TBD**
(as 2025 was, and as 2026 currently is).

### Registration window

A Conference may define three pricing windows — **early**, **regular**, **late** — each a
`[start, end]` date pair. Windows are optional: a Conference with undecided pricing
(e.g. 2026 at present) simply omits `registration`.

## Decisions

Architectural decisions are recorded as ADRs under `docs/adr/`:

- **0001** — Collapse to a single Bun + React Router v7 app; delete the PayloadCMS scaffold.
- **0002** — Replace React Aria with shadcn-on-base-ui; Tailwind v4 CSS-first; preserve identity.
- **0003** — Effect v4 on Bun (paulo-suzanne pattern); oxlint + tsgo + bun test.
- **0004** — Railway via Bun auto-detect; environment via Effect Config.

## Notes for the revival

- The misnamed `Conference.theme` field (a hex **accent colour**, not the theme _name_) is a
  rename candidate during the migration — see ADR 0002's per-year theming.
- Public assets are organised as `public/<year>/<locale>/...`. 2026 art lands in
  `public/2026/`. The 2026 hero images supplied are landscape (~1.5:1); a portrait **mobile**
  crop is still owed (desktop uses `hero-title-verse.png`, mobile temporarily reuses it).
