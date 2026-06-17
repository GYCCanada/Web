import { describe, expect, it } from 'bun:test';
import { DateTime, Effect, Layer, Option, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { defaultRegistrationForm } from '../content/pages/defaults';
import { formValidationError } from '../effect/errors';
import {
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { type ObjectHead, NotFound, Storage, StorageError } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { registrationAction } from './registration-action';
import { submissionSchema } from './submission';
import type { Submission } from './submission';

/**
 * Branch 7.3 — the registration ACTION's own persist-then-notify orchestration.
 *
 * Registration is the one form whose payload is NOT a flat field graph but the
 * repeating `{ registrants: Registrant[] }` shell, so it does NOT flow through
 * the flat `formAction` skeleton (proven in `action.test.ts`): it owns
 * `registrationAction`, the slice's headline net-new server path (settled #9).
 * The service-level `Submissions.persist` round-trip is pinned in
 * `submissions.server.test.ts`; here we pin the ACTION's distinct code path —
 * the parts `formAction` does not exercise:
 *   - decoding the `{ registrants: Array(definitionToSchema(def)) }` shell from
 *     the conform-parsed bracket payload (`registrants[n].field`);
 *   - the per-registrant persist LOOP — N registrants → N distinct durable
 *     `submissions/registration/<id>.json` objects;
 *   - persist-FIRST, notify-SECOND ordering for THIS path: `notify` receives the
 *     STORED `Submission[]`, and a notify failure still leaves every record on
 *     the bucket (settled #8 — losing a registrant must never look like success).
 *
 * The action runs through the real request runtime over `makeAppLayer` with an
 * IN-MEMORY `Storage` (`layerTest`) so the loop's writes succeed end-to-end and
 * the test reads the SAME bucket back through that SAME runtime — the seam this
 * commit added. A single `makeRequestRuntimeFromLayer` call closes over ONE
 * `ManagedRuntime`/bucket and applies the redirect→`Response` mapping (so the
 * happy-path terminal `toast.redirect` surfaces as a 302), and the readback runs
 * through its `.run` too, hitting that same in-memory bucket.
 */

/** The success copy every year shell shares (mirrors `registration-route.ts`). */
const success = {
  title: 'registration.form.success.title',
  description: 'registration.form.success.description',
} as const;

/**
 * One valid `exhibitor` registrant in conform bracket notation
 * (`registrants[i].field`) — the simpler variant (base name/email/phone +
 * synopsis/website/company, no nested attendee graph), the same fixture shape
 * `submissions.server.test.ts` persists. `parseSubmission` reconstructs these
 * keys into `{ registrants: [{...}, ...] }`, exactly as the live form POSTs.
 */
const exhibitorFields = (i: number): Record<string, string> => {
  const base = {
    name: `Booth Co. ${i}`,
    email: `booth${i}@example.com`,
    phone: '123-456-7890',
    type: 'exhibitor',
    synopsis: 'We sell health books.',
    website: 'https://example.com',
    company: `Booth Co. ${i} Ltd.`,
  };
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [`registrants[${i}].${key}`, value]),
  );
};

/** A POST body carrying `count` valid exhibitor registrants. */
const registrantsBody = (count: number): URLSearchParams =>
  new URLSearchParams(
    Object.assign({}, ...Array.from({ length: count }, (_, i) => exhibitorFields(i))),
  );

/**
 * Build the `RouteArgs` for a registration POST whose `context.runtime` is the
 * shared `RequestRuntime` — so the action runs over the same in-memory bucket the
 * test reads back, and the redirect→`Response` mapping is the production one.
 */
const makeRegistrationArgs = (
  runtime: RequestRuntime,
  body: URLSearchParams,
): RouteArgs => {
  const url = 'http://localhost/2026/form';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const context = new RouterContextProvider();
  context.runtime = runtime;
  return {
    request,
    url: new URL(url),
    pattern: '/2026/form',
    params: {},
    context,
  };
};

/**
 * List + JSON-decode every persisted registration record on the shared bucket,
 * routed through the SAME `RequestRuntime.run` the action used (so it sees the
 * same in-memory `Storage`). `args` only carries the `ReactRouterContext` the
 * `run` contract requires; the Storage read ignores it.
 */
