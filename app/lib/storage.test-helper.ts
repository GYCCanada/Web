import { Clock, DateTime, Effect, Layer, Option } from 'effect';

import {
  type ObjectHead,
  NotFound,
  Storage,
} from './storage.server';

/**
 * In-memory `Storage` test layer (opencode keeps test layers out of the
 * production module, under `test/` — per its AGENTS.md "test real impl"). This
 * is the `Map`-backed fake the unit tests and the service-level round-trip
 * tests provide instead of a real bucket; it lives here so `storage.server.ts`
 * never ships a fake.
 */

export interface TestStoredObject {
  readonly body: Uint8Array | string;
  readonly contentType?: string;
  readonly lastModified?: Date;
  readonly etag?: string;
}

const epoch = (): Date => DateTime.toDateUtc(DateTime.makeUnsafe(0));

export const layerTest = (objects: Record<string, TestStoredObject> = {}) =>
  Layer.sync(Storage.Service, () => {
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

    const get = Effect.fn('Storage.get')(function* (key: string) {
      const object = entries.get(key);
      if (object === undefined) return yield* new NotFound({ key });
      return {
        stream:
          new Response(responseBody(object.body)).body ??
          new ReadableStream<Uint8Array>(),
        contentType: object.contentType,
        size: bytes(object.body).byteLength,
      };
    });

    const put = Effect.fn('Storage.put')(function* (
      key: string,
      body: Uint8Array | string,
      contentType: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      entries.set(key, {
        body,
        contentType,
        lastModified: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
        etag: `"test-${now}"`,
      });
    });

    const head = Effect.fn('Storage.head')((key: string) =>
      Effect.sync(() => {
        const object = entries.get(key);
        if (object === undefined) return Option.none<ObjectHead>();
        return Option.some<ObjectHead>({
          size: bytes(object.body).byteLength,
          contentType: object.contentType,
          lastModified: object.lastModified,
          etag: object.etag,
        });
      }),
    );

    const list = Effect.fn('Storage.list')((prefix?: string) =>
      Effect.sync(() =>
        [...entries.entries()]
          .filter(([key]) => prefix === undefined || key.startsWith(prefix))
          .map(([key, object]) => ({
            key,
            size: bytes(object.body).byteLength,
            lastModified: object.lastModified,
          })),
      ),
    );

    const del = Effect.fn('Storage.delete')((key: string) =>
      Effect.sync(() => {
        entries.delete(key);
      }),
    );

    return Storage.Service.of({ get, put, head, list, delete: del });
  });
