# CMS Layer — Plan & End Goal

**Branch:** `cms/storage-foundation` (stacked on `revival/2026-speak`, PR #10).
**Status:** in progress (ultracode workflow `.claude/workflows/gyc-cms.js`).

This document is handed to Codex on **every** `okra counsel` review so it situates each
sub-commit against the whole feature and the end goal, and does not flag intentional
deferrals. Keep it current.

---

## End goal (what "done" looks like)

A home-grown, bun-native, **runtime-read** CMS for the GYC Canada site — the
"future custom CMS" promised in `CONTEXT.md` / ADR 0001, modelled on the
`paulo-suzanne` sibling's admin pattern but adapted to GYC's conference domain and to
GYC's **per-request SSR** model (paulo-suzanne reads at build time + redeploys on
publish; **we do NOT** — we read at request time with a cache, so publishing is instant,
no redeploy).

Concretely, when the feature is complete:

1. **All editable content** — conference data (2024/2025/2026: title, theme name + accent
   colour, dates, tagline, bible ref, location, speakers, seminars, registration windows,
   promos), team members, and the ~200 UI translation keys — lives as **one bilingual
   `SiteContent` document** in a Railway **Bucket** (S3-compatible) at `content/site.json`.
2. Images (hero, speaker photos, team photos) live in the same bucket under `images/…` and
   are served through the Effect server (proxied with cache headers), replacing today's
   bare `public/<year>/…` path strings.
3. A password-protected **`/admin`** editor (HMAC-signed cookie session) edits the content
   and publishes it. Publish writes `content/site.json` and the cache picks it up on the
   next read (TTL or explicit bust) — **no redeploy**.
4. The public site reads content through a **`Content` Effect service** that decodes the
   bucket document (boundary validation), caches it with a short TTL, and **falls back to
   bundled typed-TS defaults** when the bucket is unconfigured or unreachable. The site is
   never broken by a missing/empty bucket — dev with no bucket behaves exactly like today.

## Non-goals / deferred (do NOT flag these as gaps)

