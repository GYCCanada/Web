import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  Content,
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
} from '../content.server';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import {
  assembleOverrides,
  collectTranslations,
  deepMerge,
  translationFieldName,
  uploadedImageKey,
  type Json,
} from './admin-form';
import {
  DraftEditor,
  formScope,
  pageScope,
  scopeKeys,
  siteScope,
} from './draft-editor.server';
import { defaultContent } from './defaults';
import {
  defaultContactForm,
  defaultFaqPage,
} from './pages/defaults';
import {
  formDraftKey,
  formObjectKey,
  pageDraftKey,
  pageObjectKey,
} from './pages/registry';
import { FormDefinition } from '../forms/definition';
import { FaqPage } from './pages/schema';
import { BoardMember, deterministicListItemId, DraftSiteContent, SiteContent } from './schema';
import type {
  DraftSiteContent as DraftSiteContentType,
  SiteContent as SiteContentType,
} from './schema';

/** A single board member for draft-reconciliation tests. */
const boardMember = (name: string) =>
  BoardMember.make({
    id: deterministicListItemId(`test-board-${name}`),
    name,
  });

const boardNames = (
  board: ReadonlyArray<{ readonly name?: string }>,
): readonly string[] => board.map((member) => member.name ?? '');

const draftWithBoard = (name: string) =>
  Schema.decodeUnknownSync(DraftSiteContent)(
    Schema.encodeUnknownSync(SiteContent)({
      ...defaultContent,
      board: [boardMember(name)],
    }),
  );

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(SiteContent));
// Decode the encoded OBJECT a DraftEditor write returns (not a JSON string).
const decodeObject = Schema.decodeUnknownEffect(SiteContent);

/**
 * `DraftEditor` (registration-launch Branch 1) absorbs the inline admin write
 * pipeline. Sub-commit 1.1 introduces the `ContentScope` → `scopeKeys` key-pair
 * machinery and `DraftEditor.load` — the draft/published reconciliation moved
 * verbatim from the old `Content.getAdminContent`. These tests port that
 * reconciliation's contract: draft-newer wins, draft-older / stale draft is
 * ignored, draft-with-no-published is a valid source, and a bucket with nothing
 * falls back to the bundled defaults.
 */

const encode = Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent));
const encodeDraft = Schema.encodeUnknownEffect(
  Schema.fromJsonString(DraftSiteContent),
);

const seededStorage = (
  doc: SiteContentType,
  factory: (json: string) => Layer.Layer<Storage.Service>,
): Layer.Layer<Storage.Service> =>
  Layer.unwrap(encode(doc).pipe(Effect.orDie, Effect.map(factory)));

/**
 * Provide `DraftEditor` (and the `Content` it depends on for `publish`'s
 * cache-bust) over ONE shared in-memory `Storage`, also exposed to the test —
 * so a `put` from the test body hits the same bucket the editor reads.
 */
const provideEditor =
  (storageLayer: Layer.Layer<Storage.Service>) =>
  <A, E>(
    effect: Effect.Effect<
      A,
      E,
      DraftEditor.Service | Content.Service | Storage.Service
    >,
  ) =>
    effect.pipe(
      Effect.provide(
        Layer.provideMerge(
          // `Content.layer` feeds `DraftEditor.layer`'s `Content.Service`
          // requirement (for `publish`'s cache-bust) and stays exposed; both
          // then share the one `storageLayer`.
          Layer.provideMerge(DraftEditor.layer, Content.layer),
          storageLayer,
        ),
      ),
    );

const adminStorage = (objects: Record<string, string>) =>
  layerTest(
    Object.fromEntries(
      Object.entries(objects).map(([key, body]) => [key, { body }]),
    ),
  );

