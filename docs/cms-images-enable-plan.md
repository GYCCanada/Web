# CMS: per-page images + resize-on-upload + per-page `enabled` flag

Synthesized implementation plan (one stacked-PR set off `main`, feature granularity).
Author: Claude (Opus 4.8). Grounded against the live code as of `9887ca8`.

This is the FINAL synthesis of the two dual plans + the two adversarial reviews, with the
**user decision applied**: the CMS image fields go on the **TEAM page**, not About/Home (settles
Codex blocking critique #2). Team is the only evergreen page that renders images today (a
hardcoded group photo `/team/group-van-2022.jpg` + a logo/portrait at
`app/routes/($lang)+/team/_index.tsx:33-53`) and it is the page Feature C's `enabled` flag hides
— so when it is re-enabled, its photos are swapped via CMS upload. That redirection makes Feature A
a **CMS migration of the Team route into the per-page model**, not a bolt-on of an image field to
an already-migrated page.

| # | Branch | Feature |
|---|--------|---------|
| A | `cms/team-cms-image-upload` | Migrate the Team route into the per-page CMS model (new `TeamPage`), add its two optional `ImageRef` fields + RichText title, wire the `upload:` intent into the per-page editor. |
| B | `cms/image-resize-on-upload` | Shrink + re-encode uploads with `Bun.Image` at ONE shared upload boundary both editors call. |
| C | `cms/page-enabled-flag` | A decode-safe per-page `enabled` boolean (incl. the now-CMS team); data-driven nav + route AND action 404; delete every hardcoded team hide. |

## Branch order + dependency reasoning (re-derived with Team's CMS migration in A)

**A → B → C, and C MUST follow A.**

- **A is first and is the keystone.** It introduces the per-page image field, the new `TeamPage`
  Page object, AND the per-page-editor `upload:` wiring that B's resize boundary plugs into. The
  user decision moves the image content-model decision (Team's two image fields) *into A*, so A now
  depends on the per-page CMS machinery (`getPage`, `PAGE_SPECS`, `DraftEditor`'s page scope) —
  all of which already exist (registration-launch Branch 5). A adds `team` to the closed `PageId`
  set and migrates the route.
- **B is second.** It factors the *validate file → read bytes → `storage.put` raw bytes* step
  (today in `content.tsx`, newly added by A in `pages.$page.tsx`) into one `prepareImage` boundary
  and inserts the resize there. The boundary it shares is only co-owned by both editors *after* A
  gives `pages.$page.tsx` an upload branch. B is decoupled from C.
- **C MUST follow A** (not independent). The prior plan treated C as independent and put team's
  flag on `SiteContent` (a `teamEnabled` field). The user decision makes **team a `PageId`**, so
  team's visibility is just the per-page `enabled` flag on the now-CMS `TeamPage` — there is no
  separate `teamEnabled`. C therefore consumes A's `TeamPage` (its `enabled` flag gates the team
  route + nav link). C cannot be cut before A without re-introducing the rejected "team on
  site.json" path. This also *removes* a whole risk class (the prior plan's `teamEnabled`-on-
  `SiteContent` split, prior-plan Risk 6) — `derive-dont-sync`: team's flag lives in the object
  team-page copy now lives in.

Each branch's gate is per-sub-commit:
`cd /Users/cvr/Developer/personal/gyc && bun run typecheck && bun run lint && bun run build && bun test`.

---

## Settled-decision realization (do not re-open)

- **Reuse, no parallel path.** The existing `AssetKey` brand (`app/lib/content/schema.ts:82`),
  `ImageRef` (`schema.ts:105`) / `DraftImageRef` (`schema.ts:638`), the `ImageUpload` component
  (`app/routes/admin/controls.tsx:131`), the `upload:<keyPath>` intent (`IMAGE_UPLOAD_INTENT_PREFIX`,
  `admin-form.ts:54`), `uploadedImageKey` (`admin-form.ts:111`), and `DraftEditor.applyImageUpload`
  (`draft-editor.server.ts:604`) are reused verbatim. No new upload path, no second AssetKey.
