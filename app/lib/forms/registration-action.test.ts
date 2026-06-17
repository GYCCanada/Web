import { describe, expect, it } from 'bun:test';
import { Effect, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { defaultRegistrationForm } from '../content/pages/defaults';
import { formValidationError } from '../effect/errors';
import {
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { Storage } from '../storage.server';
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
