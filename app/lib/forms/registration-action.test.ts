import { describe, expect, it } from 'bun:test';
import { Effect, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { formValidationError } from '../effect/errors';
import {
  makeTestAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { layerTest } from '../storage.test-helper';

import { Forms } from './forms.server';
import { registrationAction } from './registration-action';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
  newSubmissionCommandFields,
  type SubmissionCommandFields,
} from './submission-command';

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
 * The action runs through the real request runtime over `makeTestAppLayer` so the
 * published definition version, atomic group commit, retry, and notification all
 * share one relational Forms implementation. A single
 * `makeRequestRuntimeFromLayer` call also applies the redirect→`Response` mapping,
 * so the happy-path terminal `toast.redirect` surfaces as a 302.
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
const registrantsBody = (
  count: number,
  command: SubmissionCommandFields,
): URLSearchParams =>
  new URLSearchParams(
    Object.assign(
      {},
      ...Array.from({ length: count }, (_, i) => exhibitorFields(i)),
      {
        [FORM_VERSION_FIELD]: command.definitionVersion,
        [IDEMPOTENCY_TOKEN_FIELD]: command.idempotencyToken,
      },
    ),
  );

const makeRegistrationHarness = async () => {
  const appLayer = makeTestAppLayer(layerTest({}));
  const managed = ManagedRuntime.make(appLayer);
  const published = await managed.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Forms.Service).current('registration');
    }),
  );
  return {
    runtime: makeRequestRuntimeFromLayer(appLayer),
    command: newSubmissionCommandFields(published.version),
  };
};

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

describe('registrationAction', () => {
  it('persists EACH registrant as its own record, then notifies with the stored Submission[]', async () => {
    const { runtime, command } = await makeRegistrationHarness();
    let notified: ReadonlyArray<Forms.Submission<'registration'>> | undefined;

    const action = registrationAction({
      notify: (submissions) =>
        Effect.sync(() => {
          notified = submissions;
        }),
      success,
    });

    const args = makeRegistrationArgs(runtime, registrantsBody(2, command));

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

    const companies = notified?.map((entry) => entry.payload['company']).sort();
    expect(companies).toEqual(['Booth Co. 0 Ltd.', 'Booth Co. 1 Ltd.']);

    // (b) notify received the STORED records — real branded ids + the closed form,
    // the source of truth its email references (settled #8). The ids the notify
    // saw are exactly the two on the bucket.
    expect(notified?.length).toBe(2);
    expect(notified?.every((s) => s.form === 'registration')).toBe(true);
    expect(notified?.every((s) => typeof s.id === 'string')).toBe(true);
    expect(new Set(notified?.map((s) => s.id)).size).toBe(2);
  });

  it('an invalid member commits NONE of the group and retrying the same token with a valid group succeeds', async () => {
    const { runtime, command } = await makeRegistrationHarness();
    let notifications = 0;
    const action = registrationAction({
      notify: () =>
        Effect.sync(() => {
          notifications += 1;
        }),
      success,
    });

    const invalid = registrantsBody(3, command);
    invalid.set('registrants[1].email', 'not-an-email');
    const rejected = await action(makeRegistrationArgs(runtime, invalid));
    expect(rejected.status).toBe('error');
    expect(notifications).toBe(0);

    const retry = await action(
      makeRegistrationArgs(runtime, registrantsBody(3, command)),
    ).catch((error) => error);
    expect(retry).toBeInstanceOf(Response);
    expect((retry as Response).status).toBe(302);
    expect(notifications).toBe(1);
  });

  it('an exact retry with the same explicit token returns the same record ids', async () => {
    const { runtime, command } = await makeRegistrationHarness();
    const notifiedIds: string[][] = [];
    const action = registrationAction({
      notify: (submissions) =>
        Effect.sync(() => {
          notifiedIds.push(submissions.map((submission) => submission.id).sort());
        }),
      success,
    });
    const body = registrantsBody(2, command);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const thrown = await action(makeRegistrationArgs(runtime, body)).catch(
        (error) => error,
      );
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(302);
    }

    expect(notifiedIds).toHaveLength(2);
    expect(notifiedIds[1]).toEqual(notifiedIds[0]);
  });

  it('a notify failure leaves the committed group available to an exact retry', async () => {
    const { runtime, command } = await makeRegistrationHarness();
    let firstIds: string[] = [];
    const failingAction = registrationAction({
      notify: (submissions) =>
        Effect.sync(() => {
          firstIds = submissions.map((submission) => submission.id).sort();
        }).pipe(
          Effect.andThen(
            Effect.fail(
              formValidationError({
                formErrors: ['registration.form.error'],
              }),
            ),
          ),
        ),
      success,
    });

    const body = registrantsBody(2, command);
    const result = await failingAction(makeRegistrationArgs(runtime, body));

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['registration.form.error']);
    expect(result.preserved[FORM_VERSION_FIELD]).toBe(command.definitionVersion);
    expect(result.preserved[IDEMPOTENCY_TOKEN_FIELD]).toBe(
      command.idempotencyToken,
    );

    let retryIds: string[] = [];
    const retryAction = registrationAction({
      notify: (submissions) =>
        Effect.sync(() => {
          retryIds = submissions.map((submission) => submission.id).sort();
        }),
      success,
    });
    const retry = await retryAction(makeRegistrationArgs(runtime, body)).catch(
      (error) => error,
    );
    expect(retry).toBeInstanceOf(Response);
    expect((retry as Response).status).toBe(302);
    expect(retryIds).toEqual(firstIds);
  });
});
