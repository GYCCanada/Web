import { describe, expect, it } from 'effect-bun-test';
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from 'effect';

import { Env } from './env.server';
import { NotFound, Storage, StorageUnconfigured } from './storage.server';
import { layerTest } from './storage.test-helper';

const provide = (layer: Layer.Layer<Storage.Service>) => Effect.provide(layer);

const text = (object: { readonly stream: ReadableStream<Uint8Array> }) =>
  new Response(object.stream).text();

/**
 * Fallback for the `lastModified` echo assertion below — only used when
 * `listed[0]` is unexpectedly absent. Built outside the Effect context (the
 * project's lint represents dates as `DateTime` *inside* effects).
 */
const EPOCH = new Date(0);

describe('Storage in-memory test layer', () => {
  it.effect('round-trips a put → get → head → list → delete', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;

      yield* storage.put('content/site.json', '{"hello":"world"}', 'application/json');

      const got = yield* storage.get('content/site.json');
      const body = yield* Effect.promise(() => text(got));

      const head = yield* storage.head('content/site.json');
      const listed = yield* storage.list('content/');

      yield* storage.delete('content/site.json');
      const afterDelete = yield* storage.head('content/site.json');

      expect(body).toBe('{"hello":"world"}');
      expect(got.contentType).toBe('application/json');
      expect(got.size).toBe(17);

      expect(Option.isSome(head)).toBe(true);
      if (Option.isSome(head)) {
        expect(head.value.size).toBe(17);
        expect(head.value.contentType).toBe('application/json');
      }

      expect(listed).toEqual([
        {
          key: 'content/site.json',
          size: 17,
          lastModified: listed[0]?.lastModified ?? EPOCH,
        },
      ]);

      expect(Option.isNone(afterDelete)).toBe(true);
    }).pipe(provide(layerTest())));

  it.effect('overwrites an existing object on a second put', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      yield* storage.put('content/site.json', 'first', 'text/plain');
      yield* storage.put('content/site.json', 'second', 'text/plain');
      const got = yield* storage.get('content/site.json');
      const body = yield* Effect.promise(() => text(got));

      expect(body).toBe('second');
    }).pipe(provide(layerTest())));

  it.effect('serves seeded objects and filters list by prefix', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const images = yield* storage.list('images/');
      const all = yield* storage.list();

      expect(images.map((object) => object.key).sort()).toEqual([
        'images/a.avif',
        'images/bb.avif',
      ]);
      expect(images.map((object) => object.size).sort()).toEqual([1, 2]);
      expect(all.length).toBe(3);
    }).pipe(
      provide(
        layerTest({
          'content/site.json': { body: '{}' },
          'images/a.avif': { body: 'a' },
          'images/bb.avif': { body: 'bb' },
        }),
      ),
    ));

  it.effect('fails get with NotFound for a missing key', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const error = yield* Effect.flip(storage.get('missing.json'));
      expect(error).toBeInstanceOf(NotFound);
    }).pipe(provide(layerTest())));

  it.effect('reports head as None for a missing key without failing', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const head = yield* storage.head('missing.json');

      expect(Option.isNone(head)).toBe(true);
    }).pipe(provide(layerTest())));

  it.effect('treats delete of a missing key as a no-op', () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      yield* storage.delete('never-existed.json');
    }).pipe(provide(layerTest())));
});

const envFromBucketless = (env: Record<string, string>) =>
  Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

describe('Storage.layer', () => {
  it.effect('fails with StorageUnconfigured when no bucket is configured', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Storage.Service.pipe(
          Effect.provide(
            Storage.layer.pipe(
              Layer.provide(envFromBucketless({ NODE_ENV: 'development' })),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const unconfigured = exit.cause.reasons.some(
          (reason) =>
            reason._tag === 'Fail' && Schema.is(StorageUnconfigured)(reason.error),
        );
        expect(unconfigured).toBe(true);
      }
    }));

  it.effect('constructs a storage instance when the bucket is configured', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Storage.Service.pipe(
          Effect.provide(
            Storage.layer.pipe(
              Layer.provide(
                envFromBucketless({
                  NODE_ENV: 'development',
                  BUCKET_ENDPOINT: 'https://s3.example.com',
                  BUCKET_ACCESS_KEY: 'akid',
                  BUCKET_SECRET_KEY: 'secret-key',
                  BUCKET_NAME: 'gycc-content',
                }),
              ),
            ),
          ),
        ),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }));
});
