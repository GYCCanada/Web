# CMS Sourcing Audit + Remediation — GYC Site Assets & Copy

> **STATUS: REMEDIATED by branch `cms/hardcode-remediation` (this PR).** Both
> confirmed violations below are now fixed: the home mission photo is a CMS image
> slot (`HomePage.mission.photo`, projected via `assetUrl`, section-skip render,
> `/admin` upload, seeded `main/people.png` default so there's no day-one visual
> change), and the six registration-form literals now route through `translate()`.
> Two read-boundary backfills were added so neither the new field nor the new
> translation keys vanish on an already-published `home.json` / `site.json`
> (mirroring `backfillListItemIds`). The sections below are the ORIGINAL audit
> (state of `main` @ c17478c) kept as the record of what was found and why — read
> "should move to CMS" as "moved to CMS by this PR."

_Audited 2026-06-19 against `main` @ c17478c; remediated on `cms/hardcode-remediation`._

## 1. Executive verdict

_(original audit verdict — now remediated)_

**At audit time: assets and copy were NOT yet fully CMS-sourced.** The site was ~95% on the runtime-read CMS path, but two route files carried confirmed hardcodes: the home page's "Mission" photo (`/main/people.png` + `alt="Mission"`) bypassed the CMS image path entirely, and the shared registration-form module rendered six English JSX string literals that bypassed the localization layer. Everything else was fully CMS-driven (or legitimately static chrome). **Both are fixed in this PR** — the two files below are now fully CMS-sourced.

| File | Status (audit → now) |
|------|--------|
| `app/routes/($lang)+/_index.tsx` | partially-cms → **fully-cms** (mission photo now `page.mission.photo`) |
| `app/routes/($lang)+/registration-form.tsx` | partially-cms → **fully-cms** (6 literals now `translate()`) |
| `app/routes/($lang)+/_layout.tsx` | fully-cms |
| `app/routes/($lang)+/about.tsx` | fully-cms |
| `app/routes/($lang)+/contact.tsx` | fully-cms |
| `app/routes/($lang)+/faq.tsx` | fully-cms |
| `app/routes/($lang)+/give.tsx` | fully-cms |
| `app/routes/($lang)+/volunteer.tsx` | fully-cms |
| `app/routes/($lang)+/team/_index.tsx` | fully-cms (gold standard) |
| `app/routes/($lang)+/conference-detail.tsx` | fully-cms |
| `app/routes/($lang)+/2024/_index.tsx` | fully-cms |
| `app/routes/($lang)+/2025/_index.tsx` | fully-cms |
| `app/routes/($lang)+/2026/_index.tsx` | fully-cms |
| `app/routes/($lang)+/archive+/_index.tsx` | fully-cms |
| `app/routes/($lang)+/archive+/2023.tsx` | static-snapshot (n/a) |

## 2. Confirmed hardcodes that should move to CMS

Ordered by severity. All line references re-verified.

### Home page — `app/routes/($lang)+/_index.tsx`

**[HIGH] Mission photo `src` is a build-time literal — `_index.tsx:118-122`**
```jsx
<img
  src="/main/people.png"
  alt="Mission"
  className="aspect-auto max-md:w-full md:flex-1"
/>
```
- **What:** A content-bearing photograph typed directly into JSX `src`. It never crosses the `AssetKey` brand, never hits `assetUrl(key) → /images/* → bucket-first-then-public` serve, and can never be overridden via `/admin` upload. Confirmed sole reference: `grep people.png` across `app/` and `public/` returns only `_index.tsx:119` (file lives only at `public/main/people.png`).
- **Root cause (verified):** `HomePage` schema (`schema.ts:266-283`) carries only `enabled` + Text fields (`tagline`, `mission.readStoryLabel`, `join.*`, `newsletter.*`) — **no `ImageRef`**. `toHomeView` (`project.ts:233-248`) projects only those text fields — **no `{src,alt}` slot**. `HomeView` interface (`project.ts:131-146`) has no image field. So `page` physically cannot carry this image.
- **Fix:** Add an optional image slot to `HomePage`, mirroring the Team gold standard exactly:
  - `schema.ts`: add `mission: Schema.Struct({ readStoryLabel: Text, photo: Schema.optionalKey(ImageRef) })` (extend the existing `mission` struct rather than adding a sibling — keeps the photo semantically grouped with its CTA).
  - `project.ts` `HomeView`: add `mission: { readStoryLabel: string; photo?: { src: string; alt: string } }`.
  - `project.ts` `toHomeView`: `photo: page.mission.photo ? { src: assetUrl(page.mission.photo.key), alt: page.mission.photo.alt[locale] } : undefined` (copy the `toTeamView` `groupPhoto` projection at `project.ts:257-258`).
  - `_index.tsx:118-122`: render `{page.mission.photo && <img src={page.mission.photo.src} alt={page.mission.photo.alt} className="…" />}` — section-skip on absent slot (gold-standard guard, `team/_index.tsx`).