const listRegistrations = (runtime: RequestRuntime, args: RouteArgs) =>
  runtime.run(
    args,
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const listed = yield* storage.list('submissions/registration/');
      const decode = Schema.decodeUnknownEffect(
        Schema.fromJsonString(submissionSchema(defaultRegistrationForm)),
      );
      return yield* Effect.forEach(listed, (entry) =>
        Effect.gen(function* () {
          const object = yield* storage.get(entry.key);
          const text = yield* Effect.promise(() =>
            new Response(object.stream).text(),
          );
          return { key: entry.key, record: yield* decode(text) };
        }),
      );
    }),
  );

describe('registrationAction', () => {
  it('persists EACH registrant as its own record, then notifies with the stored Submission[]', async () => {
    // ONE runtime over ONE in-memory bucket, shared by the action + the readback.
    const runtime = makeRequestRuntimeFromLayer(makeAppLayer(layerTest({})));
    let notified: ReadonlyArray<Submission> | undefined;

    const action = registrationAction({
      notify: (submissions) =>
        Effect.sync(() => {
          notified = submissions;
        }),
      success,
    });

    const args = makeRegistrationArgs(runtime, registrantsBody(2));

    let thrown: unknown;
    try {
      await action(args);
    } catch (error) {
      thrown = error;
    }

    // The terminal toast.redirect fails with a RedirectError the runtime maps to
    // a 302 redirect Response with the success-toast cookie.
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/2026/form');
    expect(response.headers.get('set-cookie')).toContain('toast');

    // (a) TWO distinct durable objects landed, one per registrant, each decoding
    // back to the submitted payload through the definition-derived schema.
    const stored = await listRegistrations(runtime, args);
    expect(stored.length).toBe(2);
    const keys = stored.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(2);
    for (const { key } of stored) {
      expect(key).toMatch(/^submissions\/registration\/.+\.json$/);
    }
    const companies = stored
      .map((entry) => entry.record.payload['company'])
      .sort();
    expect(companies).toEqual(['Booth Co. 0 Ltd.', 'Booth Co. 1 Ltd.']);

    // (b) notify received the STORED records — real branded ids + the closed form,
    // the source of truth its email references (settled #8). The ids the notify
    // saw are exactly the two on the bucket.
    expect(notified?.length).toBe(2);
    expect(notified?.every((s) => s.form === 'registration')).toBe(true);
    expect(notified?.every((s) => typeof s.id === 'string')).toBe(true);
    expect(new Set(notified?.map((s) => s.id)).size).toBe(2);
    const storedIds = new Set(stored.map((entry) => entry.record.id));
    expect(notified?.every((s) => storedIds.has(s.id))).toBe(true);
  });

  it('a RETRY after a mid-loop persist failure does NOT duplicate the records that landed (idempotency)', async () => {
    // A `Storage` over a SHARED `Map` (so a retry sees what the first attempt
    // wrote) whose `put` fails on demand — to simulate the deep review's escalated
    // partial write: registrant #1 lands, #2's put fails, the loop aborts.
    const entries = new Map<string, { body: string | Uint8Array; contentType: string }>();
    let failPutsAfter = Infinity;
    let puts = 0;
    const sharedStorage = Layer.sync(Storage.Service, () =>
      Storage.Service.of({
        get: Effect.fn('Storage.get')(function* (key: string) {
          const object = entries.get(key);
          if (object === undefined) return yield* new NotFound({ key });
          return {
            stream:
              new Response(
                typeof object.body === 'string'
                  ? object.body
                  : new Blob([object.body as Uint8Array<ArrayBuffer>]),
              ).body ?? new ReadableStream<Uint8Array>(),
            contentType: object.contentType,
            size: new TextEncoder().encode(String(object.body)).byteLength,
          };
        }),
        put: Effect.fn('Storage.put')(function* (
          key: string,
          body: string | Uint8Array,
          contentType: string,
        ) {
          puts += 1;
          if (puts > failPutsAfter) {
            return yield* new StorageError({ key, op: 'put' });
          }
          entries.set(key, { body, contentType });
        }),
        head: Effect.fn('Storage.head')((key: string) =>
          Effect.sync(() =>
            entries.has(key)
              ? Option.some<ObjectHead>({
                  size: 0,
                  contentType: 'application/json',
                  lastModified: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
                  etag: `"${key}"`,
                })
              : Option.none<ObjectHead>(),
          ),
        ),
        list: Effect.fn('Storage.list')((prefix?: string) =>
          Effect.sync(() =>
            [...entries.keys()]
              .filter((key) => prefix === undefined || key.startsWith(prefix))
              .map((key) => ({
                key,
                size: 0,
                lastModified: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
              })),
          ),
        ),
        delete: Effect.fn('Storage.delete')((key: string) =>
          Effect.sync(() => {
            entries.delete(key);
          }),
        ),
      }),
    );

    const runtime = makeRequestRuntimeFromLayer(makeAppLayer(sharedStorage));
    const action = registrationAction({ notify: () => Effect.void, success });

    // Attempt 1: a group of 3 where the 2nd registrant's put fails mid-loop.
    failPutsAfter = 1; // registrant #0 persists; #1's put fails → loop aborts.
    const body = registrantsBody(3);
    let thrown: unknown;
    try {
      await action(makeRegistrationArgs(runtime, body));
    } catch (error) {
      thrown = error;
    }
    // The StorageError aborts the submission — the runtime maps it to a 500, NOT a
    // 302 success redirect (the submit did not succeed).
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(500);
    // Exactly one record landed before the failure.
    const argsForRead = makeRegistrationArgs(runtime, body);
    const afterFailure = await listRegistrations(runtime, argsForRead);
    expect(afterFailure.length).toBe(1);
    const firstKey = afterFailure[0]?.key ?? '';

    // Attempt 2: the user retries the SAME submission, storage now healthy.
    failPutsAfter = Infinity;
    const retryThrown = await action(makeRegistrationArgs(runtime, body)).catch(
      (e) => e,
    );
    // Now it completes → redirect.
    expect(retryThrown).toBeInstanceOf(Response);
    expect((retryThrown as Response).status).toBe(302);

    // The bucket holds EXACTLY 3 records, not 4 — registrant #0 was OVERWRITTEN in
    // place (same content-addressed id), not duplicated, and #1/#2 completed.
    const afterRetry = await listRegistrations(runtime, argsForRead);
    expect(afterRetry.length).toBe(3);
    // The record that survived attempt 1 kept its key (idempotent overwrite).
    expect(afterRetry.map((e) => e.key)).toContain(firstKey);
    // All three companies present exactly once.
    const companies = afterRetry
      .map((e) => e.record.payload['company'])
      .sort();
    expect(companies).toEqual([
      'Booth Co. 0 Ltd.',
      'Booth Co. 1 Ltd.',
      'Booth Co. 2 Ltd.',
    ]);
  });

  it('the same submission re-derives the SAME record ids (deterministic, content-addressed)', async () => {
    const ids = async (): Promise<ReadonlyArray<string>> => {
      const runtime = makeRequestRuntimeFromLayer(makeAppLayer(layerTest({})));
      const action = registrationAction({ notify: () => Effect.void, success });
      const body = registrantsBody(2);
      await action(makeRegistrationArgs(runtime, body)).catch(() => {});
      const stored = await listRegistrations(
        runtime,
        makeRegistrationArgs(runtime, body),
      );
      return stored.map((e) => e.record.id).sort();
    };
    // Two independent submissions of the identical payload yield the identical
    // ids — the id is derived from the submission content + index, not random.
    expect(await ids()).toEqual(await ids());
  });

  it('a notify failure still leaves BOTH registration records on the bucket (persist-first)', async () => {
    const runtime = makeRequestRuntimeFromLayer(makeAppLayer(layerTest({})));

    const action = registrationAction({
      notify: () =>
        Effect.fail(
          formValidationError({ formErrors: ['registration.form.error'] }),
        ),
      success,
    });

    const args = makeRegistrationArgs(runtime, registrantsBody(2));
    const result = await action(args);

    // notify failed → form-level error report, no redirect.
    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['registration.form.error']);

    // Both records are STILL on the bucket — they were persisted BEFORE notify ran,
    // so a notify failure provably cannot lose a registration (settled #8).
    const stored = await listRegistrations(runtime, args);
    expect(stored.length).toBe(2);
    expect(new Set(stored.map((entry) => entry.record.id)).size).toBe(2);
  });
});
