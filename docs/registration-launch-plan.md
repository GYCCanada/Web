# Registration Launch + CMS Expansion — Stacked-PR Plan

**Base branch:** `feature/registration-launch` (off `main`).
**Stack tool:** `stacked` — one branch per FEATURE; each branch holds multiple gate-green sub-commits.
**Per-sub-commit gate:** `bun run typecheck && bun run lint && bun run build && bun test` (`typecheck` = `react-router typegen && tsgo --noEmit`). Launch-critical branches additionally carry a **runtime proof** (boot `bun run dev`, hit the routes EN+FR).

## Stack order (feature granularity)

| # | Branch | Title | Realizes | Launch-critical (Friday) |
|---|--------|-------|----------|--------------------------|
| 1 | `reg-launch/draft-editor` | `refactor(cms): DraftEditor absorbs the inline admin write pipeline (scoped key-pairs)` | Cand. 3 | yes (foundation) |
| 2 | `reg-launch/list-edit` | `feat(cms): id-keyed list editing replaces index merge` | Cand. 4; ADR 0006 | yes |
| 3 | `reg-launch/conference-detail` | `feat(conference): one data-driven ConferenceDetail across 2024/2025/2026 + RegFox button` | Cand. 1; settled #4 | yes |
| 4 | `reg-launch/section-skip` | `feat(conference): data-driven section-skip at the Conference boundary` | Cand. 2; settled #3 | yes |
| 5 | `reg-launch/per-page-content` | `feat(cms): per-page + per-form typed content objects, multi-object read path` | Cand. 5; ADR 0008 | no |
| 6 | `reg-launch/form-engine` | `feat(forms): structural Form engine + equivalence-harness migration` | Cand. 6; ADR 0007 | no |
| 7 | `reg-launch/submissions` | `feat(forms): persisted Submission objects + decoupled record notification` | settled #8; CONTEXT §Submission |