**[MEDIUM] Mission photo `alt="Mission"` is an unlocalized literal — `_index.tsx:120`**
- **What:** The `alt` half of the same slot — fixed English, so `/fr` renders English alt text.
- **Fix:** Resolved by the same schema change above (`ImageRef.alt` is bilingual `Text`, projected per-locale via `alt[locale]`). This is one slot, one fix.

### Registration form — `app/routes/($lang)+/registration-form.tsx`

This is a shared presentational module (not a route). It has **zero image references** — these are all localization (`translate()`) bypasses, not CMS-projection-path violations. `useTranslate()` is in scope (`const translate = useTranslate()`, ~line 207) and drives ~50 sibling labels; these six are the lone literals. Translations are sourced from `content/site.json` via `content.getTranslations` (`_layout.tsx:35`), so they ARE on the CMS read path.

**[MEDIUM] Four section headings hardcoded as English JSX literals**

| Line | Literal | Existing key? | Fix |
|------|---------|---------------|-----|
| `registration-form.tsx:423` | `<h2>Meals</h2>` | **Yes** — `registration.form.meals.title` ('Meals'/'Repas', `translations.ts:169`/`:440`) but **unused** | `{translate('registration.form.meals.title')}` |
| `registration-form.tsx:457` | `<h2>Outreach</h2>` | No | Add `registration.form.outreach.title` (en `'Outreach'` / fr `'Rayonnement'`), then `translate(...)` |
| `registration-form.tsx:488` | `<h2>Extra Information</h2>` | No | Add `registration.form.extra.title` (en/fr), then `translate(...)` |
| `registration-form.tsx:625` | `<h2>Volunteer</h2>` | No | Add `registration.form.volunteer.title` (en/fr), then `translate(...)` |

**[MEDIUM] Two button labels hardcoded as English JSX literals**

| Line | Literal | Existing key? | Fix |
|------|---------|---------------|-----|
| `registration-form.tsx:743` | `Add Registrant` (inside `<Button>`) | No | Add `registration.form.add-registrant` (en/fr), then `translate(...)` |
| `registration-form.tsx:747` | `Submit` (inside `<Button type="submit">`) | **Yes** — `registration.form.submit` ('Submit'/'Soumettre', `translations.ts:258`/`:538`) but **unused** | `{translate('registration.form.submit')}` |

> French-locale regression is real and reproducible: `/fr` renders all six in English today.

## 3. Legitimately static (leave alone)

So a future reviewer doesn't re-flag these:

- **Decorative texture `/topography.svg`** — `_index.tsx:138,342`. `alt=""`, opacity-10 background texture. Not authored content; served from `public/`. Correctly NOT in any Page schema.
- **Brand logo `/logo/gycc-logo-small-red.png`** — `_layout.tsx:132,170` (TopNav + PopupNav). Site chrome, served from `public/`, contract-allowed.
- **Favicon, footer social URLs, `Français`/`English` toggle labels** — `_layout.tsx`. UI chrome with no Page-schema home; nav labels/buttons legitimately live in the Translations doc.
- **External destination URLs** — BibleGateway search + Facebook hotels group in `conference-detail.tsx:149,243`. External link targets, not image AssetKeys or page-body copy.
- **All `meta()` SEO title/description literals** — every route. React Router head chrome, explicitly out of scope; already locale-switch where relevant.
- **Conference year slugs (`2024`/`2025`/`2026`)** — passed to `getConference`. Conference identity, not content. These read `content/site.json` via `getConference`, NOT a `PageId` object, so `getEnabledPageOr404` correctly does not apply.
- **`archive+/2023.tsx`** — frozen hand-built archive snapshot (`schema.ts:242-247`); empty div, no content, no Content.Service read. Not a CMS-known page.
- **Form action mailer/notification copy** — server-side email bodies in `contact.tsx`/`volunteer.tsx` actions. Not rendered page content.

## 4. Remediation plan

Two independent tracks. Follow the **Feature A (Team route migration, commit `ca3320f`)** pattern as prior art for the image track. Each batch compiles + gates green (`tsc --noEmit` + lint + tests) before commit.

### Batch 1 — Home mission photo → CMS image slot (the HIGH violation)

Mirrors Feature A end-to-end. Because adding an image slot requires the upload-first / fill-alt-second draft flow, `home` must also migrate from the strict `pageSpec` to `draftPageSpec` (it currently has no draft variant — `registry.ts:193`, `schema.ts:340`).

1. **Schema** (`app/lib/content/pages/schema.ts`):
   - Extend `mission` struct on `HomePage` (`:269-271`) with `photo: Schema.optionalKey(ImageRef)`.
   - Add `DraftHomePage` (mirror `DraftTeamPage`, `:425-433`): strict text fields + `mission.photo` relaxed to the existing `DraftImageRef` (`:414-417`).
