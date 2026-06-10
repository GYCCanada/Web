export * as Storage from './storage.server';

import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';

import { Env } from './env.server';

/**
 * Object-storage service over Bun's native `S3Client` (ADR 0004 / CMS decision
 * D4 — Railway first-party Buckets, no `@aws-sdk`). A narrow surface — `get`,
 * `put`, `head`, `list`, `delete` — that the `Content`/admin layers build on
 * (small-interface-deep-implementation).
 *
 * The module-level `layer` reads the bucket config off the `Env` service
 * (opencode's strongest service convention — `export const layer` /
 * `export const defaultLayer`, `packages/core/src/git.ts:347`, vs a `static`
 * member). The bucket is optional everywhere (the CMS degrades to bundled
 * defaults without one), so a `Storage` *instance* is only constructible when a
 * bucket is configured: with `Env.bucket` absent the layer fails with
 * `StorageUnconfigured`, and callers that want the degraded path (the `Content`
 * service) decide not to require `Storage` rather than holding a half-built one
 * (make-impossible-states-unrepresentable).
 *
 * The in-memory test layer lives in `storage.test-helper.ts` (opencode keeps
 * test layers under `test/`, per its AGENTS.md "test real impl"), so the
 * production module never ships a `Map`-backed fake.
 */

const StorageOp = Schema.Literals(['get', 'put', 'head', 'list', 'delete']);
type StorageOp = typeof StorageOp.Type;

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'Storage.Error',
  {
    key: Schema.String,
    op: StorageOp,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * Structured not-found predicate over Bun's S3 error, mirroring opencode's
 * `missing()` (`packages/opencode/src/storage/storage.ts:67-74`,
 * `packages/core/src/fs-util.ts:114`) which matches on `err.code === 'ENOENT'`
 * rather than substring-matching a stringified error.
 *
 * Bun raises a structured `S3Error` (an `Error` with `name === 'S3Error'`) for
 * S3-protocol failures, carrying the upstream S3 XML `<Code>` as a `code`
 * field — `'NoSuchKey'` for a missing object (confirmed against the runtime;
 * `Bun.S3Error` is not an exported constructor in Bun 1.3.x, so we match the
 * structured field instead of `instanceof`).
 */
const isNoSuchKey = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  'code' in e &&
  (e as { readonly code?: unknown }).code === 'NoSuchKey';

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  'Storage.NotFound',
  { key: Schema.String },
) {}

export class StorageUnconfigured extends Schema.TaggedErrorClass<StorageUnconfigured>()(
  'Storage.Unconfigured',
  {},
) {}

export interface StoredObject {
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly size: number;
}

export interface ObjectHead {
  readonly size: number;
  readonly contentType: string;
  readonly lastModified: Date;
  readonly etag: string;
}

export interface ListedObject {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

type ListClient = {
  readonly list: (input: {
    readonly prefix?: string;
    readonly continuationToken?: string;
  }) => Promise<{
    readonly contents?: readonly {
      readonly key: string;
      readonly size?: number;
      readonly lastModified?: string;
    }[];
    readonly nextContinuationToken?: string;
  }>;
};

const epoch = (): Date => DateTime.toDateUtc(DateTime.makeUnsafe(0));

const listStoredObjects = Effect.fnUntraced(function* (
  client: ListClient,
  prefix: string | undefined,
) {
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = yield* Effect.tryPromise({
      try: () => client.list({ prefix, continuationToken }),
      catch: (e) => new StorageError({ key: prefix ?? '', op: 'list', cause: e }),
    });
    for (const item of page.contents ?? []) {
      objects.push({
        key: item.key,
        size: item.size ?? 0,
        lastModified:
          item.lastModified !== undefined
            ? DateTime.toDateUtc(DateTime.makeUnsafe(item.lastModified))
            : epoch(),
      });
    }
    continuationToken = page.nextContinuationToken;
  } while (continuationToken !== undefined);
  return objects;
});

export class Service extends Context.Service<
  Service,
  {
    readonly get: (key: string) => Effect.Effect<StoredObject, StorageError | NotFound>;
    readonly put: (
      key: string,
      body: Uint8Array | string,
      contentType: string,
    ) => Effect.Effect<void, StorageError>;
    readonly head: (
      key: string,
    ) => Effect.Effect<Option.Option<ObjectHead>, StorageError>;
    readonly list: (prefix?: string) => Effect.Effect<readonly ListedObject[], StorageError>;
    readonly delete: (key: string) => Effect.Effect<void, StorageError>;
  }
>()('gycc/lib/storage.server/Service') {}

