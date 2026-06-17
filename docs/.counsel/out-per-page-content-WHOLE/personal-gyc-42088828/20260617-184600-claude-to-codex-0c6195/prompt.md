# Deep adversarial review — WHOLE PR `reg-launch/per-page-content` (Branch 5)

You are doing a **holistic, adversarial** review of an entire feature PR assembled from its
five sub-commits, NOT a single commit. The PR is one branch in a stacked-PR program. Be
skeptical. Your job is to find what the plan demanded that the PR did **not** deliver, what
it left half-migrated, and where it can break in production — then say whether it ships.

## What to assess (in priority order)

1. **Does the assembled PR fully realize its plan section?** Interface depth, ALL deletions
   actually made, complete test surface, no behavior regression, principles upheld.
2. **Does it cohere across its five sub-commits?** No half-migrated caller, no dead code left
   between slices, no parallel API that a later slice was supposed to delete.
3. **Scrutinize the riskiest parts hardest.** This branch BUILDS ON three earlier high-risk
   mechanisms from lower branches in the stack — re-verify they are not silently broken by
   this branch's changes:
   - **B2 id-backfill** (`app/lib/content/id-backfill.ts`): the read path backfills nanoids
     for id-less list items before the required `id` is checked, so a `content/site.json`
     published before ids existed still decodes. Does the new multi-object read path
     (`getPage`/`getForm`) correctly NOT apply backfill to the brand-new page/form objects
     (they have no legacy id-less documents), while the site path STILL does? Is that an
     honest decision or a latent bug?
   - **B3 Option→string|undefined** (`content.server.ts` `toConference`): the Conference
     boundary projects document `Option` fields to `string | undefined`. Did this branch
     disturb that projection? (It should be untouched — confirm.)
   - **B6 equivalence harness**: Branch 6 (the form engine) is NOT in this PR. But this PR
     lands a PLACEHOLDER `FormDefinition` schema + `getForm` read path that Branch 6 will
     build on. Is the placeholder an honest minimum (title + optional intro) that Branch 6
     GROWS rather than replaces, or does it bake in a shape that will force a rewrite (a
     `migrate-callers-then-delete` violation deferred)?

## Riskiest parts SPECIFIC to THIS branch — scrutinize hardest

- **Per-object draft/published reconciliation generalization** (`draft-editor.server.ts`):
  Branch 1's single-object `DraftEditor.load` (draft-newer/draft-older/no-published, by
  bucket `lastModified`) was generalized over `resolveScope(scope) → ScopeCodec`. Verify the
  reconciliation algorithm did NOT fork per scope — that site/page/form all route the same
  `load`/`editDocument`/`publish`/`applyListOps`/`applyImageUpload` through one codec bundle.
  Check `publish` does NOT re-route through `load` (the same-second-`lastModified` hazard the
  comments call out) for the new page/form scopes too.
- **Per-object cache isolation** (ADR 0008 headline property): `content.server.ts` builds one
  `Effect.cachedInvalidateWithTTL` per page + per form, eagerly. `bust(BustTarget)` dispatches
  over a closed `{site|page|form}` union. Verify editing About truly busts ONLY About's cache,
  not the conference (`site`) cache, and that **one malformed page object cannot break another
  page's decode** (each `makeObjectCache` catches its own failure → falls back to its bundled
  default). Is the fallback-on-every-failure-mode genuinely per-object, or is there a shared
  decode that one bad object poisons?
- **`BustTarget` vs `ContentScope` duplication**: `content.server.ts` defines its OWN
  `BustTarget` union ({site|page|form}) rather than importing `DraftEditor`'s `ContentScope`,
  with `DraftEditor.bustTargetOf(scope)` mapping one to the other. Is this a justified
  import-cycle break + read-path-needs-only-the-published-half argument, or is it two parallel
  closed unions that will drift (`derive-dont-sync` / `make-impossible-states-unrepresentable`
  concern)? Decide which.
- **Draft vs publish schema split for pages** (`pages/schema.ts` + `registry.ts`): list-bearing
  pages (about/faq/give/archive) get a LAXER `Draft*Page` schema (content text → optionalKey)
  so an id-only added item is draft-valid but publish-invalid; non-list pages (contact/volunteer/
  home) wire `draftSchema === schema`. Is this split correct and complete? Does every page that
  has an "Add item" flow in the admin route (`pages.$page.tsx`) have a draft variant, and does
  every page WITHOUT one correctly coincide draft===publish? Is there any page where the draft
  schema is laxer than it should be (admitting a malformed-not-just-absent value)?
