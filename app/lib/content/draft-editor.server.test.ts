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
  uploadedImageKey,
  type Json,
} from './admin-form';
import { DraftEditor, scopeKeys, siteScope } from './draft-editor.server';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';
import type { SiteContent as SiteContentType } from './schema';

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
});

describe('DraftEditor.load (draft → published → defaults reconciliation)', () => {
  it.effect('falls back to the bundled defaults when nothing is stored', () =>
    Effect.gen(function* () {
      const editor = yield* DraftEditor.Service;
      const result = yield* editor.load(siteScope);
      expect(result.source).toBe('defaults');
      expect(result.content).toEqual(defaultContent);
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
      const draftDoc = SiteContent.make({
        ...defaultContent,
        board: ['Draft With No Published'],
      });
      const draft = yield* encode(draftDoc);
      const editor = yield* DraftEditor.Service;
      const storage = yield* Storage.Service;
      yield* storage.put(SITE_CONTENT_DRAFT_KEY, draft, 'application/json');
      const result = yield* editor.load(siteScope);
      expect(result.source).toBe('draft');
      expect(result.content.board).toEqual(['Draft With No Published']);
    }).pipe(provideEditor(adminStorage({}))),
  );

  it.effect(
    'prefers a draft saved after the last publish over the published document',
    () =>
      Effect.gen(function* () {
        const draftDoc = SiteContent.make({
          ...defaultContent,
          board: ['Only In The Draft'],
        });
        const draft = yield* encode(draftDoc);
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;
        // The published document is seeded at epoch; the draft is written AFTER
        // advancing the clock so it is strictly newer — the real "I edited and
        // saved a draft after the last publish" timeline.
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_DRAFT_KEY, draft, 'application/json');
        const result = yield* editor.load(siteScope);
        expect(result.source).toBe('draft');
        expect(result.content.board).toEqual(['Only In The Draft']);
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
        const staleDraftDoc = SiteContent.make({
          ...defaultContent,
          board: ['Stale Draft Values'],
        });
        const publishedDoc = SiteContent.make({
          ...defaultContent,
          board: ['Freshly Published'],
        });
        const staleDraft = yield* encode(staleDraftDoc);
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
        expect(result.content.board).toEqual(['Freshly Published']);
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

/** The 2026 conference's theme name (EN) on a decoded document. */
const themeName2026 = (doc: SiteContentType): string | undefined =>
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
        // The route's parsed override: rename the 2026 theme. `assembleOverrides`
        // is the exact parse the old inline action used.
        const override = assembleOverrides([
          ['conferences.2.themeName.en', 'Speak Boldly'],
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
          ['conferences.2.themeName.en', ''],
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
      const target = 'team.0.photo.key';
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
          ['conferences.2.themeName.en', 'Speak Now'],
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
});