describe('scopeKeys', () => {
  it.effect('the site scope addresses the site draft/published key pair', () =>
    Effect.sync(() => {
      expect(scopeKeys(siteScope)).toEqual({
        draftKey: SITE_CONTENT_DRAFT_KEY,
        publishedKey: SITE_CONTENT_KEY,
      });
    }),
  );

  // Branch 5.2: the widened scope union resolves each page/form to its OWN
  // draft/published key pair (ADR 0008 — one object per page/form), derived from
  // the id through `pages/registry` (`derive-dont-sync`), never the site keys.
  it.effect('a page scope addresses content/pages/<page>(.draft).json', () =>
    Effect.sync(() => {
      expect(scopeKeys(pageScope('faq'))).toEqual({
        draftKey: pageDraftKey('faq'),
        publishedKey: pageObjectKey('faq'),
      });
      expect(scopeKeys(pageScope('faq'))).toEqual({
        draftKey: 'content/pages/faq.draft.json',
        publishedKey: 'content/pages/faq.json',
      });
    }),
  );

  it.effect('a form scope addresses forms/<form>(.draft).json', () =>
    Effect.sync(() => {
      expect(scopeKeys(formScope('contact'))).toEqual({
        draftKey: formDraftKey('contact'),
        publishedKey: formObjectKey('contact'),
      });
      expect(scopeKeys(formScope('contact'))).toEqual({
        draftKey: 'forms/contact.draft.json',
        publishedKey: 'forms/contact.json',
      });
    }),
  );

  it.effect('every scope resolves to a distinct key pair (no collisions)', () =>
    Effect.sync(() => {
      const keys = [
        scopeKeys(siteScope),
        scopeKeys(pageScope('faq')),
        scopeKeys(pageScope('about')),
        scopeKeys(formScope('contact')),
        scopeKeys(formScope('registration')),
      ];
      const published = keys.map((k) => k.publishedKey);
      expect(new Set(published).size).toBe(published.length);
    }),
  );
});

describe('DraftEditor.load (draft → published → defaults reconciliation)', () => {
  it.effect('falls back to the bundled defaults when nothing is stored', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      const result = yield* editor.load(siteScope);
      expect(result.source).toBe('defaults');
      expect(result.content.conferences).toHaveLength(
        defaultContent.conferences.length,
      );
      // The admin view encodes through `DraftSiteContent`; defaults must use the
      // draft-lax field shapes (plain optional strings), not strict `Option`s.
      expect(
        Schema.encodeUnknownSync(DraftSiteContent)(result.content),
      ).toBeDefined();
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect('prefers the published document over the defaults', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      const result = yield* editor.load(siteScope);
      expect(result.source).toBe('published');
    }).pipe(
      provideEditor(
        seededStorage(defaultContent, (published) =>
          adminStorage({ [SITE_CONTENT_KEY]: published }),
        ),
      ),
    ),
  );

  it.effect('uses a draft with no published document as a valid edit source', () =>
    Effect.gen(function* () {
      const draftDoc = draftWithBoard('Draft With No Published');
      const draft = yield* encodeDraft(draftDoc);
      const editor = yield* DraftEditor.Service;
      const storage = yield* Storage.Service;
      yield* storage.put(SITE_CONTENT_DRAFT_KEY, draft, 'application/json');
      const result = yield* editor.load(siteScope);
      expect(result.source).toBe('draft');
      expect(boardNames(result.content.board)).toEqual(['Draft With No Published']);
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect(
    'prefers a draft saved after the last publish over the published document',
    () =>
      Effect.gen(function* () {
        const draftDoc = draftWithBoard('Only In The Draft');
        const draft = yield* encodeDraft(draftDoc);
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;
        // The published document is seeded at epoch; the draft is written AFTER
        // advancing the clock so it is strictly newer — the real "I edited and
        // saved a draft after the last publish" timeline.
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_DRAFT_KEY, draft, 'application/json');
        const result = yield* editor.load(siteScope);
        expect(result.source).toBe('draft');
        expect(boardNames(result.content.board)).toEqual(['Only In The Draft']);
      }).pipe(
        provideEditor(
          seededStorage(defaultContent, (published) =>
            adminStorage({ [SITE_CONTENT_KEY]: published }),
          ),
        ),
      ),
  );

  it.effect(
    'ignores a stale draft that predates the published document (failed-delete / pre-existing draft)',
    () =>
      Effect.gen(function* () {
        const staleDraftDoc = draftWithBoard('Stale Draft Values');
        const publishedDoc = SiteContent.make({
          ...defaultContent,
          board: [boardMember('Freshly Published')],
        });
        const staleDraft = yield* encodeDraft(staleDraftDoc);
        const published = yield* encode(publishedDoc);
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;
        // Draft written first…
        yield* storage.put(SITE_CONTENT_DRAFT_KEY, staleDraft, 'application/json');
        // …then a later publish writes the live document (the draft is left
        // intact, simulating a failed best-effort delete).
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_KEY, published, 'application/json');
        const result = yield* editor.load(siteScope);
        expect(result.source).toBe('published');
        expect(boardNames(result.content.board)).toEqual(['Freshly Published']);
      }).pipe(provideEditor(adminStorage({}))),
  );
});

