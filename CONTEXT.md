# GYC Canada — Context

GYC Canada (Generation of Youth for Christ Canada) is a Canadian Seventh-day Adventist
youth ministry. This repository is its public-facing **conference website** — bilingual
(English / French), one site covering each year's annual conference plus evergreen pages
(about, team, FAQ, contact, give, volunteer, archive).

## Glossary

### Page

An **evergreen**, individually-schema'd unit of editable site content — about, FAQ,
give, contact, volunteer, archive, and the home page's non-conference sections. Each
Page has its own typed CMS schema (a FAQ Page is a list of Q&A items; a Give Page is a
directions list plus a donate URL), authored through a dedicated `/admin` section. A Page
is **not** a Conference: a Conference is an entity *rendered into* the `/YYYY` and home
routes, whereas a Page owns its own content. _Avoid_: "route" (a route may render a Page,
a Conference, or both), "screen".

### Section skip

A Page or Conference view renders a **section** (Speakers, FAQ, Registration, …) only
when that section *has data*: its list is non-empty, or its optional block is present
(`Option.some`). An empty list or an absent optional block is **skipped silently**. Skip
is "nothing here yet" — it is **not** a tolerance for half-filled content: a *present*
item with a blank required bilingual field is still a hard validation error (the `Text`
"both locales non-empty" invariant is never relaxed). _Avoid_: "hide" (that implies a
visibility toggle on present data; skip is purely about absence).

### Form definition

A **data** description of one of the site's forms (contact, volunteer, registration) —
its fields, their kinds (drawn from a closed set: required/optional text, email, URL,
literal/radio, checkbox-boolean, array-of-literal, nested group), their bilingual
labels/placeholders, and their validation rules including discriminated-union variants
and cross-field requirements. A generic renderer turns a Form definition into the rendered
form; a generic decoder reconstructs server-side validation from it. The field *kinds* are
a fixed, specified set — a Form definition cannot invent an arbitrary field type. _Avoid_:
"form schema" when you mean the hand-tuned Effect Schema code (that is being replaced by
the Form definition + generic decoder).

### Submission

A persisted record of one completed form (a registration, a contact message, a volunteer
signup), stored as its own bucket object (`submissions/<form>/<id>.json`) at submit time,
with an email notification sent *of* the stored record. A Submission is the durable
source of truth — the planned future registrar reads the registration Submission log; the
email is a notification, not the record. _Avoid_: treating a submission as a transient
email payload.

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

### Registration channel

How attendees actually register for a Conference. Two exist: the **external registrar**
(RegFox, reached via the Conference's optional `registrationUrl` Register button) and the
**on-site form** (the form-builder–driven registration form whose Submissions persist to
the bucket + notify, seeding a possible future first-party registrar). For 2026 the live
channel is **RegFox**; the on-site form is built and proven but not load-bearing until/
unless the first-party registrar is finished before signups open. A Conference names its
live channel by whether `registrationUrl` is set. _Avoid_: assuming the on-site form is
the registration channel — it is the registrar's seed, not (yet) the live path.

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
- **0005** — Effect everywhere: Effect Schema is the sole validation layer, the Effect
  runtime the sole loader/action path, conform `/future` + StandardSchema for forms, and a
  tagged `Http.*` error taxonomy. Removes `zod` / `@conform-to/zod`.

## Notes for the revival

- The misnamed `Conference.theme` field (a hex **accent colour**, not the theme _name_) is a
  rename candidate during the migration — see ADR 0002's per-year theming.
- Public assets are organised as `public/<year>/<locale>/...`. 2026 art lands in
  `public/2026/`. The 2026 hero images supplied are landscape (~1.5:1); a portrait **mobile**
  crop is still owed (desktop uses `hero-title-verse.png`, mobile temporarily reuses it).