- **God-bag retirement completeness** (Branch 5.4): `translations.ts` lost ~189 lines of
  per-page copy keys (`faq.*`, `give.*`, `about.*`, `volunteer.*`, `contact.*`, `archive.*`,
  home-evergreen). Verify: (a) every deleted key has a typed home in a Page schema + default
  (`pages/defaults.ts`), so NO copy was lost; (b) UI-chrome/form-label keys (`contact.form.*`,
  `volunteer.form.*`, nav, buttons) correctly STAYED in `Translations`; (c) no route still
  calls `translate('faq.question.1.title')` for deleted keys (would render blank). The routes
  `_index.tsx`, `about.tsx`, `faq.tsx`, `give.tsx`, `contact.tsx`, `volunteer.tsx` were
  migrated to `getPage` + the `to*View` projectors in `pages/project.ts`. Did the migration
  preserve the rendered HTML (e.g. FAQ's three hand-written `<QuestionLayout>` blocks → one
  `.map`; the `{{before}}`/`{{email}}` interpolations → `RichText` tokens)? Is there a
  behavior regression in any migrated route?
- **`RichText` closed-token model** (`pages/schema.ts` + `app/ui/rich-text.tsx`): a closed
  `text|bold|italic|link` token union, NO arbitrary HTML; `link` href is a validated
  `ExternalHttpsUrl | MailtoHref`. Verify a hand-edited page object can NEVER smuggle markup
  into the DOM, and the `mailtoFilter`/`ExternalHttpsUrl` boundary is genuinely XSS-safe
  (parse-and-inspect, not substring). Does the renderer (`rich-text.tsx`) ever
  `dangerouslySetInnerHTML`? (It must not.)

## How to do the review

Read the FULL plan and the branch's plan section (below), then read the WHOLE-PR diff and the
files it touches in the working tree (the branch is checked out at the diff's `to` side). The
diff base is the prior stack branch `section-skip` (this is NOT the bottom branch, so the diff
is `section-skip...per-page-content`, capturing ONLY this branch's five commits).

- **Full synthesized plan:** `docs/registration-launch-plan.md` (read the whole file; the stack
  order, ordering hazards, and receipts matter).
- **Branch plan section:** reproduced verbatim below ("Branch 5 — `reg-launch/per-page-content`").
- **WHOLE-PR diff:** `docs/.counsel/per-page-content-WHOLE.diff` (255 KB, 6106 lines, the five
  commits assembled).
- **Settled decisions (do NOT re-litigate):** `docs/registration-launch-brief.md` §"Settled
  decisions" + §"Non-goals". In particular: Conference is NOT a Page; form field-kinds are a
  closed set (Branch 6, not here — the placeholder is intentional); RegFox is the Friday channel
  (this branch is NOT launch-blocking); no relational DB (JSON objects in the bucket).
- **ADRs:** `docs/adr/0008-per-page-storage-objects.md` (this branch realizes it),
  `0006-stable-list-item-ids.md` (id-backfill, draft-vs-publish split),
  `0007-structural-form-builder.md` (Branch 6 — the placeholder sets up for it).

The gate is GREEN as assembled: `bun run typecheck && bun run lint && bun run build && bun test`
all pass (332 tests, 0 fail). So do not report "the build is broken" — look for **correctness /
completeness / cohesion / principle** gaps the gate cannot catch.

## Output format

Return a verdict plus two lists:
- **blocking** — MUST-fix before this PR ships: plan deviation, principle violation, incomplete
  deletion, broken/missing gate, untested boundary, behavior regression, half-migrated caller,
  dead code between slices. Cite the exact file:line. If there are none, say so explicitly.
- **concerns** — non-blocking: smells, naming, follow-ups, things to watch in Branch 6/7.

Be specific and cite receipts (file:line). If you claim a deletion is incomplete or a caller is
half-migrated, name the surviving call site. If you claim a test is missing, name the boundary
it should cover.

---

## Branch plan section (verbatim from `docs/registration-launch-plan.md`)

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
