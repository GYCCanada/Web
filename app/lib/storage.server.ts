import {
  Clock,
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
 * `static layer` reads the bucket config off the `Env` service. The bucket is
 * optional everywhere (the CMS degrades to bundled defaults without one), so a
 * `Storage` *instance* is only constructible when a bucket is configured: with
 * `Env.bucket` absent the layer fails with `StorageUnconfigured`, and callers
 * that want the degraded path (the `Content` service) decide not to require
 * `Storage` rather than holding a half-built one
 * (make-impossible-states-unrepresentable).
 *
 * `static layerTest` is an in-memory `Map`, used by the unit tests and by any
 * service-level test that needs a real round-trip without a bucket.
 */

const StorageOp = Schema.Literals(['get', 'put', 'head', 'list', 'delete']);
type StorageOp = typeof StorageOp.Type;

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'gycc/lib/storage.server/StorageError',
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
  'gycc/lib/storage.server/NotFound',
  { key: Schema.String },
) {}

export class StorageUnconfigured extends Schema.TaggedErrorClass<StorageUnconfigured>()(
  'gycc/lib/storage.server/StorageUnconfigured',
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

export interface TestStoredObject {
  readonly body: Uint8Array | string;
  readonly contentType?: string;
  readonly lastModified?: Date;
  readonly etag?: string;
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

const listStoredObjects = Effect.fn('listStoredObjects')(function* (
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

export class Storage extends Context.Service<
  Storage,
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
>()('gycc/lib/storage.server/Storage') {
  static layerTest = (objects: Record<string, TestStoredObject> = {}) =>
    Layer.sync(Storage, () => {
      const entries = new Map<string, Required<TestStoredObject>>();
      for (const [key, object] of Object.entries(objects)) {
        entries.set(key, {
          body: object.body,
          contentType: object.contentType ?? 'application/json',
          lastModified: object.lastModified ?? epoch(),
          etag: object.etag ?? `"${key}"`,
        });
      }

      const bytes = (body: Uint8Array | string): Uint8Array =>
        typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const responseBody = (body: Uint8Array | string): BodyInit =>
        typeof body === 'string'
          ? body
          : new Blob([body as Uint8Array<ArrayBuffer>]);

      return Storage.of({
        get: (key) => {
          const object = entries.get(key);
          if (object === undefined) return Effect.fail(new NotFound({ key }));
          return Effect.sync(() => ({
            stream:
              new Response(responseBody(object.body)).body ??
              new ReadableStream<Uint8Array>(),
            contentType: object.contentType,
            size: bytes(object.body).byteLength,
          }));
        },

        put: (key, body, contentType) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            entries.set(key, {
              body,
              contentType,
              lastModified: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
              etag: `"test-${now}"`,
            });
          }),

        head: (key) =>
          Effect.sync(() => {
            const object = entries.get(key);
            if (object === undefined) return Option.none();
            return Option.some({
              size: bytes(object.body).byteLength,
              contentType: object.contentType,
              lastModified: object.lastModified,
              etag: object.etag,
            });
          }),

        list: (prefix) =>
          Effect.sync(() =>
            [...entries.entries()]
              .filter(([key]) => prefix === undefined || key.startsWith(prefix))
              .map(([key, object]) => ({
                key,
                size: bytes(object.body).byteLength,
                lastModified: object.lastModified,
              })),
          ),

        delete: (key) =>
          Effect.sync(() => {
            entries.delete(key);
          }),
      });
    });

  static layer = Layer.effect(
    Storage,
    Effect.gen(function* () {
      const env = yield* Env;

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

      return Storage.of({
        get: (key) =>
          Effect.gen(function* () {
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
          }),

        put: (key, body, contentType) =>
          Effect.tryPromise({
            try: () => client.write(key, body, { type: contentType }),
            catch: (e) => new StorageError({ key, op: 'put', cause: e }),
          }).pipe(Effect.asVoid),

        head: (key) =>
          Effect.gen(function* () {
            const file = client.file(key);
            const exists = yield* Effect.tryPromise({
              try: () => file.exists(),
              catch: (e) => new StorageError({ key, op: 'head', cause: e }),
            });
            if (!exists) return Option.none();
            const stat = yield* Effect.tryPromise({
              try: () => file.stat(),
              catch: (e) => new StorageError({ key, op: 'head', cause: e }),
            });
            return Option.some({
              size: stat.size,
              contentType:
                stat.type === '' ? 'application/octet-stream' : stat.type,
              lastModified: stat.lastModified,
              etag: stat.etag,
            });
          }),

        list: (prefix) => listStoredObjects(client, prefix),

        delete: (key) =>
          Effect.tryPromise({
            try: () => client.delete(key),
            catch: (e) => new StorageError({ key, op: 'delete', cause: e }),
          }),
      });
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
  static layerOptional = Storage.layer.pipe(
    Layer.catchCause(() =>
      Layer.succeed(
        Storage,
        Storage.of({
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
}