**Friday ship line: after Branch 4.** RegFox carries 2026 registration (settled #9); branches 5–7 are CMS expansion, stacked but not launch-blocking. A reviewer can merge 1→2→3→4 and ship.

---

## Why DraftEditor is Branch 1 (resolves the list-edit-before-DraftEditor churn blocker)

Both adversarial reviews flagged a `migrate-callers-then-delete` violation: if list-edit ships first, its "Add item → auto-save draft" (settled #10) must call the inline ~165-line write pipeline in `admin/content.tsx`, which a later DraftEditor branch then deletes and rewrites — churning the same call site twice. **Resolution: extract DraftEditor FIRST.** Then list-edit (Branch 2) builds add/remove/reorder on the already-clean `DraftEditor` interface, and is never rewritten. This honors `subtract-before-you-add` (delete the duplication before building on it) and `migrate-callers-then-delete-legacy-apis` (one migration, no parallel pipeline).

DraftEditor is launch-critical-adjacent: it is the substrate the launch admin work (list-edit) stands on, so it ships in the launch window. It introduces no public-route change, so it carries no runtime-proof obligation beyond the admin e2e test.

---

## Branch 1 — `reg-launch/draft-editor` (Candidate 3)

**Why first:** the inline write pipeline is duplicated between the upload branch (`admin/content.tsx:138-210`) and the save/publish branch (`:219-289`) — both run encode→merge→decode→re-encode→store and read the draft twice; the bucket-key constants (`SITE_CONTENT_KEY`, `SITE_CONTENT_DRAFT_KEY`) leak to the route. Extracting this first means every later admin feature builds on the clean interface.

**Module shape — `DraftEditor` (new, `app/lib/content/draft-editor.server.ts`):**
- **Interface (smallest surface — the route keeps FormData→intent parsing; the module takes a parsed override, per codex's strength note):**
  - `editDocument(scope: ContentScope, override: Json): Effect<EncodedDoc, IssueError>` — the full encode→merge→decode→re-encode→store-draft pipeline as ONE call.
  - `applyImageUpload(scope: ContentScope, targetPath: string, key: AssetKey): Effect<EncodedDoc, IssueError>`.
  - `publish(scope: ContentScope): Effect<void, IssueError>` — promote draft → published, delete draft, bust cache.
  - `load(scope: ContentScope): Effect<AdminContent, IssueError>` — the draft/published reconciliation (moved from `Content.getAdminContent`).
- **`ContentScope` is introduced here as a closed, single-inhabitant type today** (`{ kind: 'site' }`), NOT a free string. This resolves claude→codex's "speculative scope" concern: the scope dimension is real (it carries the draft/published key PAIR + reconciliation), and Branch 5 *widens the union* (`| { kind: 'page'; page: PageId } | { kind: 'form'; form: FormId }`) rather than retrofitting a parameter. The interface is proven at introduction because `editDocument`/`publish`/`load` all route through `scopeKeys(scope): { draftKey, publishedKey }` — a real function with one case now, N cases later. `make-impossible-states-unrepresentable`: an editor cannot target a key that isn't a known scope.
- **Implementation absorbs:** the ~165 duplicated lines, the double draft-read, the `assembleOverrides`/`collectTranslations`/merge/`decodeDocument`/`encodeDocumentJson` choreography, the per-scope draft/published reconciliation (`load`, moved verbatim from `content.server.ts:484-515`, generalized over `scopeKeys`), and the bucket-key constants. The route action shrinks to "auth → parse intent → call `DraftEditor` → map result to `Response`".

**Read-path:** `Content.getAdminContent` is replaced by `DraftEditor.load({ kind: 'site' })`; `bust` is parameterized over scope (one cache today; per-scope cache map in Branch 5). The public `getSiteContent` read path is untouched.

**Subtract (what dies):**
- The duplicated ~165-line inline action body in `admin/content.tsx:138-289` → replaced by `DraftEditor` calls. **Deletion test passes: the inline lines genuinely vanish.**
- `Content.getAdminContent` (`content.server.ts:484-515`) → moves into `DraftEditor.load` (callers migrated, old method deleted).
- The leaked `SITE_CONTENT_KEY`/`SITE_CONTENT_DRAFT_KEY` imports in the route.

**Test surface:**
- `draft-editor.server.test.ts` — the extracted pipeline: edit→merge→decode→re-encode equivalence on an edit corpus (proves extraction is behavior-preserving against the old inline path); image-upload path; `load` reconciliation (draft-newer / draft-older / draft-no-published / defaults) ported from the current `getAdminContent` tests.
- `cms-e2e.test.ts` — save draft, publish, upload all pass through the one service; route action is auth + `DraftEditor` call only.

**Gate + runtime proof:** gate green per sub-commit. Boot dev → `/admin/content` → save a draft, reload (survives), publish (goes live), upload an image (lands at the key) — all through the new service, behavior identical to pre-branch.

**Sub-commits:**
- (1.1) `ContentScope` (single-inhabitant union) + `scopeKeys` + `DraftEditor.load` (reconciliation moved from `getAdminContent`) + tests.
- (1.2) `DraftEditor.editDocument` + `applyImageUpload` + `publish` + tests (route still calls them; behavior identical).
- (1.3) Migrate `admin/content.tsx` action to `DraftEditor`, delete the inline ~165-line pipeline + leaked constants.

---

## Branch 2 — `reg-launch/list-edit` (ADR 0006, Candidate 4)

**Why second:** every later branch adds list items (hotels, FAQ Q&A, give-directions, form fields). The id-keyed merge is the list-identity foundation. Built on Branch 1's `DraftEditor` (no churn).

**Module shape — `ListEdit` (new, `app/lib/content/list-edit.ts`):**
- **The ONE deep operation** (resolving claude→codex's "shallow surface" concern): `applyListEdit(base: Json, ops: ListOp[]): Json` — id-keyed merge + op application in one function. `ListOp = { add: { listPath, id } } | { remove: { listPath, id } } | { reorder: { listPath, ids } }`.
- **Private helpers** (not interface): `collectListOps(entries)` parses `list.<path>.op` control fields; `fieldName(listPath, id, leaf)` is a thin string template kept internal to the admin view. The plan names ONE deep capability; the op-constructors and name-template are sugar.
- **Implementation absorbs:** id matching, append-with-empty-defaults, drop-by-id, order-array application, structuralClone discipline. Arrays merge by matching `item.id` (a nanoid), NOT by position: an id absent from `base` is appended, an id in `base` but not `overrides` survives, the explicit order array reorders.

**Schema changes (`app/lib/content/schema.ts`):**
- Add `id: ListItemId` (a branded nanoid) to every list-item struct: `Speaker`, `Seminar`, `TeamMember`, and the soon-to-exist `Hotel`/FAQ/give items. `id` is **content** (ADR 0006: "ids are content, not derived — they must round-trip through the schema").
- New `ListItemId` brand earned at the boundary.

**Defaults migration (`app/lib/content/defaults.ts`) — resolves claude→codex's "defaults id-migration not guarded" hazard:**
- One-time assignment of stable nanoids to every existing default list item (speakers, seminars, team), inline in the `decodeUnknownSync`-constructed literal.
- **Production read-safety:** adding a *required* `id` makes every already-published `content/site.json` (which has no ids) FAIL decode on read. To prevent a deploy-time content break, the read path **backfills ids on decode**: `Content`'s document decode runs a pre-decode normalization that assigns a fresh nanoid to any id-less list item (a one-shot `derive-dont-sync` repair at the boundary, NOT a parallel schema). The first admin publish persists the backfilled ids; the normalization is idempotent (items that already have ids are untouched). This is recorded as a deliberate one-shot in ADR 0006's consequences. *(Without this, the launch deploy breaks on the live document — this is the single most important non-obvious hazard in Branch 2.)*

**Admin route (`admin/content.tsx`):** per-list "Add" / "Remove" / reorder controls submitting `intent=list-op`. "Add" appends an empty item with a fresh nanoid and **auto-saves the draft via `DraftEditor.editDocument`** (settled #10 + ADR 0006) so a later photo upload has a server-side target. The action parses ops via `collectListOps`, applies `applyListEdit`, then calls `DraftEditor.editDocument({ kind: 'site' }, merged)` — Branch 1's clean interface, no inline pipeline.

**Subtract (what dies):**
- `deepMerge`'s **array-by-index branch** (`admin-form.ts:221-229`) — replaced by `applyListEdit`'s id-keyed merge.
- `setPath`'s numeric-segment array handling for list indices (`admin-form.ts:144,170-174`) and `setAtPath`'s list-index assumption — the index assumption's homes named in candidate 4.
- The view's positional field-name templates in `admin/content.tsx` (`conferences.${ci}.speakers.${si}.name`, `team.${ti}.name`) → id-keyed (`speakers.${speaker.id}.name`).

**Test surface:**
- `list-edit.test.ts` — add/remove/reorder round-trips; id-keyed merge preserves unedited deep fields (the property `deepMerge` had); add-with-empty produces a draft-valid-but-publish-invalid item (empty required `Text` blocks publish, not save — ADR 0006 consequence).
- `admin-form.test.ts` extended for control-field parsing; `schema.test.ts` for `ListItemId`; the id-backfill normalization (id-less doc decodes; ids assigned; idempotent on re-decode).
- `cms-e2e.test.ts` — add a speaker, save draft, assert id persists; remove, assert gone.

**Gate + runtime proof:** boot dev → `/admin/content` → add a team member, upload a photo to the new id, save draft, reload, confirm the item + image survive (proves the auto-save-then-upload target chain). Confirm a pre-existing id-less document still loads (backfill proof).

**Sub-commits:**
- (2.1) `ListItemId` brand + `id` on list-item schemas + defaults migration + read-path id-backfill normalization + tests.
- (2.2) `ListEdit` module (`applyListEdit` + private helpers) + tests.
- (2.3) Admin add/remove/reorder UI + `list-op` action intent (calls `DraftEditor.editDocument`).
- (2.4) Delete index-merge branch / numeric `setPath` list-handling / positional field-name templates; migrate callers.

---

## Branch 3 — `reg-launch/conference-detail` (Candidate 1, settled #4)

**Why third:** the launch headline — bring the detail page back, standardize to 2024, hook into CMS, RegFox button.

**Module shape — `ConferenceDetail` (new, `app/routes/($lang)+/conference-detail.tsx`):**
- **Interface:** `<ConferenceDetail conference={conference} />` — one prop, the boundary `Conference`. All three year routes (`/2024`, `/2025`, `/2026`) render exactly this; the loaders become thin (`getConference(locale, year)` → pass through).
- **Implementation absorbs** every section duplicated across the THREE forked files: `Hero`/`MobileHero`/`DesktopHero`, `MapSection`, `SpeakersAndSeminars`, `SpeakerCard` (+ mobile/desktop variants, `useCardRotation`, framer-motion machinery), `RegistrationSection`, `FaqSection`.

**Resolves codex→claude BLOCKER (stale 2025 fork):** there are **THREE** ~620-line forked detail pages — `2024/_index.tsx` (617), `2025/_index.tsx` (622), `2026/_index.tsx` (622) — all confirmed present, all served, `/2025` required by `schema.ts` `REQUIRED_CONFERENCE_SLUGS`. This branch collapses **all three** into `ConferenceDetail` and reduces all three loaders to thin pass-throughs. Deleting only 2024/2026 would leave 2025 drifting on the old path (subtract-before-you-add half-done). Per CONTEXT §Hiatus, 2025 is the cancelled/archived year — it renders through the shared module with whatever data it carries (section-skip, Branch 4, drops its empty sections).

**Resolves codex→claude CONCERN (home route divergence):** `home/_index.tsx` renders the Current Conference via `selectCurrent` (`content.server.ts:247`). This branch audits the home route's conference rendering: any conference *section* reused on home (hero, registration CTA) must render through `ConferenceDetail`'s shared sections, not a fourth fork. If home renders only a hero teaser (not the full detail), that is explicitly noted and left as-is; if it duplicates detail sections, those route through the shared module. **No fourth divergence point survives this branch.**

**Schema changes (`schema.ts`) — Conference grows (settled #4), all section-skippable, all `Option`-modeled at the document layer:**
- `registrationUrl: Schema.OptionFromOptionalKey(ExternalHttpsUrl)`.
- `scheduleUrl: Schema.OptionFromOptionalKey(ExternalHttpsUrl)` — replaces the hard-coded Google Docs link.
- `mapEmbedUrl: Schema.OptionFromOptionalKey(GoogleMapsEmbedUrl)` — replaces the hard-coded iframe `src`.
- `hotels: Schema.Array(Hotel)` where `Hotel = Struct({ id: ListItemId, name: Text, note: Schema.optional(Text) })` (ids from Branch 2) — replaces the hard-coded `<li>` list.
- **Both reviews demand `Option` modeling (not bare `?`), resolved here:** `OptionFromOptionalKey` at the document layer is mandatory so an empty-string URL is not representable as "present" and Branch 4's skip has a real `Option.some`/`Option.none` discriminator (`make-impossible-states-unrepresentable`).
- **New validated external-URL brands — resolves the XSS blocker from BOTH reviews with `assetKeyFilter`-grade per-component rigor (NOT a substring/origin test):**
  - `ExternalHttpsUrl` = `Text.check(filter)` where filter parses the URL and requires `protocol === 'https:'` AND rejects embedded credentials (`username`/`password` empty) AND rejects `javascript:`/`data:`/`http:`.
  - `GoogleMapsEmbedUrl` = `ExternalHttpsUrl` + a filter that **parses** the URL and requires `protocol === 'https:'` AND `host === 'www.google.com'` AND `pathname.startsWith('/maps/embed')` AND no embedded credentials. **Explicitly NOT an `origin` check** (origin excludes the path, so it would admit `https://www.google.com/anything` — codex caught this). Modeled per-component on `assetKeyFilter` (`schema.ts:58-77`).

**Read-path (`content.server.ts`) — resolves both reviews' "preserve Option→string|undefined projection" concern:** `toConference` projects the new fields into the boundary `Conference` interface as `registrationUrl: string | undefined`, `scheduleUrl: string | undefined`, `mapEmbedUrl: string | undefined`, `hotels: {name, note?}[]` — via `Option.isSome` gating (the existing `registration` pattern at `content.server.ts:214`). **The document uses `OptionFromOptionalKey`; the boundary projects to `string | undefined` so React never sees `Option<string>`.** This is the convention for ALL new optional Conference fields. Boundary interface (`content.server.ts:98`) grows the same optional fields.

**Defaults:** 2024 gets `registrationUrl` (its real RegFox URL from `2024/_index.tsx`), `scheduleUrl`, `mapEmbedUrl`, `hotels` (the 5 hardcoded entries). 2026 gets **only** `registrationUrl` (the 2026 RegFox URL) — no map/hotels/speakers yet (sets up Branch 4's skip proof). 2025 gets nothing optional (cancelled year — proves full skip).

**Subtract (what dies):**
- `2024/_index.tsx`, `2025/_index.tsx`, `2026/_index.tsx` collapse to ~15-line loaders rendering `<ConferenceDetail>`. The ~600 lines of forked JSX in **each** of the three files are deleted (the candidate-1 deletion).
- The JSX comment block + dormant `// eslint-disable no-unused-vars` scaffolding in the forks.
- Hard-coded URLs, hard-coded hotel `<li>`s, hard-coded iframe — all become data.

**Test surface:** `conference-detail.test.tsx` (render-to-string) — a fully-populated conference renders all sections; the RegFox button uses `registrationUrl`; the map iframe uses `mapEmbedUrl`. `schema.test.ts` — `ExternalHttpsUrl` rejects `http:`/`javascript:`/`data:`/credentialed URLs; `GoogleMapsEmbedUrl` rejects non-`www.google.com` hosts AND `https://www.google.com/anything` (path check), accepts `/maps/embed/...`.

**Gate + runtime proof (launch-critical):** boot dev → `/2024`, `/fr/2024`, `/2025`, `/fr/2025`, `/2026`, `/fr/2026` all render the shared detail page; `/2026` shows the **RegFox register button**. Confirm the 2024 render matches the pre-branch fork (the forked file was the spec) **with one consciously-accepted exception**: the old fork's hotel #2 `<li>` carried a pre-existing typo — a literal `- ` separator and *mismatched* straight-then-curly quotes (`"GYC Canada” … “GYC"`). The migrated default (`defaults.ts`) cleans this to an em-dash separator with consistent straight quotes. This is the single intentional byte delta vs the fork; it is pinned by an exact-text regression assertion in `conference-detail.test.tsx` (the 2024 Fairfield-hotel render test) so the surface cannot drift silently. Every other 2024 section remains byte-identical.

**Sub-commits:**
- (3.1) URL brand types (per-component XSS filters) + `Hotel` + Conference schema growth (`OptionFromOptionalKey`) + defaults (2024/2025/2026).
- (3.2) Boundary interface growth + `toConference` `Option`→`string|undefined` projection + `content.server.test.ts`.
- (3.3) Extract `ConferenceDetail` from the 2024 fork (the spec) + `conference-detail.test.tsx`.
- (3.4) Point all three loaders at it, delete all three forked files; audit + reconcile home-route conference rendering.

---

## Branch 4 — `reg-launch/section-skip` (Candidate 2, settled #3)

**Why fourth / last launch-critical:** with the data plumbed (Branch 3) and the component shared, skip becomes a pure component concern gating on the `Option`-derived boundary data. This is what makes 2026 (RegFox only) and 2025 (cancelled) render cleanly.

**Module shape:** no new module — `ConferenceDetail` (Branch 3) gains the gating; `toConference` already emits the section-presence discriminators (`undefined`/`[]`).
- `SpeakersAndSeminars`: renders only when `conference.speakers.length > 0` (seminars likewise, independently).
- `MapSection`: `mapEmbedUrl !== undefined` and `hotels.length > 0` gated independently (each half).
- `RegistrationSection` / RegFox button: `registrationUrl !== undefined`.
- `scheduleUrl` button: present-only. `FaqSection`: always present (static links), unchanged.

**How skip is data-driven (settled #3, CONTEXT §Section skip):** the `Option`/empty-array crosses the boundary as `undefined`/`[]` (Branch 3's `toConference`). The component branches on that — **no JSX comments, no `eslint-disable` dormant scaffolding**. Section-level skip; items stay strict: a *present* hotel with an empty `name` is a hard `Text` decode error (the both-locales invariant is never relaxed — validation lives in the schema, not the component).

**Subtract:** any remaining `// 1. two column…` author-note comments and dormant-render paths folded into `ConferenceDetail`; the gating replaces them.

**Test surface:** `conference-detail.test.tsx` grows — empty `speakers` omits the speakers section; absent `mapEmbedUrl` + empty `hotels` omits `MapSection`; absent `registrationUrl` omits the register button; `/2025` (all empty) renders hero + FAQ only. A *present* hotel missing `name` fails decode (`schema.test.ts`) — proving skip ≠ tolerance for half-filled content.

**Gate + runtime proof (launch-critical — the Friday gate):** boot dev → `/2026` shows hero + RegFox button + FAQ and **no** empty Speakers/Map sections; `/2025` shows hero + FAQ only; `/2024` shows every section; EN+FR throughout.

**Sub-commits:**
- (4.1) Gate each section on the `Option`/empty-array boundary data.
- (4.2) Tests for every skip + the present-but-empty hard-error case.

> **Friday ship line: after Branch 4 the launch is done.** Branches 5–7 are CMS expansion, stacked but not launch-blocking.

---

## Branch 5 — `reg-launch/per-page-content` (Candidate 5, ADR 0008)

**Why fifth:** per-page + per-form typed schemas + the multi-object read-path refactor. High-blast-radius → sub-committed (per global instructions). Branches 6 and 7 depend on its multi-object read path (`getPage`/`getForm`) and the widened `ContentScope`.

**Resolves codex→claude BLOCKER (forms never CMS-backed) + completeness:** ADR 0008 settles `forms/<form>.json` as first-class storage objects alongside `content/pages/*.json`. **This branch builds BOTH `getPage` AND `getForm` multi-object read paths together** (parallel decode boundary + fallback-to-default + independent cache-bust), so Branch 6's form engine reads CMS-editable form copy, not a hypothetical. The `ContentScope` union (Branch 1) widens here to `{ kind: 'page'; page: PageId } | { kind: 'form'; form: FormId }`, so `DraftEditor` edits any page/form object through the same proven interface.

**Resolves claude→codex BLOCKER (per-object draft/publish reconciliation):** the single-object draft/published reconciliation (`content.server.ts:484-515`, now `DraftEditor.load` from Branch 1) generalizes over `scopeKeys(scope)` → `{ draftKey, publishedKey }`. Each page/form object gets its **own** `content/pages/<page>.draft.json` + `content/pages/<page>.json` pair (and `forms/<form>.draft.json` + `forms/<form>.json`), its own `head`-compare reconciliation, and its own cache-bust. The admin DraftEditor targets the right object's draft/published pair via its scope. **This was the gap that would have blocked the page publish flow — it is closed by widening Branch 1's already-scoped interface, not by retrofitting.**

**Schema changes — per-page typed schemas (ADR 0008, settled #5), `app/lib/content/pages/*.ts`:**
- **Resolves codex→claude BLOCKER (incomplete per-page scope): ALL SIX Pages + home evergreen are enumerated** (settled #1, CONTEXT §Page): `AboutPage`, `FaqPage`, `GivePage`, `ContactPage`, `VolunteerPage`, `ArchivePage`, **and the home page's evergreen (non-conference) sections** as a `HomePage` schema. Every flat-translation key deleted must have a typed home, or the god-bag retirement regresses.
  - `FaqPage = Struct({ items: Array(Struct({ id: ListItemId, question: Text, answer: RichText })) })` — Q&A with inline-link support.
  - `GivePage = Struct({ directions: Array(Struct({ id: ListItemId, text: Text })), donateUrl: ExternalHttpsUrl, reason: Text })`.
  - `ContactPage`/`VolunteerPage`: page copy (intro, banners) only — the FORM fields belong to the Form definition (Branch 6), not the Page. This keeps Page (copy) and Form (field graph) as distinct entities.
  - `ArchivePage`, `HomePage`: modeled to their real structure.
- Shared `RichText` primitive (closed token model: text + link + bold; NOT arbitrary HTML) so FAQ inline links round-trip — `make-impossible-states-unrepresentable`.

**Read-path refactor — single-doc → set-of-objects (ADR 0008, settled #7):**
- `content.server.ts`: `Content` gains `getPage(name): Effect<Page>` and `getForm(name): Effect<FormDefinition>`, each reading its object with its own decode boundary, fallback-to-bundled-default, independent cache-bust. A missing/empty object falls back to default or skips.
- Per-object cache (keyed cache map or per-object `cachedInvalidateWithTTL`) so editing About busts only About's cache, not the conference cache (ADR 0008 headline property). `bust(scope)` parameterized over scope.
- `content/site.json` keeps conference/team/translations + the required-conferences invariant (stays on `site.json` only).

**Subtract (the candidate-5 god-bag retirement):**
- The **352-key flat translation god-bag**: per-page copy migrates out of flat `translations` into the typed page objects. `faq.*`, `give.*`, `about.*`, `volunteer.*`, `contact.*`, `archive.*`, and home-evergreen keys deleted from `translations.ts` + the `defaults.ts` translation block. UI-chrome keys (nav, buttons, form labels) stay in `Translations`.
- Evergreen route files (`faq.tsx`, `give.tsx`, `about.tsx`, `contact.tsx`, `volunteer.tsx`, archive, home) stop encoding key cardinality (hard-coded `question.1/2/3`, `directions.1/2/3/4`) — they `.map` over the page's list. `faq.tsx`'s three hand-written `<QuestionLayout>` blocks → one `.map`.

**Admin route:** per-Page `/admin` sections (settled #5), each a `Section` driven by its schema, reusing Branch-2 `ListEdit` for FAQ items / give-directions, writing via `DraftEditor` with the page's scope.

**Test surface:**
- `pages/*.test.ts` — each schema round-trips; `RichText` token round-trip; present-but-empty hard-error.
- `content.server.test.ts` extended: `getPage`/`getForm` fallback-to-default; per-object cache-bust isolation (editing About doesn't bust conference); **one malformed page object can't break another's decode** (ADR 0008 headline blast-radius property); per-object draft/published reconciliation (draft-newer / draft-older / no-published).
- `cms-e2e.test.ts` — edit a FAQ item, publish, the page updates without busting the conference cache.

**Gate + runtime proof:** boot dev → `/faq`, `/give`, `/about`, `/contact`, `/volunteer`, archive, home render from page objects EN+FR identically to today; `/admin` edits a FAQ item, publishes, the page updates with no redeploy and without busting the conference cache; a hand-corrupted `content/pages/faq.json` falls back/skips only FAQ while About/Give still decode.

**Sub-commits (high-blast-radius → 5):**
- (5.1) `RichText` + all six Page schemas + `HomePage` + `FormDefinition` placeholder schema-type + per-page/per-form defaults.
- (5.2) `ContentScope` widened to page/form; `scopeKeys` gains page/form key-pairs; `DraftEditor.load`/`publish` reconciliation generalized per-object; tests (wiring proven before any route migrates).
- (5.3) `Content.getPage` + `getForm` multi-object read path (per-object cache + parameterized `bust`) + tests.
- (5.4) Migrate evergreen routes (incl. home) to `getPage`; delete the per-page flat translation keys.
- (5.5) Per-page `/admin` sections (via `DraftEditor` + `ListEdit`).

---

## Branch 6 — `reg-launch/form-engine` (Candidate 6, ADR 0007) — **RISKIEST**

**Why sixth, after launch:** RegFox carries Friday (settled #9), so this migration cannot block launch (settled #11). Highest payoff + highest risk. Reads form definitions through Branch 5's `getForm` (CMS-editable copy); the field *graph* is editable only within the closed kind-set.

**Module shape — Form engine (new, `app/lib/forms/`):**
- **`FormDefinition` schema (`forms/definition.ts`) — closed kind-set (ADR 0007, CONTEXT §Form definition):** discriminated union of ~8 `FieldKind`s — `requiredText`, `optionalText`, `email`, `url`, `literal` (radio), `checkboxBoolean`, `arrayOfLiteral`, `nestedGroup` — plus discriminated-union variant support + cross-field rules. A `FormDefinition` is data (`forms/<form>.json`), bilingual labels/placeholders. `make-impossible-states-unrepresentable`: cannot invent a field type outside the closed set.
- **Generic renderer (`forms/render.tsx`):** `<FormFields definition={def} />`. Absorbs the method-discriminator + cross-field-filter UI duplicated verbatim across contact/volunteer, and the `parse→send→toast` action skeleton triplicated across contact/volunteer/registration.
- **Generic decoder (`forms/decode.ts`):** `decodeForm(def, payload): Result<Decoded, Issue>` — reconstructs server-side Effect Schema validation from the definition, emitting real `TranslationKey` error sets (driven by the definition, not hand-written), reusing `parseSchema`/`formatSchemaResult`.
- **Generic action skeleton (`forms/action.ts`):** the `parseSubmission → decodeForm → send/persist → toast.redirect` pipeline parameterized by form name (replaces the triplicated `routeFormAction` bodies).

**Resolves the PHANTOM SERVER DECODE blocker (claude→codex + codex→claude, both correct):** `registration-schema.ts:9-15` documents the registration action as a deliberate no-op — the schema "is never run server-side"; it powers ONLY client-side `RegistrationStandardSchema` validation. The `2026/form/route.tsx` action is confirmed `yield* Effect.void` (verified). Contact/volunteer DO run server-side (`contact.tsx` `parseSchema`). **Consequences pinned into this plan:**
1. The equivalence harness for registration is **decode-equivalence over the StandardSchema decode** (client-validation parity) — there is no existing server decode to be equivalent to.
2. The harness MUST additionally assert **render-level parity**: the generic renderer emits identical field names + default values + conform client behavior vs `registration-form.tsx` — because that render+client-validate path is the *only* thing registration exercises in prod. A decode-only harness under-pins the riskiest migration (codex caught this).
3. Wiring a registration *server* action + persistence is **net-new work, explicitly deferred to Branch 7** (settled #9: on-site path is built/proven but not load-bearing). Branch 6 migrates registration's client validation + render to the engine; it does NOT claim a pre-existing server path.

**The equivalence harness (ADR 0007, settled #6) — how the riskiest commit stays behavior-preserving:**
- **Spec doc** `docs/forms/registration-spec.md` authored alongside, enumerating every field, kind, cross-field rule, and the exact `TranslationKey` each failure path emits (transcribed from `registration-schema.ts`'s ~10 cross-field validators, the `StringToBoolean` three-token codec at `:50-59`, and the attendee/exhibitor discriminator).
- **The old hand-tuned schemas are KEPT as oracles** (renamed `registration-schema.oracle.ts`, and contact/volunteer schemas kept in-tree) while the engine is built — a clean subtract signal (claude's strength).
- **`forms/equivalence.test.ts`** feeds a **full failure-matrix payload corpus** — NOT the thin existing corpus (both reviews caught this): valid submissions + **every invalid variant** (missing each required field, off-list literal, bad email, bad url, each of the ~10 cross-field rules violated independently, the attendee-vs-exhibitor discriminator branches, the `true`/`false`/`on` checkbox-boolean tokens, the volunteer optional-flag absent/on/true/false) — through **both** oracle and engine, asserting **(a) identical decoded output**, **(b) identical emitted `TranslationKey` sets** (same paths via conform's `formatPath`, same keys), AND **(c) render-level field-name + default-value parity** for registration. ADR 0007 demands "valid + every invalid variant" — the harness enumerates the matrix.
- **The oracle is deleted only once the harness is green** (ADR 0007). Contact/volunteer migrate FIRST (simpler, same harness), de-risking the engine before registration.

**Resolves codex→claude (registration route wrappers omitted) — migrate-callers-then-delete:** ALL FOUR registration callers are enumerated migration targets — `registration-form.tsx`, `2024/form/route.tsx`, `2025/form/route.tsx`, `2026/form/route.tsx` — every consumer of the old schema migrates before `registration-schema.ts` is deleted.

**Schema changes:** `FormDefinition` schema; `forms/<form>.json` definition objects for contact, volunteer, registration, read via Branch-5 `Content.getForm` (CMS-editable copy — ADR 0007 consequence).

**Subtract (only after the harness is green):**
- `registration-schema.oracle.ts` (the renamed ~350-line oracle) — deleted.
- The hand-written `schema`/`clientSchema`/`Method`/cross-field-filter blocks in `contact.tsx` and `volunteer.tsx` — deleted.
- The triplicated `routeFormAction` bodies → the generic skeleton.
- `registration-schema.test.ts` → replaced by the equivalence harness, then engine-level tests once the oracle is removed.

**Test surface:** the equivalence harness (oracle + full failure matrix + render parity); `forms/definition.test.ts` (closed-kind-set round-trips, impossible-field-kind unrepresentable); `forms/decode.test.ts` (each kind decodes, cross-field rules fire at the right path with the right key); `forms/render.test.tsx` (each kind renders, discriminator switches conditional fields).

**Gate + runtime proof:** gate green + **the equivalence harness green** is the hard gate for the registration sub-commit. Boot dev → `/contact`, `/volunteer` submit valid + invalid payloads, error keys render identically to today; `/2024/form`, `/2025/form`, `/2026/form` render the registration form from its definition, client validation matches old behavior on the corpus.

**Sub-commits:**
- (6.1) `FormDefinition` schema + closed kind-set + tests.
- (6.2) Generic decoder + renderer + action skeleton + tests.
- (6.3) Migrate **contact** to the engine; harness green for contact.
- (6.4) Migrate **volunteer**; harness green for volunteer.
- (6.5) Author `registration-spec.md` + rename old schema → `registration-schema.oracle.ts` + build registration definition; **full-matrix + render-parity equivalence harness green**; migrate all four registration callers.
- (6.6) Delete the three old schemas + oracle once the harness is green.

---

## Branch 7 — `reg-launch/submissions` (CONTEXT §Submission, settled #8)

**Why last:** the persisted-record pipeline consumes Branch 6's generic decoder (the decoded value is what's persisted) and Branch 5's multi-object Storage discipline. Seeds the future first-party registrar (non-goal to build the registrar; build the seed). This is also where registration's net-new *server* action lands (the phantom-decode consequence): registration gains a real server persist step here (still not the live channel — RegFox is — but the on-site path becomes provable end-to-end).

**Module shape — resolves both reviews' "persist must be separable from notify" concern by SPLITTING into two interfaces:**
- **`Submissions` (new, `app/lib/forms/submissions.server.ts`):** `persist(form: string, decoded: Json): Effect<Submission>` — encodes the `Submission`, `Storage.put`s `submissions/<form>/<id>.json` (id = nanoid), returns the stored record. **One call, persistence ONLY — no mailer.**
- **A separate notifier/orchestrator step** in the form action skeleton: `persist` then `notify(submission)`. The bucket write is the durable source of truth; the email is a notification OF the stored record (settled #8, CONTEXT §Submission:48). **Persist first, notify second; a notify failure provably cannot lose the record** — tested through the two separate interfaces (a mailer failure still leaves `submissions/<form>/<id>.json`). Keeping `persist` strict (returns the stored `Submission`) separate from `notify` is what makes that property provable.

**Schema changes:** `Submission` schema (`forms/submission.ts`) = `Struct({ id: ListItemId, form: Literal, submittedAt: IsoDate, payload })`. Per-form `payload` typing **derived from the `FormDefinition`** (derive-dont-sync — the submission shape is the decoded form type, not re-declared).

**Read/write-path:** the generic action skeleton (Branch 6) gains `persist` then `notify` before `toast.redirect`. The mailer call changes from "email IS the payload" to "email references the persisted record id".

**Subtract:** the inline `mailer.send({ subject, content: <hand-built string> })` bodies in the form actions — replaced by the persist-then-notify skeleton (largely gone after Branch 6's skeleton; Branch 7 swaps the terminal step).

**Test surface:** `submissions.test.ts` — `persist` writes the object, returns the id, round-trips the decoded payload; **persist-first-notify-second ordering** (a mailer failure still leaves the record); the registration `Submission` shape matches the decoded `FormDefinition` type (the future registrar's read contract).

**Gate + runtime proof:** boot dev with an in-memory `Storage` test layer → submit contact/volunteer/registration, assert `submissions/<form>/<id>.json` exists with the decoded payload; mailer no-op in dev confirms the email is decoupled from the record; RegFox remains the 2026 live channel (the on-site registration persist is proven but not the live path).

**Sub-commits:**
- (7.1) `Submission` schema (payload derived from `FormDefinition`).
- (7.2) `Submissions.persist` service (persist-only) + tests.
- (7.3) Wire persist-then-notify into the form action skeleton; migrate contact/volunteer/registration (registration's net-new server persist lands here).

---

## Riskiest commit + how the harness pins it

**Riskiest: Branch 6, sub-commit 6.5 — the registration migration.** `registration-schema.ts` is a 2-way discriminated union (attendee/exhibitor) with ~10 cross-field validators, a `StringToBoolean` three-token codec (`true`/`false`/`on`), and every error path must emit a real `TranslationKey` (a wrong/absent key renders blank — silent failure). It is **client-only today** (verified no-op action), so the harness pins it three ways: **(a)** identical decoded output, **(b)** identical emitted `TranslationKey` sets, **(c)** render-level field-name + default-value parity vs `registration-form.tsx` (the only path registration actually exercises in prod). The old schema stays as `registration-schema.oracle.ts`; the oracle is deleted only after (6.6). Contact/volunteer migrate first on the same harness, de-risking the engine before registration.

## Ordering hazards (summary)

1. **Branch 1 (DraftEditor) before Branch 2 (list-edit):** list-edit's auto-save must call a clean write pipeline — extract DraftEditor first or list-edit's action is churned twice (review blocker resolved).
2. **Branch 2 before all list-bearing branches:** every later branch adds list items needing `ListItemId` + `ListEdit`. The read-path id-backfill prevents the live document breaking on deploy.
3. **Branch 3 before Branch 4:** skip (4) gates on the `Option`→`string|undefined` boundary data `toConference` (3) emits. The three forks (incl. 2025) collapse in 3.
4. **Branch 5 before Branches 6 and 7:** the multi-object `getPage`/`getForm` read path + per-object draft/publish reconciliation + widened `ContentScope` are defined in 5; 6 reads form definitions through `getForm`, 7 follows the Storage discipline.
5. **Branch 6 before Branch 7:** the persisted `Submission` payload is the decoded value the generic decoder (6) produces; the payload type is derived from `FormDefinition` (6), not re-declared.

## Receipts (files cited)

- `app/lib/content/schema.ts` (Text, `assetKeyFilter` precedent, Conference struct, `REQUIRED_CONFERENCE_SLUGS` incl. `/2025`) — schema growth + URL brands + per-item ids land here.
- `app/lib/content.server.ts:98-281` (boundary `Conference` interface, `toConference` `Option.isSome` gating at :214, `selectByYear`/`selectCurrent`), `:287-552` (Service, `SITE_CONTENT_KEY`/`SITE_CONTENT_DRAFT_KEY`, `getAdminContent` reconciliation :484-515, `bust`, `defaultLayer`) — multi-object read path + scoped reconciliation.
- `app/lib/content/admin-form.ts:144-238` (`setPath`/`isIndex`, `deepMerge` array-by-index branch :221-229, `setAtPath`) — the index assumption ListEdit retires.
- `app/routes/admin/content.tsx:138-289` (the duplicated ~165-line action) — what `DraftEditor` absorbs.
- `app/routes/($lang)+/2024/_index.tsx` (617), `2025/_index.tsx` (622), `2026/_index.tsx` (622) — the THREE forked detail pages, collapsed into `ConferenceDetail`, deleted.
- `app/routes/($lang)+/2026/form/route.tsx:40-43` (verified `action = routeAction(() => Effect.void)` — registration server decode does NOT exist), `2024/form/route.tsx`, `2025/form/route.tsx`, `registration-form.tsx` — the four registration callers.
- `app/routes/($lang)+/registration-schema.ts:9-15` (client-only docstring), `:50-59` (`StringToBoolean` three-token codec), the ~10 cross-field validators + discriminator — the oracle for the harness.
- `app/routes/($lang)+/contact.tsx`, `volunteer.tsx` (server-side `parseSchema`, duplicated discriminator + cross-field filter + triplicated action skeleton) — what the form engine deduplicates.
- `app/routes/($lang)+/{faq,give,about,contact,volunteer}.tsx`, archive, home `_index.tsx` (`selectCurrent`) — evergreen pages whose hard-coded key-cardinality the per-page schemas retire; home conference-rendering audit target.
- ADRs `docs/adr/0006`, `0007`, `0008` — realized by branches 2, 6, 5 respectively.