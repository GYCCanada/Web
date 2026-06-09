import { describe, expect, it } from 'bun:test';
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

const run = <A, E>(
  effect: Effect.Effect<A, E, Storage>,
  layer: Layer.Layer<Storage>,
) => Effect.runPromise(Effect.provide(effect, layer));

const runExit = <A, E>(
  effect: Effect.Effect<A, E, Storage>,
  layer: Layer.Layer<Storage>,
) => Effect.runPromise(Effect.exit(Effect.provide(effect, layer)));

const text = (object: { readonly stream: ReadableStream<Uint8Array> }) =>
  new Response(object.stream).text();

describe('Storage.layerTest', () => {
  it('round-trips a put → get → head → list → delete', async () => {
    const result = await run(
      Effect.gen(function* () {
        const storage = yield* Storage;

        yield* storage.put('content/site.json', '{"hello":"world"}', 'application/json');

        const got = yield* storage.get('content/site.json');
        const body = yield* Effect.promise(() => text(got));

        const head = yield* storage.head('content/site.json');
        const listed = yield* storage.list('content/');

        yield* storage.delete('content/site.json');
        const afterDelete = yield* storage.head('content/site.json');

        return { body, got, head, listed, afterDelete };
      }),
      Storage.layerTest(),
    );

    expect(result.body).toBe('{"hello":"world"}');
    expect(result.got.contentType).toBe('application/json');
    expect(result.got.size).toBe(17);

    expect(Option.isSome(result.head)).toBe(true);
    if (Option.isSome(result.head)) {
      expect(result.head.value.size).toBe(17);
      expect(result.head.value.contentType).toBe('application/json');
    }

    expect(result.listed).toEqual([
      {
        key: 'content/site.json',
        size: 17,
        lastModified: result.listed[0]?.lastModified ?? new Date(0),
      },
    ]);

    expect(Option.isNone(result.afterDelete)).toBe(true);
  });

  it('overwrites an existing object on a second put', async () => {
    const body = await run(
      Effect.gen(function* () {
        const storage = yield* Storage;
        yield* storage.put('content/site.json', 'first', 'text/plain');
        yield* storage.put('content/site.json', 'second', 'text/plain');
        const got = yield* storage.get('content/site.json');
        return yield* Effect.promise(() => text(got));
      }),
      Storage.layerTest(),
    );

    expect(body).toBe('second');
  });

  it('serves seeded objects and filters list by prefix', async () => {
    const result = await run(
      Effect.gen(function* () {
        const storage = yield* Storage;
        const images = yield* storage.list('images/');
        const all = yield* storage.list();
        return { images, all };
      }),
      Storage.layerTest({
        'content/site.json': { body: '{}' },
        'images/a.avif': { body: 'a' },
        'images/bb.avif': { body: 'bb' },
      }),
    );

    expect(result.images.map((object) => object.key).sort()).toEqual([
      'images/a.avif',
      'images/bb.avif',
    ]);
    expect(result.images.map((object) => object.size).sort()).toEqual([1, 2]);
    expect(result.all.length).toBe(3);
  });

  it('fails get with NotFound for a missing key', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const storage = yield* Storage;
        return yield* storage.get('missing.json');
      }),
      Storage.layerTest(),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const failedWithNotFound = exit.cause.reasons.some(
        (reason) => reason._tag === 'Fail' && Schema.is(NotFound)(reason.error),
      );
      expect(failedWithNotFound).toBe(true);
    }
  });

  it('reports head as None for a missing key without failing', async () => {
    const head = await run(
      Effect.gen(function* () {
        const storage = yield* Storage;
        return yield* storage.head('missing.json');
      }),
      Storage.layerTest(),
    );

    expect(Option.isNone(head)).toBe(true);
  });

  it('treats delete of a missing key as a no-op', async () => {
    await run(
      Effect.gen(function* () {
        const storage = yield* Storage;
        yield* storage.delete('never-existed.json');
      }),
      Storage.layerTest(),
    );
  });
});

const envFromBucketless = (env: Record<string, string>) =>
  Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

describe('Storage.layer', () => {
  it('fails with StorageUnconfigured when no bucket is configured', async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Storage.asEffect().pipe(
          Effect.provide(
            Storage.layer.pipe(
              Layer.provide(envFromBucketless({ NODE_ENV: 'development' })),
            ),
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
  });

  it('constructs a storage instance when the bucket is configured', async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Storage.asEffect().pipe(
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
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