/**
 * The bucket-backed `Storage`, reading its config off `Env` (opencode's
 * module-level `export const layer`, `packages/core/src/git.ts:79`). When
 * `Env.bucket` is absent it fails with `StorageUnconfigured`; callers that want
 * the degraded path compose `layerOptional` instead of holding a half-built
 * instance (`make-impossible-states-unrepresentable`).
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;

    if (Option.isNone(env.bucket)) {
      return yield* new StorageUnconfigured();
    }

    const config = env.bucket.value;
    const client = new Bun.S3Client({
      endpoint: config.endpoint,
      accessKeyId: Redacted.value(config.accessKeyId),
      secretAccessKey: Redacted.value(config.secretAccessKey),
      bucket: config.bucket,
      region: config.region,
    });

    const get = Effect.fn('Storage.get')(function* (key: string) {
      const file = client.file(key);
      const stat = yield* Effect.tryPromise({
        try: () => file.stat(),
        catch: (e) =>
          isNoSuchKey(e)
            ? new NotFound({ key })
            : new StorageError({ key, op: 'get', cause: e }),
      });
      return {
        stream: file.stream(),
        contentType: stat.type === '' ? 'application/octet-stream' : stat.type,
        size: stat.size,
      };
    });

    const put = Effect.fn('Storage.put')(function* (
      key: string,
      body: Uint8Array | string,
      contentType: string,
    ) {
      yield* Effect.tryPromise({
        try: () => client.write(key, body, { type: contentType }),
        catch: (e) => new StorageError({ key, op: 'put', cause: e }),
      });
    });

    const head = Effect.fn('Storage.head')(function* (key: string) {
      const file = client.file(key);
      const exists = yield* Effect.tryPromise({
        try: () => file.exists(),
        catch: (e) => new StorageError({ key, op: 'head', cause: e }),
      });
      if (!exists) return Option.none<ObjectHead>();
      const stat = yield* Effect.tryPromise({
        try: () => file.stat(),
        catch: (e) => new StorageError({ key, op: 'head', cause: e }),
      });
      return Option.some<ObjectHead>({
        size: stat.size,
        contentType: stat.type === '' ? 'application/octet-stream' : stat.type,
        lastModified: stat.lastModified,
        etag: stat.etag,
      });
    });

    const list = Effect.fn('Storage.list')(function* (prefix?: string) {
      return yield* listStoredObjects(client, prefix);
    });

    const del = Effect.fn('Storage.delete')(function* (key: string) {
      yield* Effect.tryPromise({
        try: () => client.delete(key),
        catch: (e) => new StorageError({ key, op: 'delete', cause: e }),
      });
    });

    return Service.of({ get, put, head, list, delete: del });
  }),
);

/**
 * A `Storage` that never fails to *build*: it uses the real bucket-backed
 * `layer` when a bucket is configured, and a **disabled** in-bucket-less
 * instance otherwise (where every read reports `NotFound` and every write
 * fails `StorageError`). This is the layer the always-on `Content` service
 * (C3) composes: the CMS is optional everywhere, so `Storage` must be present
 * in the application context even without a bucket — callers then degrade to
 * bundled defaults on the `NotFound`, rather than the whole runtime failing to
 * build on `StorageUnconfigured` (`make-impossible-states-unrepresentable`,
 * D3). The admin write path (C4/C5) is only reachable when a bucket *is*
 * configured, so the disabled writes are unreachable there.
 */
export const layerOptional = layer.pipe(
  Layer.catchCause(() =>
    Layer.succeed(
      Service,
      Service.of({
        get: (key) => Effect.fail(new NotFound({ key })),
        put: (key) =>
          Effect.fail(
            new StorageError({
              key,
              op: 'put',
              cause: new Error('storage unconfigured'),
            }),
          ),
        head: () => Effect.succeed(Option.none()),
        list: () => Effect.succeed([]),
        delete: () => Effect.void,
      }),
    ),
  ),
);

/**
 * The self-contained, never-fails-to-build `Storage` (opencode's
 * `export const defaultLayer`, `packages/core/src/git.ts:347`): `layerOptional`
 * with its `Env` dependency pre-provided. The standalone consumers that need a
 * `Storage` without separately wiring `Env` — the `/images/*` route in
 * `server.ts` and the `/admin` write path — provide this directly. (`Content`
 * composes `layerOptional` on its own `defaultLayer` instead, sharing `Env`
 * with the rest of the app runtime.)
 */
export const defaultLayer = layerOptional.pipe(Layer.provide(Env.defaultLayer));