- **No build-time prerender + redeploy-on-publish** (that's paulo-suzanne's model; we chose
  runtime-read-with-cache deliberately for GYC's SSR server — see decision D3).
- **No relational DB.** Content is one JSON document in object storage, decoded by Effect
  Schema. (A normalized speaker entity etc. is a possible later refinement, not this PR.)
- **No `@aws-sdk`.** Use Bun's native `S3Client` (`Bun.s3`) — zero dependency, matches
  paulo-suzanne, and is Railway's recommended Bun client (`use-the-platform`).
- **Portrait mobile hero crop**, 2026 speakers/registration windows — still owed by the
  product, independent of the CMS.
- **Image upload pipeline polish** (resize/WebP/thumbnail like paulo-suzanne's
  `Bun.Image`) — land a working upload first; optimisation can follow.

---

## Architecture (mirrors paulo-suzanne, adapted)

| Concern | paulo-suzanne | GYC (this plan) |
|---|---|---|
| Storage client | `Bun.S3Client` in a `Storage` Context.Service | same |
| Content model | one `SiteContent` Effect Schema doc | one `SiteContent` doc, **conference-domain** schema |
| Bilingual text | `Text = {en, fr}` | same |
| Image refs | `ImageRef { key, alt, w, h }` by bucket key | same |
| Read path | build-time direct `S3Client` + redeploy | **runtime `Content` service + TTL cache + TS fallback** (D3) |
| Admin auth | HMAC cookie, `ADMIN_PASSWORD` + `COOKIE_SECRET` | same (`Auth` Context.Service) |
| Admin UI | hand-built `/admin` editor, draft→publish | same shape, GYC sections |
| Publish | write `site.json` + Railway redeploy | write `site.json` + **cache bust, no redeploy** (D3) |
| Env | `BUCKET_ENDPOINT/ACCESS_KEY/SECRET_KEY/NAME/REGION` | same names, added to `Env` service, **optional in dev** |

### Services (Effect v4, `Context.Service`, `effect-v4` skill rules)

- **`Storage`** (`app/lib/storage.server.ts`) — narrow surface: `get / put / head / list /
  delete`, errors `StorageError` / `NotFound` (`Schema.TaggedErrorClass`). Wraps
  `Bun.S3Client`. `static layer` reads bucket config from `Env`; `static layerTest` is an
  in-memory `Map`. (small-interface-deep-implementation, use-the-platform.)
- **`Content`** (`app/lib/content.server.ts`) — the deep module the routes talk to:
  `getSiteContent()` → decoded `SiteContent`, plus derived selectors
  `getConference(locale, year?)`, `getCurrentConference(locale)`, `getTranslations(locale)`,
  `getTeam(locale)`. Absorbs: bucket read, Schema decode (boundary), **TTL cache**, and
  **fallback to bundled defaults**. Selection logic (current-conference-by-date,
  by-year) lives **here**, derived from the decoded doc — NOT duplicated
  (derive-dont-sync). Cache is serialized so concurrent first-reads don't stampede
  (serialize-shared-state-mutations).
- **`Auth`** (`app/lib/auth.server.ts`) — HMAC-SHA-256 signed session cookie
  (`gycc_admin`), `ADMIN_PASSWORD` + `COOKIE_SECRET` via `Config.redacted`; constant-time
  compare. `verifyPassword / checkCookie / cookieHeader / clearCookieHeader`.

### Content schema (`app/lib/content/schema.ts`, Effect Schema)

- `Text = Schema.Struct({ en: NonEmptyString, fr: NonEmptyString })` — bilingual.
- `ImageRef = { key: AssetKey, alt: Text }` (+ optional w/h). `AssetKey` validated:
  non-empty, no leading `/`, no scheme, no `..` (boundary-discipline).
- `SiteContent = { conferences: Conference[], team: TeamMember[], translations:
  Translations, meta }`. `Conference` carries the **theme name** (`Text`) AND the
  **accent colour** as two distinct fields (CONTEXT.md flags today's `theme:string`
  misnaming — fix it in the schema: `themeName: Text`, `accentColor: HexColour`).
- `registration` stays **optional** (2026 has none) — make-impossible-states-unrepresentable:
  model "windows not set" as `Option`, not empty tuples.
- Dates: store ISO-8601 strings in the doc (use-the-platform), convert to the existing
  `[start,end]` ms-tuple shape at the `Content` boundary so route/component code is
  unchanged.

### Defaults / seed (`app/lib/content/defaults.ts`)

The current `conference.server.ts` + `team.server.tsx` + `translations.ts` data, expressed
once as a `SiteContent.make({…})` literal. This is **both** the dev/fallback content and the
seed uploaded to a fresh bucket. The old typed-TS modules are then deleted and their callers
migrated to `Content` (migrate-callers-then-delete-legacy-apis, subtract-before-you-add).

### Read-path integration

Loaders that today call `getCurrentConference` / `getConferenceByYear` / `getTranslation`
become `routeHandler(function*(){ const content = yield* Content; … })` using the existing
Effect bridge (`app/lib/effect/route.ts`, `ReactRouterContext`, the request `runtime`).
The decoded shapes match what components already consume, so component code is untouched.

### Image serving

Server route (`server.ts`) `GET /images/*` → `Storage.get(key)` streamed with
`cache-control: public, max-age=300` (paulo-suzanne's `bucketResponse`). Falls back to 404.
`ImageRef.key` resolves to `/images/<key>` URLs in the rendered HTML.

### Env wiring

Add bucket vars to the `Env` service: **optional everywhere** (the CMS degrades to bundled
defaults without a bucket), `Config.redacted` for the secret key. `ADMIN_PASSWORD` /
`COOKIE_SECRET` likewise optional → admin disabled (returns 404/redirect) when unset, so dev
and the existing fail-fast (mail/mailchimp) are unaffected. Do NOT make the bucket required
in prod — a bucket-less prod still serves the seeded defaults.

---

## Decisions

- **D1 — Full vertical slice in one stacked PR.** Storage + schema + auth + `/admin` editor
  + read-path, sub-committed (each compiles + passes gate), Codex-counseled per commit.
- **D2 — CMS owns everything** (conference + team + translations), bilingual.
- **D3 — Runtime read + TTL cache, NO redeploy.** Publishing is instant; bucket-unreachable
  falls back to bundled typed-TS defaults. (Chosen over paulo-suzanne's build-time+redeploy
  because GYC SSRs every request.)
- **D4 — `Bun.S3Client`, not `@aws-sdk`.** Railway first-party **Buckets**, Bun-native
  client (use-the-platform).
- **D5 — Fix the `theme` misnaming** in the new schema (`themeName` + `accentColor`).

## Sub-commit sequence (one wave; each compiles + passes gate + Codex-counseled)

Order honours **subtract-before-you-add** (defaults/seed extracted before old modules
deleted) and **boundary-discipline** (schema + storage before the services that use them).

- **C1 — Storage service + Env bucket config.** `Storage` Context.Service over
  `Bun.S3Client`; `Env` gains optional bucket config; `layerTest` in-memory. Unit tests via
  `layerTest`. No callers yet. (Foundation; nothing else compiles without it.)
- **C2 — Content schema + defaults/seed.** `app/lib/content/schema.ts` (`SiteContent`,
  `Text`, `ImageRef`, `Conference`, …) + `defaults.ts` transcribing today's TS data into
  one `SiteContent.make({…})`. Round-trip test (encode→decode === defaults). No behavior
  change yet.
- **C3 — Content service + read-path migration.** `Content` service (decode + TTL cache +
  fallback + derived selectors). Migrate `_layout`, `_index`, `2024/2025/2026`, `team`,
  `about` loaders to read via `Content`. Delete `conference.server.ts` +
  `team.server.tsx`; route translations through `Content`. Site renders identically from
  bundled defaults with **no bucket**. (Verified: all routes 200 EN+FR, content matches.)
- **C4 — Auth service + `/admin` login.** `Auth` Context.Service (HMAC cookie); `/admin`
  layout guard + `/admin/login` + `/admin/logout`. Admin disabled (404) when
  `ADMIN_PASSWORD` unset. Auth unit tests (sign/verify, expiry, tamper).
- **C5 — `/admin` editor + publish + image upload + image serving.** Editor form over
  `SiteContent` sections; `save`/`publish` write the draft/published doc via `Storage`;
  image upload (`Bun.S3Client.write`); `GET /images/*` server route. Publish busts the
  `Content` cache (no redeploy). End-to-end: edit → publish → public read reflects it.

Deferred to follow-up branches (stacked on this): image resize/WebP/thumbnail pipeline;
normalized speaker entity; richer editor UX.

## Verification (prove-it-works — check the real thing, not proxies)

Gate per commit: `bun run typecheck && bun run lint && bun run build && bun test`.
Runtime per relevant commit:
- C1: storage unit tests green (in-memory layer round-trips).
- C3: boot dev (no bucket) → `/`, `/2026`, `/2024`, `/team`, `/about` all 200 EN+FR; rendered
  conference title/dates/speakers match the pre-migration baseline (diff against
  `revival/2026-speak`).
- C4: `/admin` redirects to login when unauthenticated; correct password sets cookie;
  wrong password rejected; tampered cookie rejected.
- C5: with a real/MinIO-or-mock bucket — edit a field in `/admin`, publish, reload public
  page, see the change without redeploy; upload an image, see it served at `/images/<key>`.