/** Read a stored object's body as text through `Storage.get`. */
const readStoredText = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const object = yield* storage.get(key);
    return yield* Effect.promise(() => new Response(object.stream).text());
  });

/**
 * The 2026 conference's theme name (EN) on a decoded document — accepts the
 * laxer draft document too (a `DraftEditor.load` now returns `DraftSiteContent`);
 * `themeName` is a strict `Text` in both, so the read is total.
 */
const themeName2026 = (
  doc: SiteContentType | DraftSiteContentType,
): string | undefined =>
  doc.conferences.find((c) => c.slug === '/2026')?.themeName.en;

const seededPublished = (doc: SiteContentType) =>
  provideEditor(
    seededStorage(doc, (published) =>
      adminStorage({ [SITE_CONTENT_KEY]: published }),
    ),
  );

describe('DraftEditor.editDocument (encode → merge → decode → store draft)', () => {
  it.effect(
    'merges the override onto the current document and stores a draft that decodes with the edit',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        // The route's parsed override: rename the 2026 theme, addressed by the
        // conference's `slug` identity (ADR 0006). `assembleOverrides` is the
        // exact parse the migrated route action uses.
        const override = assembleOverrides([
          ['conferences./2026.themeName.en', 'Speak Boldly'],
        ]) as Json;
        // The published doc is seeded at epoch; advance the clock so the draft
        // the edit writes is strictly newer and `load` reopens it.
        yield* TestClock.adjust('1 second');
        const encoded = yield* editor.editDocument(siteScope, override);

        // The returned EncodedDoc carries the edit…
        const returnedDecoded = yield* decodeObject(encoded);
        expect(themeName2026(returnedDecoded)).toBe('Speak Boldly');

        // …and the stored draft is the canonical JSON of the merged document,
        // so a reload (load) reopens it.
        const draftBody = yield* readStoredText(SITE_CONTENT_DRAFT_KEY);
        const storedDraft = yield* decodeJson(draftBody);
        expect(themeName2026(storedDraft)).toBe('Speak Boldly');

        // Every unedited deep field survives the merge (the property the old
        // index-merge had): the 2024 conference is untouched.
        expect(storedDraft.conferences.find((c) => c.slug === '/2024')).toEqual(
          defaultContent.conferences.find((c) => c.slug === '/2024'),
        );

        const reopened = yield* editor.load(siteScope);
        expect(reopened.source).toBe('draft');
        expect(themeName2026(reopened.content)).toBe('Speak Boldly');
      }).pipe(seededPublished(defaultContent)),
  );

  it.effect(
    'rejects an edit that empties a required bilingual field with a 400 IssueError',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        // Blank the 2026 EN theme name — `Text`'s both-locales-non-empty
        // invariant must reject this at the decode boundary.
        const override = assembleOverrides([
          ['conferences./2026.themeName.en', ''],
        ]) as Json;
        const result = yield* Effect.exit(
          editor.editDocument(siteScope, override),
        );
        expect(result._tag).toBe('Failure');
        if (result._tag === 'Failure') {
          const error = result.cause.reasons.find(
            (reason) => reason._tag === 'Fail',
          );
          expect(error).toBeDefined();
          const issueError = (error as { readonly error: DraftEditor.IssueError })
            .error;
          expect(issueError._tag).toBe('DraftEditor.IssueError');
          expect(issueError.status).toBe(400);
          expect(issueError.issues.length).toBeGreaterThan(0);
        }
        // The reject left the bucket untouched: no draft was written.
        const draftHead = yield* (yield* Storage.Service).head(
          SITE_CONTENT_DRAFT_KEY,
        );
        expect(draftHead._tag).toBe('None');
      }).pipe(seededPublished(defaultContent)),
  );
});

