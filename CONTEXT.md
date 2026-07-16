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

### Form definition version

An immutable published revision of a Form definition. Publishing creates a new Form
definition version and moves the Form's current-version pointer; it never changes a version
already referenced by a Submission. A Submission names exactly one Form definition version,
so the rules that accepted it remain recoverable. _Avoid_: "form version" when it could mean
the stable Form identity rather than one published definition.

### Submission

A persisted record of one completed form (a registration, a contact message, a volunteer
signup), validated against and linked to an exact Form definition version. A Submission is
the durable source of truth in the relational Submission store; email is a notification of
the committed record, not the record itself. Repeated equal payloads are distinct unless
they carry the same explicit idempotency token. _Avoid_: treating a Submission as a transient
email payload or deriving user intent from its content hash.

### Registration

One accepted group of one or more Registrants for a Conference, validated against an exact
Registration Form definition version. A Registration may be partially confirmed when its
Registrants have separate payment responsibilities. _Avoid_: using Submission and
Registration interchangeably; Submissions preserve submitted answers, while a Registration
tracks attendance confirmation.

### Registrant

A person included in a Registration. A Registrant becomes confirmed when the Order covering
their payment responsibility completes, and becomes cancelled when that Order is fully
refunded. _Avoid_: Payer; a Payer may not be attending.

### Order

A durable payment responsibility for either a whole Registration or one Registrant, carrying
the server-frozen quote and its payment lifecycle. Every Order uses Stripe Checkout,
including a zero-dollar Order; a completed Stripe payment is honored even if local expiry
processing raced ahead of its webhook. _Avoid_: copying Order state onto Submission payloads.

### Conference

A single annual gathering, identified by its **year** and addressed by a year **slug**
(`/2024`, `/2025`, `/2026`). A Conference carries a `theme`, a `bible` reference, `dates`,
a `location`, a `tagline`, and arrays of `speakers` and `seminars`. Each Conference exists
in both locales (EN / FR). Conferences are authored through the CMS alongside other site
content (see "CMS" below).

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

The site's custom administration interface for authoring Conference, Page, Form, team, and
translation content without editing source files. It is home-grown and bun-native; it does
not revive the deleted Payload/MongoDB scaffold (ADR 0001). The CMS edits typed domain
content and publishes it through the same validation boundaries used by public readers.

### Speaker

A person presenting at a Conference. Two roles:

- **Plenary speaker** — gives a main session (morning/evening plenary); listed in
  `speakers` with an `activity` label.
- **Seminar speaker** — leads a breakout seminar; nested inside a `seminars` entry.

A Conference may have an empty `speakers`/`seminars` list when speakers are **TBD**
(as 2025 was, and as 2026 currently is).

### Registration channel

How attendees register for a Conference. A Conference has exactly one channel lifecycle:
**closed** (no registration), **external** (a third-party registrar such as RegFox),
**preview** (administrators may render and quote the first-party registrar without creating
a Registration or payment responsibility), **open** (the first-party registrar accepts
public registrations), or **draining** (new registrations are closed while existing
payments and Orders finish). For 2026 the channel is **external** through RegFox. _Avoid_:
independent external-URL and enabled flags; they can describe contradictory live channels.
Once a channel has been open, it must drain every non-terminal Order before becoming closed
or external; draining never implies an automatic external fallback.

### Billing mode

How a Registration group's price becomes payment responsibility. **Group** creates one
payment responsibility for the whole group; **per-registrant** creates one for each
Registrant. A published Form definition may offer either or both. _Avoid_: deriving billing
mode from group size.

### Payer

The person responsible for a Group billing-mode payment. A Payer may be nominated without
being a Registrant. _Avoid_: assuming the first Registrant is always the Payer.

### Registration refund

An operator-authorized return of an Order's complete captured amount. Partial and automatic
refunds are not part of the first-party registrar's initial policy. _Avoid_: treating a
cancelled Registration as an implicit refund.

### Registration window

A Conference may define pricing windows such as **early**, **regular**, and **late**. Each
window is a half-open interval of exact instants authored in the Conference time zone and
normalized to UTC, so every Registrant receives the same server-calculated price. Windows
are optional when pricing is undecided.

### Conference time zone

The IANA time zone in which a Conference's local schedule and Registration-window cutoffs
are authored. _Avoid_: browser-local or server-local time for pricing decisions.

## Decisions

Architectural decisions are recorded as ADRs under `docs/adr/`:

- **0001** — Collapse to a single Bun + React Router v7 app; delete the PayloadCMS scaffold.
- **0002** — Replace React Aria with shadcn-on-base-ui; Tailwind v4 CSS-first; preserve identity.
- **0003** — Effect v4 on Bun (paulo-suzanne pattern); oxlint + tsgo + bun test.
- **0004** — Effect Config remains the environment boundary; its Railway deployment decision
  is superseded by ADR 0009.
- **0005** — Effect everywhere: Effect Schema is the sole validation layer, the Effect
  runtime the sole loader/action path, conform `/future` + StandardSchema for forms, and a
  tagged `Http.*` error taxonomy. Removes `zod` / `@conform-to/zod`.
- **0006** — Stable list-item identities across CMS edits.
- **0007** — Structural, data-driven Form definitions with an equivalence-harness migration.
- **0008** — Independent Page and site content objects with local decode/fallback boundaries.
- **0009** — CI publishes a pinned Docker image; the custom server runs an immutable digest.
- **0010** — Immutable Form definition versions and relational, transactional Submissions.

## Notes for the revival

- The misnamed `Conference.theme` field (a hex **accent colour**, not the theme _name_) is a
  rename candidate during the migration — see ADR 0002's per-year theming.
- Public assets are organised as `public/<year>/<locale>/...`. 2026 art lands in
  `public/2026/`. The 2026 hero images supplied are landscape (~1.5:1); a portrait **mobile**
  crop is still owed (desktop uses `hero-title-verse.png`, mobile temporarily reuses it).