2. **Default seed** (`app/lib/content/pages/defaults.ts`): leave `defaultHomePage.mission` (`:368-370`) photo-less (`optionalKey` ⇒ section-skip), exactly as `defaultTeamPage` omits `groupPhoto`/`portrait` (`:403`). The `public/main/people.png` art stays as a transparent public-fallback if/when an admin uploads to the matching key — but no seed AssetKey is required.
3. **Registry** (`app/lib/content/pages/registry.ts:193`): `home: draftPageSpec(HomePage, DraftHomePage, defaultHomePage)`. Import `DraftHomePage`.
4. **Projection** (`app/lib/content/pages/project.ts`): extend `HomeView.mission` (`:134`) with optional `photo?: { src; alt }`; project it in `toHomeView` (`:236`) via `assetUrl(page.mission.photo.key)` (copy `toTeamView:257-258`).
5. **Route** (`app/routes/($lang)+/_index.tsx:118-122`): replace the literal `<img>` with the section-skip guard `{page.mission.photo && <img src={page.mission.photo.src} alt={page.mission.photo.alt} … />}`.
6. **Admin editor** (`app/routes/admin/pages.$page.tsx`): in the `case 'home':` branch (`:549`), add the `mission.photo` `<ImageUpload keyPath="mission.photo.key" … />` + `<Bilingual name="mission.photo.alt" … />` fieldset, copying the Team slot markup (`:620-647`).
7. **Keyless-override prune** (`app/lib/content/admin-form.ts:316-334`): the slot allowlist is hardcoded to `groupPhoto`/`portrait` (`:324`). Add `mission.photo` handling — the home photo is nested, so generalize the keyless-prune check to also cover the `mission.photo` path (a plain save posts `mission.photo.alt` with no key → must be pruned so the slot stays absent, identical to the Team rationale at `:296-314`). **This is the one place the Team pattern doesn't transfer 1:1** (Team slots are top-level; home's is nested under `mission`).
8. **Tests**: extend `cms-e2e.test.ts` (mirror the `groupPhoto` upload tests at `:620-762`) for `mission.photo.key` upload + keyless-prune + section-skip.

Gate. Commit: `feat(cms): model home mission photo as a CMS image slot (Feature A pattern)`.

### Batch 2 — Registration form section headings → Translations

1. **Add keys** (`app/lib/localization/translations.ts`, both EN block + FR block ~`:263`): `registration.form.outreach.title`, `registration.form.extra.title`, `registration.form.volunteer.title` (en + fr each). `meals.title` already exists.
2. **Route** (`registration-form.tsx`): replace the four `<h2>` literals (`:423,:457,:488,:625`) with `{translate('registration.form.<section>.title')}`.

Gate. Commit: `fix(i18n): localize registration-form section headings`.

### Batch 3 — Registration form button labels → Translations

1. **Add key** (`translations.ts`): `registration.form.add-registrant` (en + fr). `submit` already exists.
2. **Route** (`registration-form.tsx`): `:743` → `{translate('registration.form.add-registrant')}`; `:747` → `{translate('registration.form.submit')}`.

Gate. Commit: `fix(i18n): localize registration-form Add Registrant / Submit buttons`.

> Batches 2 and 3 are independent of Batch 1 and of each other; they can ship in any order or be combined into one i18n commit if preferred. Batch 1 is the only structurally non-trivial one (schema + draft + registry + projection + admin + prune + tests).

## 5. Open questions / ambiguities

1. **Home photo: keep `people.png` as-is, or re-seed under a managed key?** Batch 1 leaves the slot empty-by-default and relies on the `public/main/people.png` fallback only if an admin uploads to the matching key. Alternative: seed `defaultHomePage.mission.photo` with a `main/people.png` AssetKey so the current art renders through `assetUrl` immediately (note: the file is at `public/main/people.png`, and AssetKeys map 1:1 onto the `public/` tree minus the leading `/`, so the key would be `main/people.png`). **Decision needed:** empty-default + section-skip (matches Team's omitted `groupPhoto`) vs. seed-the-existing-art (no visual change on day one). The Team precedent favors empty-default, but home currently always shows the photo, so a seed avoids a visual regression. Recommend **seed the existing art** to preserve current behavior.

2. **French copy for the three new heading/button keys** — `outreach.title`, `extra.title`, `volunteer.title`, `add-registrant`. I can draft (`Rayonnement` / `Renseignements supplémentaires` / `Bénévolat` / `Ajouter un participant`), but these are user-facing French strings and may want a native-speaker review before publish. `meals.title`→`Repas` and `submit`→`Soumettre` already exist and are settled.

---

**Let me take more off your plate:**
- **Next actions I can do right now:** Implement Batch 1 end-to-end (schema + draft + registry + projection + route + admin + prune + e2e tests) following the verified Feature A pattern, gating green per step. / Ship Batches 2-3 as one i18n commit with my drafted French strings flagged `// TODO: native review`.
- **Automations I can set up:** A lint rule (oxlint-plugin or a grep-based CI check) that fails on raw JSX string literals inside `<h1>`/`<h2>`/`<Button>` in route files, and on literal `src="/…png|jpg"` outside the allowed-static list (`/logo`, `/topography.svg`, `/favicon`) — so this audit's two violation classes can't silently reappear.
- **Delegate to your team:** Draft for a French-fluent reviewer — _"Need FR copy review for 4 registration-form keys before publish: outreach.title, extra.title, volunteer.title, add-registrant. My proposals: Rayonnement / Renseignements supplémentaires / Bénévolat / Ajouter un participant."_