describe('DraftEditor.applyImageUpload (rewrite a key on the draft)', () => {
  it.effect('points the targeted key at the uploaded object on the draft', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      // The upload target addresses the team member by its `id` (ADR 0006), not
      // by array position — `setAtPath` rewrites the key on the matching item.
      const member0Id = String(defaultContent.team[0]?.id);
      const target = `team.${member0Id}.photo.key`;
      const key = uploadedImageKey(target, 'image/png', 1_700_000_000_000);
      const encoded = yield* editor.applyImageUpload(siteScope, target, key);

      // The returned EncodedDoc references the new key for team member 0.
      const decoded = yield* decodeObject(encoded);
      expect(String(decoded.team[0]?.photo.key)).toBe(key);

      // The stored draft persists that rewrite.
      const draftBody = yield* readStoredText(SITE_CONTENT_DRAFT_KEY);
      const storedDraft = yield* decodeJson(draftBody);
      expect(String(storedDraft.team[0]?.photo.key)).toBe(key);
    }).pipe(seededPublished(defaultContent)),
  );
});

// ---------------------------------------------------------------------------
// Edit-equivalence corpus — the extraction is behaviour-preserving against the
// deleted inline write path (registration-launch-plan.md:51-52).
//
// `inlineOracle` is a TEST-LOCAL reproduction of the exact algorithm the old
// `admin/content.tsx` action ran for the save/publish intent (verified against
// `feature/registration-launch:app/routes/admin/content.tsx`):
//   base = encodeDocument(current)
//   merged = deepMerge(deepMerge(base, assembleOverrides(entries)),
//                      { translations: collectTranslations(entries) })
//   decoded = decodeDocument(merged)
//   stored  = encodeDocumentJson(decoded)
// The corpus asserts `DraftEditor.editDocument(scope, routeOverride(entries))`
// produces a draft byte-identical to the oracle's `stored` JSON across every
// override shape the route's two override-builders emit: dotted-path leaves,
// translation fields (`t:<locale>:<key>` → `collectTranslations`), numeric
// coercions (bible.chapter/verse), nested hero keys, team fields, and the
// preserved-unedited `registration` Option deep-field survival.
// ---------------------------------------------------------------------------

const encodeObject = Schema.encodeUnknownEffect(SiteContent);
const encodeObjectJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(SiteContent),
);
const decodeMerged = Schema.decodeUnknownEffect(SiteContent);

/** The exact override the migrated route hands `editDocument` (content.tsx:183). */
const routeOverride = (
  entries: ReadonlyArray<readonly [string, string]>,
): Json =>
  deepMerge(assembleOverrides(entries), {
    translations: collectTranslations(entries),
  } as Json);

/** The deleted inline algorithm, reproduced verbatim, returning the stored JSON. */
const inlineOracle = (
  current: SiteContentType,
  entries: ReadonlyArray<readonly [string, string]>,
) =>
  Effect.gen(function* () {
    const base = (yield* encodeObject(current)) as Json;
    const overrides = assembleOverrides(entries);
    const translations = collectTranslations(entries);
    const merged = deepMerge(deepMerge(base, overrides), {
      translations,
    } as Json);
    const decoded = yield* decodeMerged(merged);
    return yield* encodeObjectJson(decoded);
  });

interface CorpusCase {
  readonly name: string;
  readonly entries: ReadonlyArray<readonly [string, string]>;
  /** A field on the decoded result the case proves the edit reached. */
  readonly proof: (doc: SiteContentType) => unknown;
  readonly expected: unknown;
}

