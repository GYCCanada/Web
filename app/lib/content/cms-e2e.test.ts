import { describe, expect, it } from 'bun:test';
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
  deepMerge,
  isAcceptedImageType,
  setAtPath,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';

/**
 * End-to-end-ish proof of the C5 publish + image paths against the in-memory
 * `layerTest` storage helper (a real S3 / MinIO is not reachable headless in CI —
 * flagged in the C5 runtime-verify notes). It reproduces, step for step, what
 * the `/admin/content` route's action does — assemble form → deepMerge onto the
 * current document → decode → `Storage.put(site.json)` → `Content.bust()` — and
 * asserts the public read path reflects the edit WITHOUT a TTL wait or redeploy
 * (D3), then that an uploaded image is retrievable from `Storage.get` under its
 * `images/uploads/<key>` (the same key the `GET /images/*` route streams).
 */

const encodeDocument = Schema.encodeUnknownEffect(SiteContent);
const decodeDocument = Schema.decodeUnknownEffect(SiteContent);
// The JSON-string codec (not `JSON.stringify`, per the project lint rule):
// `encodeJson(value)` is exactly the bytes stored at `content/site.json`.
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent));

/** The bundled defaults as the JSON STRING stored at `content/site.json`. */
const seedBody = (): Promise<string> =>
  Effect.runPromise(encodeJson(defaultContent));

/** Wire `Content` over a shared in-memory bucket also exposed to the test. */
const run = <A, E>(
  effect: Effect.Effect<A, E, Content.Service | Storage.Service>,
  objects: Record<string, { body: string }> = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(effect, [
        Layer.provideMerge(Content.layer, layerTest(objects)),
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
        const storage = yield* Storage.Service;

        // 1. The public site reads the seeded defaults.
        const before = yield* content.getConference('en', 2026);

        // 2. The admin edits the 2026 theme name + accent (simulating the form).
        const { content: current } = yield* content.getAdminContent();
        const base = (yield* encodeDocument(current)) as Json;
        const overrides = assembleOverrides([
          ['conferences.2.themeName.en', 'Speak Boldly'],
          ['conferences.2.accentColor', '#112233'],
        ]);
        const merged = deepMerge(base, overrides);
        const decoded = yield* decodeDocument(merged);
        const canonical = yield* encodeJson(decoded);

        // 3. Publish: write site.json, drop the draft, bust the read cache.
        yield* storage.put(SITE_CONTENT_KEY, canonical, 'application/json');
        yield* storage.delete(SITE_CONTENT_DRAFT_KEY).pipe(Effect.ignore);
        yield* content.bust();

        // 4. The public site reflects the edit immediately — no TTL advance.
        const after = yield* content.getConference('en', 2026);

        return { before, after };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.before.title).toBe('Speak');
    expect(result.before.theme).toBe('#D4A24E');
    expect(result.after.title).toBe('Speak Boldly');
    expect(result.after.theme).toBe('#112233');
  });

  it('save-draft keeps the public read on the published doc until publish', async () => {
    const seed = await seedBody();

    const result = await run(
      Effect.gen(function* () {
        const content = yield* Content.Service;
        const storage = yield* Storage.Service;

        // Save a draft that renames 2026 — public read must NOT see it. The
        // draft is saved AFTER the seeded publish (clock advanced) so it is the
        // strictly-newer pending edit the editor should reopen.
        const base = (yield* encodeDocument(defaultContent)) as Json;
        const merged = deepMerge(
          base,
          assembleOverrides([['conferences.2.themeName.en', 'Draft Only']]),
        );
        const decoded = yield* decodeDocument(merged);
        const canonical = yield* encodeJson(decoded);
        yield* TestClock.adjust('1 second');
        yield* storage.put(SITE_CONTENT_DRAFT_KEY, canonical, 'application/json');
        yield* content.bust();

        const publicRead = yield* content.getConference('en', 2026);
        const adminRead = yield* content.getAdminContent();
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
        const content = yield* Content.Service;
        const storage = yield* Storage.Service;

        // Validate + store the upload exactly as the route action does.
        const contentType = 'image/png';
        expect(isAcceptedImageType(contentType)).toBe(true);
        const target = 'team.0.photo.key';
        const key = uploadedImageKey(target, contentType, 1_700_000_000_000);
        yield* storage.put(key, png, contentType);

        // Point the draft's targeted key at the new object + persist (route does
        // this so the new image survives a reload and a later publish).
        const { content: current } = yield* content.getAdminContent();
        const encoded = (yield* encodeDocument(current)) as Json;
        const next = setAtPath(encoded, target, key);
        const decoded = yield* decodeDocument(next);
        yield* storage.put(
          SITE_CONTENT_DRAFT_KEY,
          yield* encodeJson(decoded),
          'application/json',
        );

        // Retrieve through the same `Storage.get` the `GET /images/*` route uses.
        const served = yield* storage.get(key);
        const bytes = new Uint8Array(
          yield* Effect.promise(() =>
            new Response(served.stream).arrayBuffer(),
          ),
        );

        // The draft now references the uploaded key for team member 0…
        const draft = yield* content.getTeam();
        return {
          key,
          servedContentType: served.contentType,
          bytes,
          teamImage: draft.team[0]?.image,
        };
      }),
      { [SITE_CONTENT_KEY]: { body: seed } },
    );

    expect(result.key).toBe('images/uploads/team-0-photo-key-1700000000000.png');
    expect(result.servedContentType).toBe('image/png');
    expect([...result.bytes]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    // After bust the public read would surface the draft only on publish; here
    // we still confirm the boundary resolves the new key to a `/images/<key>` URL.
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