- **Resize at ONE boundary (B)**, called by both `content.tsx` and `pages.$page.tsx`.
- **Image fields go on TEAM** (user decision), each `Schema.optionalKey(ImageRef)`, section-skippable
  (absent ⇒ renders nothing, ADR 0008), decode-safe (a stored `team.json` without the field still
  decodes), with a **lax `DraftImageRef`** so a key can land before alt text (Codex #3).
- **`enabled` flag** on every Page incl. the now-CMS team, decode-safe via
  `Schema.withDecodingDefaultKey(Effect.succeed(true))` (Codex #4), data-driven nav, route AND action
  404 (Codex #6), an explicit boolean admin control with `assembleOverrides` coercion (Codex #5/#12),
  and EVERY hardcoded team hide DELETED — the two `_layout.tsx` nav comments AND the commented `/team`
  CTA in `_index.tsx:115-120` (Codex R1).

---

# Feature A — Team CMS migration + per-page image upload

**Branch:** `cms/team-cms-image-upload`

## A.0 — The content-model decision: TEAM gains the image fields (About/Home get NONE)

Today the Team route (`app/routes/($lang)+/team/_index.tsx`) is a **separate hand-built route** with:
- a hardcoded group photo `src="/team/group-van-2022.jpg"` (`_index.tsx:35`),
- a hardcoded logo/portrait `src="/logo/gycc.png"` (`_index.tsx:50`),
- a rich italic title from translation keys `team.title` + `team.title.movement`
  (`"The people behind the {{movement}}."`, `translations.ts:58-59`),
- subtitle/board headings from `team.subtitle` / `team.board` (`translations.ts:62-64`),
- and the per-member executive list, which is **separate `site.json` data** read via
  `content.getTeam()` (`content.server.ts:656`) — NOT touched by this migration.

The migration creates a **`TeamPage` Page object** that owns the page CHROME (title, subtitle,
board heading, and the two images). The per-member roster (`team[]` + `board[]` on `site.json`)
stays where it is — it is conference-executive data, not evergreen page copy, and `getTeam()`
already serves it. So:

| Page | Image field? | Field(s) | Justification |
|------|-------------|----------|---------------|
| **Team** | YES | `groupPhoto?: ImageRef`, `portrait?: ImageRef` | The only evergreen page that renders images today (group photo + logo/portrait). Each OPTIONAL ⇒ absent renders nothing (section-skip). When the page is re-enabled (Feature C), its photos are swapped via CMS upload. |
| **About** | NO | — | Per the user decision. About renders no image today; adding one is gratuitous. |
| **Home** | NO | — | Per the user decision. |
| FAQ / Give / Contact / Volunteer / Archive | NO | — | No image in any of these content models. |

**Why two fields, both optional `ImageRef`:** the group photo and the portrait are semantically
distinct slots (different aspect/role in the layout), so two named `optionalKey(ImageRef)` fields
beat one list — `make-impossible-states-unrepresentable`. Optional-at-key means a `team.json`
that predates either field (or has only one uploaded) still decodes and the layout section-skips
the missing image.

## A.1 — Add `team` to the closed `PageId` set + the `TeamPage` schema

`PageId` (`pages/registry.ts:69`) is the closed `Schema.Literals` of evergreen pages. Add `'team'`.
This is the single registration point (`derive-dont-sync`); the admin labels, the read-path caches,
the `DraftEditor` scope, and the `PageEditor` switch all derive from it. Adding `'team'` forces a
compile error in `PageEditor`'s exhaustive switch (`pages.$page.tsx:528-536`) and in `PAGE_LABELS`
(`pages.$page.tsx:77`) and `PAGE_SPECS` (`registry.ts:182`) until each gets a team arm — that
type-error IS the checklist.

`pages/schema.ts` — the new strict schema (decode-safe images, RichText title per Codex #8):

```ts
export const TeamPage = Schema.Struct({
  // RichText so the italic 'movement' run (team.title.movement) round-trips as a token,
  // NOT HTML — exactly like VolunteerPage.title (schema.ts:205). Resolves Codex #8.
  title: RichText,
  subtitle: Text,
  boardHeading: Text,
  groupPhoto: Schema.optionalKey(ImageRef),   // absent ⇒ section-skip; present ⇒ strict {key, alt}
  portrait: Schema.optionalKey(ImageRef),
});
export type TeamPage = typeof TeamPage.Type;
```

`ImageRef` (`schema.ts:105`) must be imported into `pages/schema.ts` (it currently imports only
`ExternalHttpsUrl`, `ListItemId`, `Text` from `../schema`; add `ImageRef`).

`pages/schema.ts` — the DRAFT variant (lax image so the uploaded key lands before alt text, Codex #3):

```ts
// Reuse the SAME laxity DraftImageRef encodes (schema.ts:638): a present key is a strict
// AssetKey, alt may be unfilled. Define a local DraftImageRef in pages/schema.ts mirroring
// schema.ts:638 (key: optionalKey(AssetKey), alt: optionalKey(DraftText)) — pages/schema.ts
// already has its own DraftText (schema.ts pages-file line 281), so the draft image ref is:
const DraftImageRef = Schema.Struct({
  key: Schema.optionalKey(AssetKey),
  alt: Schema.optionalKey(DraftText),
});

export const DraftTeamPage = Schema.Struct({
  title: RichText,            // title has no id-only-add flow; stays strict (RichText is draft-safe as a whole value)
  subtitle: Text,
  boardHeading: Text,
  groupPhoto: Schema.optionalKey(DraftImageRef),
  portrait: Schema.optionalKey(DraftImageRef),
});
export type DraftTeamPage = typeof DraftTeamPage.Type;
```

`AssetKey` is imported from `../schema` for the draft image ref.

**Why `draftPageSpec` (draft ≠ strict) for team:** the strict `groupPhoto`/`portrait` require a
*present* image to carry a strict `{key, alt}` (both `Text` halves non-empty); the draft tolerates
an uploaded `key` with an empty `alt` (the admin uploads first, fills alt second — same flow as
speaker photos). So `team` wires `draftPageSpec(TeamPage, DraftTeamPage, defaultTeamPage)` in
`PAGE_SPECS`. This is the existing `DraftEditor` codec path (`draft-editor.server.ts:350` `objectCodec`)
— no new machinery.

## A.2 — `defaultTeamPage` (decode-safe, transcribes today's chrome) + registry wiring

`pages/defaults.ts` — transcribe today's translation-key chrome into the typed object, OMITTING the
image keys (optional ⇒ section-skip default; the real images are uploaded via CMS, mirroring how the
site defaults map `public/` art):

```ts
export const defaultTeamPage: TeamPage = Schema.decodeUnknownSync(TeamPage)({
  // team.title "The people behind the {{movement}}." with the italic 'movement' run as tokens
  title: [
    { _tag: 'text', value: { en: 'The people behind the ', fr: 'Les personnes derrière le ' } },
    { _tag: 'italic', value: { en: 'movement', fr: 'mouvement' } },   // team.title.movement
    { _tag: 'text', value: { en: '.', fr: '.' } },
  ],
  subtitle: { en: <team.subtitle EN>, fr: <team.subtitle FR> },       // translations.ts:62/328
  boardHeading: { en: 'Board of Directors', fr: 'Conseil d’administration' }, // team.board
  // groupPhoto / portrait omitted (optional) — uploaded via CMS; route falls back to no image,
  // OR the default group photo is seeded by setting groupPhoto.key to the in-public path on first
  // publish. Decision: OMIT in the default so a brand-new team.json renders the roster without a
  // broken <img>; the launch upload sets it. (The old /team/group-van-2022.jpg stays in public/
  // until an upload overrides it — see A.5 deletions.)
});
```

`pages/registry.ts`:
- import `TeamPage`, `DraftTeamPage` from `./schema`, `defaultTeamPage` from `./defaults`;
- add `team: draftPageSpec(TeamPage, DraftTeamPage, defaultTeamPage)` to `PAGE_SPECS`.

`routes.ts:39` already maps `team` to `routes/($lang)+/team/_index.tsx`; that route stays, its
loader is rewritten in A.4.

## A.3 — Project `TeamPage` to a per-locale view (`project.ts`)

`pages/project.ts` adds a `TeamView` + `toTeamView` mirroring the other converters, projecting the
RichText title to runs and each image to a `{ src, alt }` (or `undefined`):

```ts
export interface TeamView {
  readonly title: readonly RichTextRun[];
  readonly subtitle: string;
  readonly boardHeading: string;
  readonly groupPhoto?: { readonly src: string; readonly alt: string };
  readonly portrait?: { readonly src: string; readonly alt: string };
}

export const toTeamView = (page: TeamPage, locale: Locale): TeamView => ({
  title: toRichText(page.title, locale),
  subtitle: page.subtitle[locale],
  boardHeading: page.boardHeading[locale],
  groupPhoto: page.groupPhoto
    ? { src: assetUrl(page.groupPhoto.key), alt: page.groupPhoto.alt[locale] }
    : undefined,
  portrait: page.portrait
    ? { src: assetUrl(page.portrait.key), alt: page.portrait.alt[locale] }
    : undefined,
});
```

`assetUrl(key) = /images/${key}` is currently **private** to `content.server.ts:193`. Export it
from a shared module (or define a tiny `app/lib/content/asset-url.ts` `export const assetUrl = (key) =>
\`/images/${key}\``) and have BOTH `content.server.ts` and `project.ts` import it — `derive-dont-sync`,
one URL-resolution rule. (The other page projections that will eventually carry images reuse the
same helper.)

## A.4 — Migrate the Team route to `getPage('team')` + render CMS images

`team/_index.tsx`: the loader currently returns only `getTeam()` (roster). Change it to fetch BOTH
the new `TeamPage` chrome AND the roster:

```ts
export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  const page = toTeamView(yield* content.getPage('team'), locale);
  const { team, board } = yield* content.getTeam();
  return { page, team, board };
});
```

The JSX:
- the hardcoded `<img src="/team/group-van-2022.jpg" …>` (`_index.tsx:34-38`) becomes
  `{page.groupPhoto && <img src={page.groupPhoto.src} alt={page.groupPhoto.alt} …/>}` (section-skip);
- the hardcoded `<img src="/logo/gycc.png" …>` (`_index.tsx:49-53`) becomes
  `{page.portrait && <img src={page.portrait.src} alt={page.portrait.alt} …/>}`;
- the `translate('team.title', { movement: <span className="italic">…</span> })` block
  (`_index.tsx:40-48`) becomes a `<RichText runs={page.title} />` render (reuse `~/ui/rich-text`,
  the renderer `project.ts` runs feed — the same one About/FAQ/Contact use);
- `translate('team.subtitle')` (`_index.tsx:57`) → `{page.subtitle}`;
- `translate('team.board')` (`_index.tsx:77`) → `{page.boardHeading}`;
- the per-member roster map (`_index.tsx:60-73`) is UNCHANGED — it renders `team` from `getTeam()`,
  and `member.position` still goes through `translate(...)` (the executive positions stay on
  `site.json`'s `TeamPosition` keys, not migrated here — `subtract-before-you-add`, this feature
  migrates page chrome only).

The `useTranslate()` import is removed from this route only if no translate call remains (the
`member.position` translate keeps it — so `useTranslate` stays, but the `team.title`/`team.subtitle`/
`team.board`/`team.image.alt` keys are no longer referenced HERE).

## A.5 — Wire the `upload:` intent into the per-page editor action + render the controls

`pages.$page.tsx`'s action does NOT handle `upload:` today (only `list-op`/`save-draft`/`publish`).
Add the upload branch IDENTICAL in shape to `content.tsx:135-180`, scoped via `pageScope(page)`:

```ts
const uploadTarget = imageUploadTarget(intent);
if (uploadTarget !== null) {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) { /* 400 'Choose an image…' */ }
  if (!isAcceptedImageType(file.type)) { /* 400 'Upload a JPEG, PNG, WebP, GIF, or AVIF…' */ }
  const now = yield* Clock.currentTimeMillis;
  const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
  const key = uploadedImageKey(uploadTarget, file.type, now);   // B replaces file.type w/ prepared.contentType
  const putExit = yield* Effect.exit(storage.put(key, bytes, file.type));  // B replaces this trio w/ prepareImage
  if (putExit._tag === 'Failure') { /* 502 */ }
  const applied = yield* editor.applyImageUpload(scope, uploadTarget, key).pipe(Effect.result);
  if (applied._tag === 'Failure') return issueResponse(applied.failure);
  return redirect(`/admin/pages/${page}?status=${encodeURIComponent(`Image uploaded: ${key}`)}`);
}
```

This needs `Storage`, `Clock`, `imageUploadTarget`, `isAcceptedImageType`, `uploadedImageKey`
imported into `pages.$page.tsx` (all already exported). `applyImageUpload` is already
scope-generic (`<S extends ContentScope>`, `draft-editor.server.ts:604`); `setAtPath`
(`admin-form.ts:354`) already navigates `groupPhoto.key` / `portrait.key` as plain object paths
(no array identity); `DraftImageRef.key: optionalKey(AssetKey)` already accepts the rewritten key.
**No `DraftEditor` change** — A is route + schema + view + registry wiring.

`PageEditor`'s new `team` arm renders the reused `ImageUpload` control + a `Bilingual` alt input
per image, plus the editable `subtitle`/`boardHeading` (the RichText `title` is shown read-only via
`RichTextPreview`, consistent with volunteer/contact, `pages.$page.tsx:459-478`):

```tsx
case 'team': {
  return (
    <>
      <RichTextPreview label="Title" nodes={encoded['title'] as …} />
      <Bilingual label="Subtitle" name="subtitle" value={text(encoded['subtitle'] as DraftText)} multiline />
      <Bilingual label="Board heading" name="boardHeading" value={text(encoded['boardHeading'] as DraftText)} />
      <fieldset className="space-y-2">
        <legend>Group photo</legend>
        <ImageUpload keyPath="groupPhoto.key" currentKey={String((encoded['groupPhoto'] as any)?.key ?? '')} />
        <Bilingual label="Group photo alt" name="groupPhoto.alt" value={text((encoded['groupPhoto'] as any)?.alt as DraftText)} />
      </fieldset>
      <fieldset className="space-y-2">
        <legend>Portrait</legend>
        <ImageUpload keyPath="portrait.key" currentKey={String((encoded['portrait'] as any)?.key ?? '')} />
        <Bilingual label="Portrait alt" name="portrait.alt" value={text((encoded['portrait'] as any)?.alt as DraftText)} />
      </fieldset>
    </>
  );
}
```

`PAGE_LABELS` gains `team: 'Team'`. The alt-text + subtitle ride the normal save/publish path
(`assembleOverrides` → `editDocument`), no new merge logic. The `ImageUpload` component is unchanged.

## Module interface (A)
- `pages/registry.ts`: `'team'` added to closed `PageId`; `PAGE_SPECS.team = draftPageSpec(TeamPage, DraftTeamPage, defaultTeamPage)`.
- `pages/schema.ts`: `TeamPage` (`title: RichText`, `subtitle`/`boardHeading: Text`, `groupPhoto?/portrait?: ImageRef`) + `DraftTeamPage` (lax `DraftImageRef`); import `ImageRef`, `AssetKey`.
- `pages/defaults.ts`: `defaultTeamPage` (title tokens, subtitle/boardHeading transcribed, images omitted).
- `pages/project.ts`: `TeamView` + `toTeamView`; shared `assetUrl` helper extracted + exported (consumed by `content.server.ts` too).
- `team/_index.tsx`: loader → `getPage('team')` + `getTeam()`; JSX renders CMS title/subtitle/board/images, roster unchanged.
- `pages.$page.tsx`: new `upload:` action branch (mirrors `content.tsx`); `PageEditor` `team` arm with `ImageUpload` + alt `Bilingual`; `PAGE_LABELS.team`.

## Sub-commits (A) — each gate-green
- **A.1** `feat(pages): add TeamPage schema (RichText title + optional images)` — `TeamPage` + `DraftTeamPage` + the local `DraftImageRef`; `pages/schema.test.ts` round-trips WITH and WITHOUT each image, asserts a present image needs a strict `AssetKey`, asserts an `image`-less stored JSON decodes (the required-field-on-published-doc gate).
- **A.2** `feat(pages): register team page + default chrome` — `PageId` `'team'`, `PAGE_SPECS.team`, `defaultTeamPage`; defaults decode at module load; `pages/registry`/read-path tests see 8 pages.
- **A.3** `feat(pages): project team page to a per-locale view` — `TeamView` + `toTeamView` + extracted `assetUrl`; `project.test.ts` (title runs, image → `/images/<key>`, absent ⇒ `undefined`, locale-correct alt).
- **A.4** `feat(team): render team route from the CMS page` — `team/_index.tsx` loader + JSX migration; delete the in-route `team.title`/`team.subtitle`/`team.board`/`team.image.alt` translate calls (roster + `member.position` unchanged); render-parity test vs the pre-migration markup.
- **A.5** `feat(admin): upload images in the team page editor` — `pages.$page.tsx` `upload:` branch + `PageEditor` `team` arm + `PAGE_LABELS.team`; action test (POST `intent=upload:groupPhoto.key` + fake `File` → draft `team.json` carries `groupPhoto.key` under `images/uploads/…`).
- **A.6** `chore(i18n): delete migrated team translation keys` — remove `team.title`, `team.title.movement`, `team.subtitle`, `team.image.alt`, `team.logo.alt`, `team.board` from `translations.ts` (EN + FR); KEEP `team.position.*` (roster) and `nav.team` (Feature C still renders the nav label). Grep proves no remaining reference (`subtract-before-you-add`).

## Deletions (A)
- The hardcoded `src="/team/group-van-2022.jpg"` and `src="/logo/gycc.png"` `<img>`s in `team/_index.tsx:34-38, 49-53` (replaced by CMS `groupPhoto`/`portrait`).
- The `translate('team.title', { movement: … })` interpolation block (`_index.tsx:40-48`) → `<RichText>`.
- The translation keys `team.title`, `team.title.movement`, `team.subtitle`, `team.image.alt`, `team.logo.alt`, `team.board` (A.6). `team.position.*` and `nav.team` stay.

## Test surface (A)
- `pages/schema.test.ts`: TeamPage decode WITH / WITHOUT each image; a present image requires a strict `AssetKey` (leading-`/` key rejected); a field-less stored JSON decodes (decode-migration gate); DraftTeamPage tolerates `groupPhoto.key` with no `alt`.
- `pages/project.test.ts`: title→runs, image→`/images/<key>`, absent→`undefined`, locale alt.
- `team/_index` render-parity test: the migrated route renders the same visible copy/structure as the pre-migration route given `defaultTeamPage` + a seeded image.
- `pages.$page` action test (extend `cms-e2e.test.ts`): `intent=upload:groupPhoto.key` + fake `File` → draft `team.json` has `groupPhoto.key`; non-image MIME → 400; empty file → 400 (reusing the `content.tsx` guards).

## Runtime proof (A)
Boot dev, open `/admin/pages/team`, upload a JPEG to the group photo, confirm the draft stores the
key, publish, and the `/team` route renders the uploaded `<img>` (and the portrait slot section-skips
while empty). Confirm About/Home/FAQ editors show NO image control.

---

# Feature B — Image resize-on-upload (one shared boundary)

**Branch:** `cms/image-resize-on-upload`

## B.0 — The one shared upload boundary

The *validate → read bytes → `storage.put` raw bytes* sequence lives in `content.tsx:155-159` and,
after A, in `pages.$page.tsx`. B factors that into ONE helper both actions call, inserting the
resize so it is applied EXACTLY ONCE regardless of which editor uploaded.

New module `app/lib/content/image-optimize.server.ts`:

```ts
import { Effect } from 'effect';
import { extensionForType } from './admin-form';

export const MAX_WIDTH = 1600;          // cap; never upscale
export const WEBP_QUALITY = 80;

export interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;         // 'image/webp' after re-encode, else the original
  readonly extension: string;           // 'webp' after re-encode, else extensionForType(original)
}

export const prepareImage = (
  bytes: Uint8Array,
  sourceType: string,
): Effect.Effect<PreparedImage> =>
  Effect.gen(function* () {
    // GIF passthrough (decision below): never decode/re-encode — would drop all but frame 1.
    if (sourceType.toLowerCase() === 'image/gif') {
      return { bytes, contentType: 'image/gif', extension: 'gif' };
    }
    return yield* Effect.tryPromise(async () => {
      const img = new Bun.Image(bytes);
      // CRITICAL (Codex #1): `img.width` is -1 until metadata() resolves in Bun 1.3.14.
      // Guard the no-upscale decision on `metadata().width`, NOT `img.width`.
      const meta = await img.metadata();
      const chain = meta.width > MAX_WIDTH ? img.resize(MAX_WIDTH) : img;
      const out = new Uint8Array(await chain.webp({ quality: WEBP_QUALITY }).toBuffer());
      return { bytes: out, contentType: 'image/webp', extension: 'webp' } satisfies PreparedImage;
    }).pipe(
      // Optimizer-failure fallback: store ORIGINAL bytes/type — never fail an upload (Codex fallback).
      Effect.catchAll(() =>
        Effect.succeed({ bytes, contentType: sourceType, extension: extensionForType(sourceType) }),
      ),
    );
  });
```

**VERIFIED in Bun 1.3.14** (this environment, no new dependency):
`new Bun.Image(bytes).resize(1600).webp({quality:80}).toBuffer()` runs; `img.width === -1` before
`metadata()` but `(await img.metadata()).width` is correct (1 for a 1×1 test PNG); the chain yields
encoded bytes. The `metadata().width` guard (Codex #1) is the load-bearing correction over the
prior plan, which read `img.width` (always -1) and would therefore have NEVER resized — every
upload would have been re-encoded full-size. Note the chain is `await`-based because `metadata()`
and `toBuffer()` are async, so the helper uses `Effect.tryPromise` (not `Effect.try`).

### GIF decision (settled-#3 caveat): **skip-resize-passthrough**.
`image/gif` is stored verbatim (original bytes, `image/gif`, `.gif`). Rationale: animated GIFs
become a single still frame under a `Bun.Image` decode/re-encode (unrequested data loss), and an
animated promo GIF is a legitimate use. Static GIFs pay only the original-size cost. The more
conservative of the two allowed options (vs first-frame flatten); never surprises the admin.

## B.1 — Key / extension / content-type follow the RE-ENCODED type (Codex #2 / R2)

`uploadedImageKey(targetPath, contentType, seed)` builds the key with `extensionForType(contentType)`.
The actions today pass `file.type` (SOURCE). After resize the stored object IS WebP, so the key's
extension AND `storage.put`'s content-type must be `image/webp`, or the served object's type/extension
lie. The boundary order becomes:

```ts
const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
const prepared = yield* prepareImage(bytes, file.type);
const now = yield* Clock.currentTimeMillis;
const key = uploadedImageKey(uploadTarget, prepared.contentType, now);  // .webp (or .gif passthrough)
const putExit = yield* Effect.exit(storage.put(key, prepared.bytes, prepared.contentType));
```

`isAcceptedImageType(file.type)` still gates the SOURCE (jpeg/png/webp/gif/avif) BEFORE `prepareImage`,
so a PDF never reaches the optimizer. A WebP source is re-encoded to WebP (a recompress that still
applies the width cap) — acceptable, keeps the boundary single-path.

## B.2 — Apply the boundary in BOTH actions

Replace the raw `storage.put(key, bytes, file.type)` trio in `content.tsx` AND `pages.$page.tsx`
(the branch A added) with the `prepareImage` sequence. Neither route hand-rolls resize after B;
both call the one helper (`subtract-before-you-add`: the duplicated raw-put is REPLACED, not
paralleled). Update the now-false "the resize/WebP pipeline is deferred" comment in
`admin-form.ts:60-66`.

## Module interface (B)
- `image-optimize.server.ts`: `prepareImage(bytes, sourceType) → Effect<PreparedImage>`, `MAX_WIDTH`, `WEBP_QUALITY`.
- Both editor actions call `prepareImage` and key/put off `prepared.contentType`.

## Sub-commits (B) — each gate-green
- **B.1** `feat(content): add prepareImage resize-to-webp boundary` — the module + `image-optimize.server.test.ts` (resize-if-larger via `metadata().width`; no-upscale of a narrow image; GIF passthrough byte-identical; decode-failure fallback to original bytes+type; WebP-source recompress). Pure, no route change.
- **B.2** `refactor(admin): route uploads through prepareImage in both editors` — swap both actions onto the boundary; key + put follow `prepared.contentType`; update the stale `admin-form.ts:60-66` comment; action test asserts a wide JPEG → `.webp` key + `image/webp` put.

## Deletions (B)
- The duplicated raw `storage.put(..., file.type)` step in `content.tsx` and `pages.$page.tsx` (subsumed by `prepareImage` + key-from-`prepared.contentType`).
- The "the resize/WebP pipeline is deferred" wording in `admin-form.ts:60-61`.

## Test surface (B)
- `image-optimize.server.test.ts`: a >1600px JPEG → smaller WebP (`contentType==='image/webp'`, decoded width === 1600); a ≤1600px image is NOT upscaled (width unchanged, still re-encoded to webp); `image/gif` passes through byte-identical with `image/gif`; a corrupt buffer falls back to original bytes + original type (no throw). Use real fixture bytes decoded back through `Bun.Image().metadata()` to assert the resulting width.
- Action-level (against `storage.test-helper.ts` in-memory `Storage`): upload a 2400px JPEG → stored key ends `.webp`, `put` got `image/webp`.

## Runtime proof (B)
Boot dev, upload a large JPEG in `/admin/pages/team` (group photo) AND in `/admin/content` (speaker
photo): confirm BOTH store `images/uploads/…​.webp` (resized smaller), the served `/images/…` renders,
and a `.gif` upload is stored as `.gif` unchanged.

---

# Feature C — Per-page `enabled` flag

**Branch:** `cms/page-enabled-flag` (stacks on A; independent of B)

## C.0 — Decode-safe flag on every Page (incl. the now-CMS team)

Add `enabled: boolean` to EVERY Page schema — about/faq/give/contact/volunteer/archive/home **and
team** — defaulting to `true` so an already-published doc that predates the flag still decodes, via
`Schema.withDecodingDefaultKey` (**confirmed present in `effect@4.0.0-beta.60`**, `Schema.d.ts:3223`;
signature `withDecodingDefaultKey<S>(defaultValue: Effect.Effect<S["Encoded"]>)`):

```ts
import { Effect, Schema } from 'effect';
// added to each Page Struct AND each Draft* variant:
enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
```

`withDecodingDefaultKey` makes the key OPTIONAL on the encoded side and supplies `true` when absent
during decode — the same class of fix the registration launch needed twice
(`OptionFromOptionalKey`, `schema.ts:466-489`); here a `true`-by-default boolean is the honest model
(a page is enabled unless turned off). Because the default is identical in draft and publish, every
Page's `draftSchema` gets the same field (the draft must round-trip it); a defaulted-optional key
keeps draft ≡ strict for the `pageSpec` pages (contact/volunteer/home), so no new `draftPageSpec`
is introduced for them. The list-bearing pages and `team` already use `draftPageSpec`; they get the
field in both the strict and draft struct.

`pages/defaults.ts`: set `enabled: true` explicitly in each default for self-describing seeds;
legacy stored objects rely on the decode default.

**Team's flag is just this flag.** Because A made team a `PageId`, team's visibility is
`TeamPage.enabled` — there is NO separate `teamEnabled` on `SiteContent`. The published `team.json`
ships `enabled: false` to preserve today's hidden-team behavior (now data-driven, not a code
comment). This is the prior-plan's awkward `teamEnabled`-on-`SiteContent` split eliminated
(`derive-dont-sync`).

## C.1 — Read the flag to the boundary; data-driven nav (Codex R1 deletions)

`Content.getPage` returns `PageContent<P>`, which now carries `enabled`. Two consumers:

1. **Nav (data-driven; replaces the hardcoded team hide).** `_layout.tsx`'s loader returns
   `{ lang, translation, currentConference }`. Extend it to also fetch the enabled set for the pages
   the nav links — add a thin `Content.getEnabledPages()` returning `Record<PageId, boolean>` (it
   reads the already-cached per-page objects; cheap), folded into the loader as `enabled`. Then:
   - **DELETE** `_layout.tsx:99` `{/* <NavItem to="/team">…</NavItem> */}` (TopNav) and
     `_layout.tsx:165` `// { to: "/team", … },` (PopupNav). Replace with a **real**
     `NavItem to="/team"` gated on `enabled.team` — so when `team.enabled` flips true the link
     appears, driven by data.
   - The other nav links (about/contact/give/volunteer in `TopNav`/`PopupNav`, faq in the footer)
     each render only when `enabled[page]` is true. No second hardcoded page list
     (`derive-dont-sync`).
   - **DELETE** the commented `/team` CTA block in `_index.tsx:115-120` (the `main.meet_the_team`
     button) — Codex R1. It is dead commented code beside the flag; `subtract-before-you-add`.

2. **Route AND action 404 (Codex #6).** A disabled page must 404 BOTH its public GET route AND any
   action it owns:
   - Each `($lang)+` page route loader checks the flag and fails with a 404 `Response`:
     ```ts
     const page = yield* content.getPage('give');
     if (!page.enabled) return yield* Effect.fail(new Response('Not Found', { status: 404 }));
     ```
   - The team route 404s on `!page.enabled` (team is a `PageId` now).
   - **404, not redirect** (Codex review choice): a disabled evergreen page genuinely does not exist
     for the public; a redirect-to-home would mask a stale bookmark as a soft success. Mirrors the
     admin routes' own `404 when disabled` (`content.tsx:96-99`).
   - "Action 404" (Codex #6): pages with form actions (contact/volunteer post to their own route
     actions) must ALSO 404 the action when disabled, not just the loader — otherwise a disabled
     contact page still accepts POSTs. Each such route's `action` re-checks `getPage(id).enabled`
     and 404s first. (Pure-content pages with no action — about/give/faq/archive/home/team — need
     only the loader check.)

## C.2 — Edit the flag in the admin editor (Codex #5/#12 coercion)

`PageEditor` (`pages.$page.tsx`) gains an `enabled` checkbox per page — a new tiny `Checkbox`
control in `controls.tsx`:

```tsx
export function Checkbox({ label, name, defaultChecked }: {
  readonly label: string; readonly name: string; readonly defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} value="true" />
      {label}
    </label>
  );
}
```

The field rides the normal `assembleOverrides` → `editDocument` save path. `assembleOverrides`
(`admin-form.ts:217`) today coerces only `chapter`/`verse` to numbers and treats every other leaf
as a string; an unchecked checkbox is **absent** from FormData and a checked one posts `"true"`.
A bare string `"true"`/absent would NOT decode as `Schema.Boolean`. Two-part fix (Codex #5/#12):

- **Explicit boolean coercion in `assembleOverrides`**: a leaf named `enabled` coerces
  `value === 'true'` → `true`, symmetric with the numeric `chapter`/`verse` coercion — keeps the
  schema a plain `Schema.Boolean`.
- **Absent-means-false**: an unchecked box sends nothing, so the override omits `enabled` and
  `deepMerge` leaves the base value — which would make "uncheck + save" a no-op. To make unchecking
  effective, the editor renders a **hidden `enabled=false` companion field before the checkbox**
  (the classic checkbox pattern): FormData then always carries an `enabled` value (`"false"` when
  unchecked, the checkbox's `"true"` overriding when checked — last-wins in `form.entries()` order).
  `assembleOverrides` coerces whichever lands. This guarantees a deterministic boolean override
  every save (Codex #5: the explicit boolean control with reliable coercion).

`PageEditor` renders `<Checkbox label="Page enabled (visible in nav + routable)" name="enabled"
defaultChecked={Boolean(encoded['enabled'] ?? true)} />` (with the hidden companion) in EVERY page
arm — including `team`.

## Module interface (C)
- Each Page schema + Draft variant: `enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))`.
- `pages/defaults.ts`: explicit `enabled: true` in each default; the published `team.json` seed ships `enabled: false`.
- `Content`: `getEnabledPages(): Effect<Record<PageId, boolean>>` (thin read over the cached page objects).
- `pages/project.ts`: each `*View` carries `enabled: boolean` (so routes read it post-projection); `toTeamView` etc. pass it through.
- `_layout.tsx`: loader fetches `enabled`; `TopNav`/`PopupNav` filter links; real `/team` `NavItem` gated on `enabled.team`; hardcoded team hides DELETED.
- Each `($lang)+` page route loader (and form-bearing actions): `if (!page.enabled) → 404`.
- `admin-form.ts`: `enabled`-leaf boolean coercion in `assembleOverrides`.
- `controls.tsx`: `Checkbox` (+ hidden companion); `PageEditor` renders it per page.

## Sub-commits (C) — each gate-green
- **C.1** `feat(pages): add decode-safe enabled flag to every Page schema` — strict + draft + defaults; `pages/schema.test.ts`: a stored doc WITHOUT `enabled` decodes to `enabled:true`; `enabled:false` round-trips encode→decode; draft variant same; covers `team`.
- **C.2** `feat(content): read enabled flags + project through views` — `getEnabledPages()` + `enabled` on each `*View` + converters; `content.server`/`project` tests.
- **C.3** `feat(nav): drive nav links off enabled flags; delete hardcoded team hide` — `_layout.tsx` loader + `TopNav`/`PopupNav` filtering + real `/team` `NavItem`; DELETE the two `_layout.tsx` team comments AND the `_index.tsx:115-120` team CTA comment (Codex R1).
- **C.4** `feat(routes): 404 disabled pages (loader + action)` — every `($lang)+` page route loader 404s when disabled; contact/volunteer ACTIONS 404 when disabled (Codex #6); team route 404s on `!enabled`.
- **C.5** `feat(admin): edit the enabled flag` — `Checkbox` + hidden companion + `assembleOverrides` boolean coercion + `PageEditor` wiring (every page incl. team) + action test (toggle off → draft `enabled:false`; publish → route 404s).

## Deletions (C)
- `_layout.tsx:99` `{/* <NavItem to="/team">…</NavItem> */}` (TopNav hardcoded team hide).
- `_layout.tsx:165` `// { to: "/team", … },` (PopupNav hardcoded team hide).
- `_index.tsx:115-120` the commented `/team` CTA button (`main.meet_the_team`) — Codex R1.
- The implicit "team is hidden" knowledge in those comments — now `enabled:false` data on `team.json`.

## Test surface (C)
- `pages/schema.test.ts`: decode `{…no enabled…}` ⇒ `enabled:true`; `enabled:false` round-trips; draft same; team covered.
- A nav/route test (extend `cms-e2e.test.ts`): with `give.enabled=false` the give nav link is absent AND `/give` loader 404s; with `team.enabled=false` `/team` 404s and the team link is absent; flip `team.enabled=true` → link + page return.
- Action-404 test: a POST to the contact route action while `contact.enabled=false` returns 404.
- `admin-form.test.ts`: `assembleOverrides` coerces an `enabled` leaf to boolean (checked→true, hidden-companion→false); `editDocument` round-trips a flag toggle.

## Runtime proof (C)
Boot dev. In `/admin/pages/give` toggle `enabled` off + publish; confirm the give nav link
disappears and `/give` returns 404; toggle back on; link + page return. Confirm team is hidden
(driven by `team.json` `enabled:false`) with NO code comment; flip `enabled` on in `/admin/pages/team`
+ publish → the team nav link AND `/team` route return, rendering the CMS-uploaded photos from A.

---

# Risks (decode-migration hazards lead)

1. **Required-field-on-published-doc decode break (A + C).** Adding a non-optional field to a Page
   schema breaks every already-published `content/pages/<page>.json` that predates it — the exact
   trap the registration launch hit TWICE. MITIGATION: A's `groupPhoto`/`portrait` are
   `Schema.optionalKey(ImageRef)` (absent decodes fine); C's `enabled` uses
   `withDecodingDefaultKey(Effect.succeed(true))` (absent decodes to `true`). Each is gated by a
   schema test that decodes a field-LESS JSON and asserts success. For TEAM specifically: a `team.json`
   stored before this work would not exist yet (team is newly a Page), but the test still pins the
   property for forward safety.
2. **Bun.Image `width === -1` until `metadata()` (B) — Codex #1.** The prior plan read `img.width`
   (always -1 in Bun 1.3.14), so the no-upscale guard `width > MAX_WIDTH` was always false → NOTHING
   would ever resize; every upload would re-encode at full resolution. MITIGATION: guard on
   `(await img.metadata()).width`. VERIFIED in this environment. The helper is `Effect.tryPromise`
   (metadata/toBuffer are async).
3. **Extension/content-type lie after resize (B) — Codex #2 / R2.** Key built from `file.type` but
   bytes are WebP ⇒ served object's extension/type mismatch. MITIGATION: key + `storage.put` both use
   `prepared.contentType` (B.1); action test asserts `.webp` + `image/webp`.
4. **`Bun.Image` decode/encode throw (B).** A corrupt/exotic upload could throw. MITIGATION:
   `Effect.catchAll` fallback stores ORIGINAL bytes + original type — an upload never fails because
   the optimizer choked. Unit-tested with a non-decodable buffer.
5. **Animated GIF frame loss (B).** A `Bun.Image` re-encode keeps only frame 1. MITIGATION:
   `image/gif` passthrough (stored verbatim) — no flatten, no surprise data loss.
6. **Lax DraftImageRef so a key lands before alt (A) — Codex #3.** A strict `ImageRef` in the DRAFT
   schema would reject an uploaded `key` with an empty `alt` (the admin uploads first, fills alt
   second). MITIGATION: `DraftTeamPage` uses the lax `DraftImageRef` (`key: optionalKey(AssetKey)`,
   `alt: optionalKey(DraftText)`), mirroring `schema.ts:638`. Strict publish still requires both.
7. **`withDecodingDefaultKey` encode behavior (C).** The flag must be written back on publish so
   re-published objects are self-describing while legacy objects keep decoding. Default
   `encodingStrategy:'passthrough'` writes it back; a round-trip encode→decode test pins it. (If a
   future need wants legacy objects key-less, switch to `'omit'` — noted, not used.)
8. **Draft schema drift (A + C).** A field added to the strict schema but not its `Draft*` variant
   makes the draft editor's encode/decode reject. MITIGATION: every schema sub-commit edits BOTH the
   strict and draft variant in the same commit; `pages/schema.test.ts` exercises both.
9. **`assembleOverrides` boolean coercion + unchecked-checkbox (C) — Codex #5/#12.** A non-coerced
   `"true"` won't decode `Schema.Boolean`, and an unchecked box (absent from FormData) would make
   "uncheck + save" a no-op. MITIGATION: explicit `enabled`-leaf coercion in `assembleOverrides`
   (symmetric with numeric) + a hidden `enabled=false` companion field so the override is always
   present and deterministic.
10. **Team's per-member roster vs. page chrome confusion (A).** The migration moves only page CHROME
    (title/subtitle/board-heading/images) to `TeamPage`; the executive roster (`team[]`/`board[]` +
    `team.position.*` keys) stays on `site.json` via `getTeam()`. MITIGATION: A.4 leaves the roster
    map + `member.position` translate untouched; A.6 deletes ONLY the migrated chrome keys, keeping
    `team.position.*` and `nav.team`. A grep gate proves no dangling reference.
11. **Action-route 404 gap (C) — Codex #6.** A disabled page whose route owns a form action (contact,
    volunteer) would still accept POSTs if only the loader 404s. MITIGATION: those actions re-check
    `getPage(id).enabled` and 404 first (C.4).
12. **Shared `assetUrl` extraction (A).** Exporting `assetUrl` from `content.server.ts` (or a new tiny
    module) must not create an import cycle (`content.server` ↔ `project`). MITIGATION: put `assetUrl`
    in a leaf module `app/lib/content/asset-url.ts` that imports nothing from either; both import it.

---

# Resolved-critiques log

How each blocking critique from BOTH adversarial reviews + the user decision is addressed.

- **USER DECISION — image fields on TEAM, not About/Home (settles Codex #2 image-placement).**
  Resolved: Feature A is re-scoped to a CMS migration of the Team route — new `TeamPage` with
  `groupPhoto?`/`portrait?` optional `ImageRef`s, RichText title, `getPage('team')` loader, deleted
  hardcoded srcs + migrated translation keys. About/Home get NO image field (A.0). The redirection
  is logged in the branch-order reasoning and Risk 10.
- **Codex #1 — guard on `metadata.width`, not `.width` (−1 in Bun 1.3.14).** Resolved: `prepareImage`
  reads `(await img.metadata()).width`; verified; `Effect.tryPromise` for the async chain (B.0, Risk 2).
- **Codex #2 — key/extension/content-type follow the re-encoded WebP.** Resolved: key + put from
  `prepared.contentType` (B.1, Risk 3).
- **Codex #3 — lax DraftImageRef so a key can land before alt text.** Resolved: `DraftTeamPage` uses
  `DraftImageRef` (`key: optionalKey(AssetKey)`, `alt: optionalKey(DraftText)`) (A.1, Risk 6).
- **Codex #4 — `enabled` defaulted via `withDecodingDefaultKey(true)` for ALL evergreen pages incl.
  team.** Resolved: confirmed in `effect@4.0.0-beta.60`; applied to every Page strict + draft (C.0,
  Risk 1/7).
- **Codex #5 / #12 — explicit boolean admin control + `assembleOverrides` coercion.** Resolved:
  `Checkbox` control + hidden `enabled=false` companion + `enabled`-leaf boolean coercion in
  `assembleOverrides` (C.2, Risk 9).
- **Codex #6 — route AND action 404 for disabled pages.** Resolved: every page loader 404s; form-
  bearing actions (contact/volunteer) re-check and 404 (C.1/C.4, Risk 11). 404 chosen over redirect.
- **Codex #8 — migrate the rich italic 'movement' title to RichText.** Resolved: `TeamPage.title` is
  `RichText`; `defaultTeamPage` transcribes `team.title`/`team.title.movement` as `text`/`italic`
  tokens; the route renders `<RichText>` (A.0/A.2/A.4).
- **Codex R1 — delete every hardcoded team hide.** Resolved: both `_layout.tsx` nav comments (`:99`,
  `:165`) AND the commented `/team` CTA in `_index.tsx:115-120` DELETED; team visibility is the
  `TeamPage.enabled` flag (C.1/C.3, Risk 10).
- **R2 — single shared resize boundary, duplicated raw-put deleted.** Resolved: one `prepareImage`
  in `image-optimize.server.ts`, both actions call it; raw-put removed (B.0/B.2,
  subtract-before-you-add).
- **R3 — optimizer failure must not fail the upload.** Resolved: `Effect.catchAll` → original bytes
  fallback (B.0, Risk 4).
- **R4 — animated GIF silently flattened.** Resolved: GIF passthrough, no flatten (B.0, Risk 5).
- **R5 — reuse the existing AssetKey/ImageUpload/upload:/applyImageUpload, no parallel path.**
  Resolved: A reuses all four verbatim; the per-page action mirrors `content.tsx` (A.5, R5/settled #2).
- **R6 — nav must be data-driven, not a second hardcoded list.** Resolved: nav filters off the
  `getEnabledPages()` read in the layout loader; no parallel page list (C.1, derive-dont-sync).
- **Branch-order critique — does C depend on A, or is the flag independent of team's CMS-ness?**
  RESOLVED: because team is now a `PageId` (A), team's flag IS the per-page `enabled` flag on the
  CMS `TeamPage` — so C consumes A and MUST follow it. There is no separate `teamEnabled` on
  `SiteContent` (the prior plan's path), which removes that risk class entirely (branch-order
  reasoning; C.0).