// The first team member's id — list items and conferences are addressed by
// stable identity (`team.<id>.…`, `conferences.<slug>.…`), not by array
// position (ADR 0006, sub-commit 2.4).
const member0Id = String(defaultContent.team[0]?.id);

const corpus: readonly CorpusCase[] = [
  {
    name: 'identity-keyed leaf — rename the 2026 theme (EN) by slug',
    entries: [['conferences./2026.themeName.en', 'Speak Boldly']],
    proof: themeName2026,
    expected: 'Speak Boldly',
  },
  {
    name: 'translation field — t:<locale>:<key> folds onto translations.en',
    entries: [[translationFieldName('en', 'main.reserve'), 'Reserve a Spot']],
    proof: (doc) => doc.translations.en['main.reserve'],
    expected: 'Reserve a Spot',
  },
  {
    name: 'translation field — both locales of the same key',
    entries: [
      [translationFieldName('en', 'main.reserve'), 'Reserve a Spot'],
      [translationFieldName('fr', 'main.reserve'), 'Réservez une place'],
    ],
    proof: (doc) => `${doc.translations.en['main.reserve']}|${doc.translations.fr['main.reserve']}`,
    expected: 'Reserve a Spot|Réservez une place',
  },
  {
    name: 'numeric coercion — bible.chapter/verse parse to Int',
    entries: [
      ['conferences./2026.bible.chapter', '3'],
      ['conferences./2026.bible.verse', '16'],
    ],
    proof: (doc) => {
      const c = doc.conferences.find((x) => x.slug === '/2026');
      return `${c?.bible.chapter}/${c?.bible.verse}`;
    },
    expected: '3/16',
  },
  {
    name: 'nested hero key — alt text on a deep hero crop (by slug)',
    entries: [['conferences./2024.hero.desktop.alt.en', 'A brand new alt']],
    proof: (doc) =>
      doc.conferences.find((x) => x.slug === '/2024')?.hero.desktop.alt.en,
    expected: 'A brand new alt',
  },
  {
    name: 'team field — rename a board member by id',
    entries: [[`team.${member0Id}.name`, 'Renamed Member']],
    proof: (doc) => doc.team[0]?.name,
    expected: 'Renamed Member',
  },
  {
    name: 'mixed override — identity-keyed + translation + numeric in one submit',
    entries: [
      ['conferences./2026.themeName.en', 'Combined Edit'],
      ['conferences./2026.bible.verse', '7'],
      [translationFieldName('fr', 'main.reserve'), 'Réservez'],
    ],
    proof: (doc) => {
      const c = doc.conferences.find((x) => x.slug === '/2026');
      return `${c?.themeName.en}|${c?.bible.verse}|${doc.translations.fr['main.reserve']}`;
    },
    expected: 'Combined Edit|7|Réservez',
  },
];

describe('DraftEditor.editDocument equivalence corpus (vs the deleted inline path)', () => {
  for (const testCase of corpus) {
    it.effect(testCase.name, () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        // The seeded published doc is at epoch; advance so the edit's draft is
        // strictly newer and `load` reopens it as the edit source.
        yield* TestClock.adjust('1 second');
        const encoded = yield* editor.editDocument(
          siteScope,
          routeOverride(testCase.entries),
        );

        // (a) The returned EncodedDoc carries the edit.
        const returned = yield* decodeObject(encoded);
        expect(testCase.proof(returned)).toEqual(testCase.expected);

        // (b) The stored draft JSON is BYTE-IDENTICAL to the oracle's output —
        // the extraction is behaviour-preserving against the old inline path.
        const draftBody = yield* readStoredText(SITE_CONTENT_DRAFT_KEY);
        const oracleJson = yield* inlineOracle(
          defaultContent,
          testCase.entries,
        );
        expect(draftBody).toEqual(oracleJson);

        // (c) The preserved-unedited `registration` Option deep-field survives:
        // 2024 carries `Option.some(RegistrationWindows)`; no corpus case edits
        // it, so it round-trips untouched through the merge (the deep-field
        // survival the old index-merge had).
        const storedDraft = yield* decodeJson(draftBody);
        expect(
          storedDraft.conferences.find((c) => c.slug === '/2024')?.registration,
        ).toEqual(
          defaultContent.conferences.find((c) => c.slug === '/2024')
            ?.registration,
        );
      }).pipe(seededPublished(defaultContent)),
    );
  }
});

