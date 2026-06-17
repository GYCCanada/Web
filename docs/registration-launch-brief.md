# Registration Launch + CMS Expansion — Workflow Brief

**Branch base:** `feature/registration-launch` (off `main`). Implementation lands as a
**`stacked` PR stack** off this branch, **at FEATURE granularity** — one branch/PR per feature
(a coherent reviewable unit, roughly one per deepening candidate / ADR), NOT one per commit.
Each feature branch holds multiple internal sub-commits, each gate-green.

This brief is the single source of truth for the planify workflow. Every planning,
review, and implementation agent reads it. It encodes decisions already settled with the
user (do NOT re-litigate them) and points at the grounding (CONTEXT.md glossary, ADRs
0006–0008, the architecture review's six deepening candidates).

Agents decide autonomously against `~/.brain/principles/` — read the principle, apply it,
don't ask. Especially: `small-interface-deep-implementation`, `redesign-from-first-principles`,
`correctness-over-pragmatism`, `make-impossible-states-unrepresentable`, `boundary-discipline`,
`subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis`, `derive-dont-sync`,
`prove-it-works`, `never-block-on-the-human`.

---

## The product ask (verbatim intent)

Full registration launch by end of week. Bring the conference detail page back; standardize
it to match 2024; hook it into the CMS. Add list (add/remove) support to the CMS. Give each
evergreen page its own CMS schema. Skip sections that have no data. Make the forms part of
the CMS too.

## Settled decisions (DO NOT re-open)

1. **`Page` = evergreen content only** (about, faq, give, contact, volunteer, archive, home's
   evergreen sections). Conference stays a separate entity rendered into `/YYYY` + home. (CONTEXT §Page)
2. **List identity = stable nanoid ids** on every list item; index-aligned `deepMerge` is
   REPLACED by id-keyed merge. Add = new id, remove = drop id, reorder = order array. Defaults
   migrated once to assign ids. (ADR 0006)
3. **Section skip = section-level, items stay strict.** Empty list / absent optional block →
   skipped silently. A present item with a blank required bilingual field → hard validation
   error. `Text` both-locales invariant never relaxed. (CONTEXT §Section skip)
4. **"Standardize detail page" = one shared data-driven `ConferenceDetail`** both `/2024` and
   `/2026` render; forked JSX deleted. Conference schema grows: `registrationUrl?`,
   `scheduleUrl?`, `mapEmbedUrl?` (validated EXTERNAL-URL types — https-only; map constrained
   to a Google Maps embed origin to prevent arbitrary-iframe XSS), `hotels: {name, note?}[]`.
   All optional/empty-able → all section-skippable.
5. **Per-page CMS = heterogeneous, one typed schema per Page** (`AboutPage`, `FaqPage`,
   `GivePage`, …), each modeling its real structure (FAQ = Q&A list w/ inline links; Give =
   directions list + donate URL). Per-page `/admin` sections. (ADR 0008)
6. **Form-builder = full structural, all 3 forms (incl. registration), closed set of ~8 field
   kinds + discriminated-union + cross-field rules.** Spec doc + tests authored alongside,
   PLUS an old-vs-new **equivalence harness** (oracle over a payload corpus: identical decoded
   output + identical TranslationKey error sets; deleted once registration migration proven). (ADR 0007)
7. **Storage = per-page content objects + per-form objects, shared Effect Schema types.**
   `content/site.json` (conference/team/translations), `content/pages/*.json`, `forms/*.json`,
   `submissions/<form>/<id>.json`. `Content` read path refactors to read a SET of objects, each
   own decode boundary + fallback + independent cache-bust. (ADR 0008)
8. **Submission = persisted bucket object** (`submissions/<form>/<id>.json`) + email
   notification OF the record. Seeds a future first-party registrar. (CONTEXT §Submission)
9. **2026 registration channel = RegFox** (`registrationUrl` button). The on-site form-builder
   + submission pipeline is built and proven but NOT load-bearing for Friday — RegFox carries
   the launch; the on-site path is staged for a possible first-party registrar. (CONTEXT §Registration channel)
10. **Add item = appends with generated id + empty fields + auto-saves draft**, so uploads/edits
    have a server-side target.
11. **Sequencing = launch-critical first, stacked after.** Launch-critical (shrunk by #9):
    list UI → data-driven detail page + RegFox button. Then per-page expansion, form-builder +
    migrations + equivalence harness, submission pipeline.

## Architecture review — six deepening candidates (the module shapes that realize the above)

(Full report was generated to a temp HTML file; this is the durable summary. Use LANGUAGE.md
vocabulary: module, interface, implementation, depth, deep/shallow, seam, adapter, leverage,
locality. Deletion test on anything suspected shallow.)

1. **Collapse forked `/2024`+`/2026` into one deep `ConferenceDetail`** (~1200 lines → 1 module
   + 2 thin loaders). Today the only difference is a JSX comment block in 2026. [Strong]
2. **Section-skip data-driven inside the `Conference` boundary** — `toConference` emits
   `registrationUrl: Option`, `mapEmbed: Option`, `hotels: []`; the component gates each section
   on data. Skip leaves JSX comments, enters one converter. [Strong] — foundation for #1.
3. **A `DraftEditor` deep module** absorbs the inline admin write pipeline (encode→merge→decode→
   re-encode→store) currently ~165 inline lines in `admin/content.tsx` action, duplicated
   between the upload and save branches, reading the draft twice; the bucket key constants stop
   leaking to the route. [Strong] — the one new module not yet in an ADR.
4. **One id-keyed `ListEdit` module** kills the index assumption's four homes (view field-name
   templates, `setPath`, `deepMerge`, `setAtPath`). [Strong] — realizes ADR 0006.
5. **Per-Page typed content** retires the 352-key flat translation god-bag; `getPage('about')`
   returns a typed record; routes stop encoding key cardinality. [Strong] — realizes ADR 0008.
6. **Shared form engine** — the method discriminator + cross-field filter is duplicated verbatim
   across contact/volunteer; the parse→send→toast action skeleton is triplicated. [Worth
   exploring] — realizes ADR 0007; highest payoff + highest risk (registration is the launch
   form); harness-pinned; sequence AFTER launch-critical.

## Key files (grounding — cite these in plans)

- `app/lib/content/schema.ts` — the `SiteContent` Effect Schema (Conference, Speaker, Team,
  Translations, AssetKey/HexColour/IsoDate brands, REQUIRED_CONFERENCE_SLUGS invariant).
- `app/lib/content.server.ts` — `Content` service: readDocument, fetchDocument, TTL cache,
  toConference/toSpeaker/toTeamMember boundary converters, selectCurrent/selectByYear,
  getAdminContent draft/publish reconciliation.
- `app/lib/content/admin-form.ts` — assembleOverrides, deepMerge (INDEX-ALIGNED), setPath,
  setAtPath, collectTranslations, image-upload helpers.
- `app/routes/admin/content.tsx` — the `/admin` editor route (loader + ~165-line action + view).
- `app/routes/($lang)+/2024/_index.tsx`, `…/2026/_index.tsx` — the FORKED detail pages.
- `app/routes/($lang)+/team/_index.tsx` — the list example the user named.
- `app/routes/($lang)+/{about,faq,give,contact,volunteer}.tsx` — evergreen pages.
- `app/routes/($lang)+/registration-schema.ts` (~350 lines) + `contact.tsx`/`volunteer.tsx`
  schemas+actions — the three hand-tuned forms.
- `app/lib/storage.server.ts` — Storage service (get/put/head/list/delete).
- `docs/cms-plan.md` — the original CMS plan (C1–C5); 0008 supersedes its one-document model.
- `docs/adr/0006|0007|0008-*.md` — the three decisions; realize, don't re-litigate.

## Reference repos (read for Effect v4 / architecture patterns)

- `effect-ts/effect-smol` (Effect v4 source) — cached at `~/.cache/repo/effect-ts/effect-smol`.
- `anomalyco/opencode` — Effect architecture patterns (module-level `export const layer`,
  `Context.Service`, layer composition) — cached at `~/.cache/repo/anomalyco/opencode`.

## Gate (per stacked commit — prove-it-works)

`bun run typecheck && bun run lint && bun run build && bun test`. Plus runtime proof for the
launch-critical commits: boot dev, `/2024` + `/2026` render the shared detail page EN+FR, the
RegFox register button is present on 2026, section-skip drops empty sections.

## Non-goals (do NOT flag as gaps)

- Conference is not a Page. Form field-kinds are a closed set (not an arbitrary builder).
- On-site registration is not the Friday channel (RegFox is).
- No relational DB; content is JSON objects in the bucket. No `@aws-sdk` (Bun `S3Client`).
- The future first-party registrar is a direction the Submission log seeds — not built now.
