import { describe, expect, it } from 'bun:test';
import { Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { Content, SITE_CONTENT_KEY } from '../content.server';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';
import {
  assembleOverrides,
  isAcceptedImageType,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { DraftEditor, siteScope } from './draft-editor.server';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';

/**
 * End-to-end-ish proof of the C5 publish + image paths against the in-memory
 * `layerTest` storage helper (a real S3 / MinIO is not reachable headless in CI).
 * Post-Branch-1 the `/admin/content` route action is auth + a `DraftEditor`
 * call only: this test drives that ONE service — `editDocument` (save draft),
 * `publish` (promote draft → live + bust), `applyImageUpload` (rewrite a key on
 * the draft) — and asserts the public read path reflects the edit WITHOUT a TTL
 * wait or redeploy (D3), and that an uploaded image is retrievable from
 * `Storage.get` under its `images/uploads/<key>`.
 */

// The JSON-string codec (not `JSON.stringify`, per the project lint rule):
// `encodeJson(value)` is exactly the bytes stored at `content/site.json`.
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent));

/** The bundled defaults as the JSON STRING stored at `content/site.json`. */
const seedBody = (): Promise<string> =>
  Effect.runPromise(encodeJson(defaultContent));

/**
 * Wire `DraftEditor` (over the `Content` it depends on) and `Content` itself
 * over ONE shared in-memory bucket, also exposed to the test — so the editor's
 * writes and the public read path hit the same store. `Content.layer` feeds
 * `DraftEditor.layer`'s `Content.Service` requirement and stays exposed.
 */
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    DraftEditor.Service | Content.Service | Storage.Service
  >,
  objects: Record<string, { body: string }> = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(effect, [
        Layer.provideMerge(
          Layer.provideMerge(DraftEditor.layer, Content.layer),
          layerTest(objects),
        ),
        TestClock.layer(),
      ]),
    ),
  );

describe('CMS publish → cache-bust → public read (in-memory bucket, D3)', () => {
  it('an /admin edit is visible on the next public read with no redeploy', async () => {
    const seed = await seedBody();

    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const editor = yield* DraftEditor.Service;

        // 1. The public site reads the seeded defaults.
        const before = yield* content.getConference('en', 2026);

        // 2. The admin edits the 2026 theme name + accent (simulating the form's
        //    parsed override), then publishes — the route's two-step.
        const override = assembleOverrides([
          ['conferences.2.themeName.en', 'Speak Boldly'],
          ['conferences.2.accentColor', '#112233'],
        ]) as Json;
        // Advance so the saved draft is strictly newer than the epoch seed.
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(siteScope, override);
        yield* editor.publish(siteScope);

        // 3. The public site reflects the edit immediately — no TTL advance.
        const after = yield* content.getConference('en', 2026);

        return { before, after };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.before.title).toBe('Speak');
    expect(result.before.theme).toBe(
      String(defaultContent.conferences.find((c) => c.slug === '/2026')?.accentColor),
    );
    expect(result.after.title).toBe('Speak Boldly');
    expect(result.after.theme).toBe('#112233');
  });

  it('save-draft keeps the public read on the published doc until publish', async () => {
    const seed = await seedBody();

    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const editor = yield* DraftEditor.Service;

        // Save a draft that renames 2026 — public read must NOT see it. The
        // draft is saved AFTER the seeded publish (clock advanced) so it is the
        // strictly-newer pending edit the editor should reopen.
        yield* TestClock.adjust('1 second');
        yield* editor.editDocument(
          siteScope,
          assembleOverrides([['conferences.2.themeName.en', 'Draft Only']]) as Json,
        );

        const publicRead = yield* content.getConference('en', 2026);
        const adminRead = yield* editor.load(siteScope);
        return { publicTitle: publicRead.title, adminSource: adminRead.source };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    // Public read stays on the published document; the editor sees the draft.
    expect(result.publicTitle).toBe('Speak');
    expect(result.adminSource).toBe('draft');
  });
});

describe('CMS image upload → /images/<key> retrieval (in-memory bucket)', () => {
  it('stores raw bytes under images/uploads/<key> and serves them back', async () => {
    const seed = await seedBody();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await run(
      Effect.gen(function* () {
        const editor = yield* DraftEditor.Service;
        const storage = yield* Storage.Service;

        // Validate + store the raw upload exactly as the route action does, then
        // rewrite the draft's targeted key via the one service.
        const contentType = 'image/png';
        expect(isAcceptedImageType(contentType)).toBe(true);
        const target = 'team.0.photo.key';
        const key = uploadedImageKey(target, contentType, 1_700_000_000_000);
        yield* storage.put(key, png, contentType);
        // Advance so the draft the rewrite writes is strictly newer than the
        // epoch-seeded published doc and `load` reopens it.
        yield* TestClock.adjust('1 second');
        yield* editor.applyImageUpload(siteScope, target, key);

        // Retrieve through the same `Storage.get` the `GET /images/*` route uses.
        const served = yield* storage.get(key);
        const bytes = new Uint8Array(
          yield* Effect.promise(() =>
            new Response(served.stream).arrayBuffer(),
          ),
        );

        // The reopened draft now references the uploaded key for team member 0.
        const draft = yield* editor.load(siteScope);
        return {
          key,
          servedContentType: served.contentType,
          bytes,
          draftKey: String(draft.content.team[0]?.photo.key),
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(String(result.key)).toBe(
      'images/uploads/team-0-photo-key-1700000000000.png',
    );
    expect(result.servedContentType).toBe('image/png');
    expect([...result.bytes]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(result.draftKey).toBe(result.key);
  });

  it('resolves a managed key to a /images/<key> URL at the Content boundary', async () => {
    const seed = await seedBody();
    const team = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        return yield* content.getTeam();
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );
    expect(team.team[0]?.image).toBe('/images/team/elijah.jpg');
  });
});