describe('DraftEditor.publish (promote draft → published, drop draft, bust)', () => {
  it.effect(
    'promotes the current draft to the published key and makes it live on the next public read',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        // Public read starts on the seeded published defaults.
        const before = yield* content.getConference('en', 2026);
        expect(before.title).toBe('Speak');

        // Edit (save a draft) then publish — the two-step the migrated route
        // runs for the Publish intent. Advance the clock so the saved draft is
        // strictly newer than the epoch-seeded published doc and `publish`
        // promotes IT (not the stale published doc).
        const override = assembleOverrides([
          ['conferences./2026.themeName.en', 'Speak Now'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(siteScope, override);
        yield* editor.publish(siteScope);

        // The public read reflects the publish immediately (publish busts the
        // cache) — no TTL advance.
        const after = yield* content.getConference('en', 2026);
        expect(after.title).toBe('Speak Now');

        // The published object carries the edit and the draft was dropped.
        const publishedBody = yield* readStoredText(SITE_CONTENT_KEY);
        const publishedDoc = yield* decodeJson(publishedBody);
        expect(themeName2026(publishedDoc)).toBe('Speak Now');
        const draftHead = yield* (yield* Storage.Service).head(
          SITE_CONTENT_DRAFT_KEY,
        );
        expect(draftHead._tag).toBe('None');

        // The editor now reopens from the published document (no pending draft).
        const reopened = yield* editor.load(siteScope);
        expect(reopened.source).toBe('published');
      }).pipe(seededPublished(defaultContent)),
  );

  it.effect(
    'publishes the just-saved edit even when draft and published share a same-second timestamp (no clock advance)',
    () =>
      // REGRESSION (silent data loss): on a second-granular backend (S3/MinIO)
      // a draft saved and published within the same second has `lastModified`
      // EQUAL to the published doc. The old `publish` routed through `load`,
      // whose strict `draftHead > publishedHead` reconciliation then returned
      // the OLD published doc (draftIsNewer === false), re-published stale
      // content, and deleted the just-saved edit — losing it silently. The
      // fix promotes the draft DIRECTLY. This test asserts that WITHOUT any
      // `TestClock.adjust` between edit and publish: the published seed, the
      // saved draft, and the publish all share epoch's second. It FAILS on the
      // pre-fix code (publishes 'Speak', the stale seed) and passes on the fix.
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const content = yield* Content.Service;

        // NO TestClock.adjust — edit and publish land in the same second as the
        // epoch-seeded published document.
        const override = assembleOverrides([
          ['conferences./2026.themeName.en', 'Same Second Edit'],
        ]) as Json;
        yield* editor.editDocument(siteScope, override);
        yield* editor.publish(siteScope);

        // The published document carries the just-saved edit, NOT the stale seed.
        const publishedBody = yield* readStoredText(SITE_CONTENT_KEY);
        const publishedDoc = yield* decodeJson(publishedBody);
        expect(themeName2026(publishedDoc)).toBe('Same Second Edit');

        // And the public read reflects it (publish busted the cache).
        const after = yield* content.getConference('en', 2026);
        expect(after.title).toBe('Same Second Edit');
      }).pipe(seededPublished(defaultContent)),
  );
});

// ---------------------------------------------------------------------------
// Branch 5.2 — per-OBJECT draft/publish reconciliation (ADR 0008)
//
// The widened `ContentScope` routes every page/form object through the SAME five
// `DraftEditor` calls as the site scope, each with its own draft/published key
// pair, decode boundary, and default. These tests prove the reconciliation
// generalizes per-object BEFORE any route migrates (plan, Branch 5.2): a page
// edit reads/writes ONLY that page's object, never the site object, and the
// decoded content is the page's typed shape (`FaqPage`), not a widened union.
// ---------------------------------------------------------------------------

