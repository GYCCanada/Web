import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
} from '../content.server';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import { DraftEditor, scopeKeys, siteScope } from './draft-editor.server';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';
import type { SiteContent as SiteContentType } from './schema';

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

const provideEditor =
  (storageLayer: Layer.Layer<Storage.Service>) =>
  <A, E>(effect: Effect.Effect<A, E, DraftEditor.Service | Storage.Service>) =>
    effect.pipe(
      Effect.provide(Layer.provideMerge(DraftEditor.layer, storageLayer)),
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