const encodeFaq = Schema.encodeUnknownEffect(Schema.fromJsonString(FaqPage));
const decodeFaq = Schema.decodeUnknownEffect(Schema.fromJsonString(FaqPage));
const decodeFaqObject = Schema.decodeUnknownEffect(FaqPage);
const decodeFormObject = Schema.decodeUnknownEffect(FormDefinition);

const FAQ_KEY = pageObjectKey('faq');
const FAQ_DRAFT_KEY = pageDraftKey('faq');

/** The FAQ page's EN title on a decoded `FaqPage`. */
const faqTitleEn = (page: FaqPage): string => page.title.en;

describe('DraftEditor.load (per-object: page scope reconciliation)', () => {
  it.effect('falls back to the FAQ page default when nothing is stored', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      const result = yield* editor.load(pageScope('faq'));
      expect(result.source).toBe('defaults');
      // The decoded content is the FAQ page's typed shape — its title round-trips.
      expect(faqTitleEn(result.content)).toBe(defaultFaqPage.title.en);
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect('prefers the published FAQ object over the default', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      const storage = yield* Storage.Service;
      const published = yield* encodeFaq(defaultFaqPage);
      yield* storage.put(FAQ_KEY, published, 'application/json');
      const result = yield* editor.load(pageScope('faq'));
      expect(result.source).toBe('published');
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect('uses a FAQ draft with no published object as a valid source', () =>
    Effect.gen(function* () {
      const draftPage = FaqPage.make({
        ...defaultFaqPage,
        title: { en: 'Draft FAQ', fr: 'FAQ brouillon' },
      });
      const draft = yield* encodeFaq(draftPage);
      const editor = yield* DraftEditor.Service;
      const storage = yield* Storage.Service;
      yield* storage.put(FAQ_DRAFT_KEY, draft, 'application/json');
      const result = yield* editor.load(pageScope('faq'));
      expect(result.source).toBe('draft');
      expect(faqTitleEn(result.content)).toBe('Draft FAQ');
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect(
    'prefers a FAQ draft saved after the last publish; ignores a stale one',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        // Stale draft written first, then a later publish (failed-delete sim).
        const stale = yield* encodeFaq(
          FaqPage.make({
            ...defaultFaqPage,
            title: { en: 'Stale FAQ', fr: 'FAQ périmé' },
          }),
        );
        const fresh = yield* encodeFaq(
          FaqPage.make({
            ...defaultFaqPage,
            title: { en: 'Published FAQ', fr: 'FAQ publié' },
          }),
        );
        yield* storage.put(FAQ_DRAFT_KEY, stale, 'application/json');
        yield* TestClock.adjust('1 second');
        yield* storage.put(FAQ_KEY, fresh, 'application/json');

        const stalePick = yield* editor.load(pageScope('faq'));
        expect(stalePick.source).toBe('published');
        expect(faqTitleEn(stalePick.content)).toBe('Published FAQ');

        // Now a draft written AFTER the publish wins.
        const newer = yield* encodeFaq(
          FaqPage.make({
            ...defaultFaqPage,
            title: { en: 'Newer FAQ', fr: 'FAQ plus récent' },
          }),
        );
        yield* TestClock.adjust('1 second');
        yield* storage.put(FAQ_DRAFT_KEY, newer, 'application/json');
        const newerPick = yield* editor.load(pageScope('faq'));
        expect(newerPick.source).toBe('draft');
        expect(faqTitleEn(newerPick.content)).toBe('Newer FAQ');
      }).pipe(provideEditor(adminStorage({}))),
  );
});

describe('DraftEditor.editDocument / publish (per-object: page scope)', () => {
  it.effect(
    'edits a page draft, reopens it, publishes it to the page object — and busts nothing else',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        // Edit the FAQ page title via the same dotted-override the route emits.
        const override = assembleOverrides([
          ['title.en', 'Frequently Asked Questions'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        const encoded = yield* editor.editDocument(pageScope('faq'), override);

        // The returned encoded object carries the edit and decodes as a FaqPage.
        const returned = yield* decodeFaqObject(encoded);
        expect(faqTitleEn(returned)).toBe('Frequently Asked Questions');

        // The draft was stored at the PAGE's draft key (not the site key).
        const draftBody = yield* readStoredText(FAQ_DRAFT_KEY);
        const storedDraft = yield* decodeFaq(draftBody);
        expect(faqTitleEn(storedDraft)).toBe('Frequently Asked Questions');

        // Reopen reconciles to the draft.
        const reopened = yield* editor.load(pageScope('faq'));
        expect(reopened.source).toBe('draft');
        expect(faqTitleEn(reopened.content)).toBe('Frequently Asked Questions');

        // Publish promotes the draft to the page object and drops the draft.
        yield* editor.publish(pageScope('faq'));
        const publishedBody = yield* readStoredText(FAQ_KEY);
        const publishedPage = yield* decodeFaq(publishedBody);
        expect(faqTitleEn(publishedPage)).toBe('Frequently Asked Questions');
        const draftHead = yield* storage.head(FAQ_DRAFT_KEY);
        expect(draftHead._tag).toBe('None');
      }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect(
    'a page edit never touches the site object (per-object blast-radius isolation)',
    () =>
      // ADR 0008 headline property: editing one object can never break or rewrite
      // another's. Editing + publishing the FAQ page must leave the seeded
      // `content/site.json` byte-identical.
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        const siteBefore = yield* readStoredText(SITE_CONTENT_KEY);

        const override = assembleOverrides([
          ['title.en', 'Edited FAQ Title'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(pageScope('faq'), override);
        yield* editor.publish(pageScope('faq'));

        // The site object is untouched: no site draft was written, and the
        // published site body is byte-identical to the seed.
        const siteDraftHead = yield* storage.head(SITE_CONTENT_DRAFT_KEY);
        expect(siteDraftHead._tag).toBe('None');
        const siteAfter = yield* readStoredText(SITE_CONTENT_KEY);
        expect(siteAfter).toBe(siteBefore);
      }).pipe(seededPublished(defaultContent)),
  );

  it.effect(
    'rejects a page edit that empties a required bilingual field with a 400',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const override = assembleOverrides([['title.en', '']]) as Json;
        const result = yield* Effect.exit(
          editor.editDocument(pageScope('faq'), override),
        );
        expect(result._tag).toBe('Failure');
        if (result._tag === 'Failure') {
          const fail = result.cause.reasons.find((r) => r._tag === 'Fail');
          const issueError = (fail as { readonly error: DraftEditor.IssueError })
            .error;
          expect(issueError.status).toBe(400);
          expect(issueError.issues.length).toBeGreaterThan(0);
        }
      }).pipe(provideEditor(adminStorage({}))),
  );
});

describe('DraftEditor (per-object: form scope)', () => {
  it.effect(
    'edits + publishes a form definition through its own forms/<form> object',
    () =>
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;

        // Load falls back to the bundled form default (typed FormDefinition).
        const loaded = yield* editor.load(formScope('contact'));
        expect(loaded.source).toBe('defaults');
        expect(loaded.content.title.en).toBe(defaultContactForm.title.en);

        // Edit the form copy and publish it to forms/contact.json.
        const override = assembleOverrides([
          ['title.en', 'Get in touch'],
        ]) as Json;
        yield* TestClock.adjust('1 second');
        const encoded = yield* editor.editDocument(
          formScope('contact'),
          override,
        );
        const returned = yield* decodeFormObject(encoded);
        expect(returned.title.en).toBe('Get in touch');

        yield* editor.publish(formScope('contact'));
        const publishedBody = yield* readStoredText(formObjectKey('contact'));
        const publishedForm = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(FormDefinition),
        )(publishedBody);
        expect(publishedForm.title.en).toBe('Get in touch');
      }).pipe(provideEditor(adminStorage({}))),
  );
});
