import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import {
  makeTestAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { Mailer } from '../mailer.server';
import { layerTest } from '../storage.test-helper';

import { Forms } from './forms.server';
import { registrationAction } from './registration-action';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
  newSubmissionCommandFields,
  type SubmissionCommandFields,
} from './submission-command';

interface SentMail {
  readonly subject: string;
  readonly content: string;
  readonly idempotencyKey?: string;
}

const capturingMailer = (sent: SentMail[]) =>
  Layer.succeed(
    Mailer.Service,
    Mailer.Service.of({
      send: (input) =>
        Effect.sync(() => {
          sent.push(input);
        }),
    }),
  );

const requestRuntimes: RequestRuntime[] = [];
afterEach(async () => {
  await Promise.all(requestRuntimes.splice(0).map((runtime) => runtime.dispose()));
});

/**
 * Branch 7.3 — the registration ACTION's own persist-then-notify orchestration.
 *
 * Registration is the one form whose payload is NOT a flat field graph but the
 * repeating `{ registrants: Registrant[] }` shell, so it does NOT flow through
 * the flat `formAction` skeleton (proven in `action.test.ts`): it owns
 * `registrationAction`, the slice's headline net-new server path (settled #9).
 * The service-level relational commit is pinned in `forms.server.test.ts`; here
 * we pin the ACTION's distinct code path — the parts `formAction` does not
 * exercise:
 *   - decoding the `{ registrants: Array(definitionToSchema(def)) }` shell from
 *     the conform-parsed bracket payload (`registrants[n].field`);
 *   - one atomic group commit — N registrants → N distinct durable rows;
 *   - commit-FIRST, notification-SECOND ordering for THIS path: the canonical
 *     email is derived from the stored `Submission[]`, and a Mailer failure still
 *     leaves every relational record committed (settled #8).
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

const makeRegistrationHarness = async (
  mailerLayer: NonNullable<Parameters<typeof makeTestAppLayer>[1]> = Mailer.layer,
) => {
  const appLayer = makeTestAppLayer(layerTest({}), mailerLayer);
  const managed = ManagedRuntime.make(appLayer);
  const published = await managed.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Forms.Service).current('registration');
    }),
  );
  await managed.dispose();
  const runtime = makeRequestRuntimeFromLayer(appLayer);
  requestRuntimes.push(runtime);
  return {
    runtime,
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
  it('persists EACH registrant as its own record, then sends their notification', async () => {
    const sent: SentMail[] = [];
    const { runtime, command } = await makeRegistrationHarness(
      capturingMailer(sent),
    );

    const action = registrationAction({
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

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('[!] Registration: 2 registrants');
    expect(sent[0]?.content).toContain('Booth Co. 0');
    expect(sent[0]?.content).toContain('Booth Co. 1');
    const ids = [...(sent[0]?.content.matchAll(/record ([A-Za-z0-9_-]+)/g) ?? [])]
      .map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('an invalid member commits NONE of the group and retrying the same token with a valid group succeeds', async () => {
    const sent: SentMail[] = [];
    const { runtime, command } = await makeRegistrationHarness(
      capturingMailer(sent),
    );
    const action = registrationAction({
      success,
    });

    const invalid = registrantsBody(3, command);
    invalid.set('registrants[1].email', 'not-an-email');
    const rejected = await action(makeRegistrationArgs(runtime, invalid));
    expect(rejected.status).toBe('error');
    expect(sent).toHaveLength(0);

    const retry = await action(
      makeRegistrationArgs(runtime, registrantsBody(3, command)),
    ).catch((error) => error);
    expect(retry).toBeInstanceOf(Response);
    expect((retry as Response).status).toBe(302);
    expect(sent).toHaveLength(1);
  });

  it('an exact retry returns the same records without redelivering notification', async () => {
    const sent: SentMail[] = [];
    const { runtime, command } = await makeRegistrationHarness(
      capturingMailer(sent),
    );
    const action = registrationAction({
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

    expect(sent).toHaveLength(1);
    expect(sent[0]?.idempotencyKey).toMatch(/^form:[A-Za-z0-9_-]+:admin-email$/);
  });

  it('a notify failure leaves the committed group available to an exact retry', async () => {
    const attempts: SentMail[] = [];
    let attempt = 0;
    const mailerLayer = Layer.succeed(
      Mailer.Service,
      Mailer.Service.of({
        send: (input) =>
          Effect.sync(() => {
            attempts.push(input);
            attempt += 1;
            return attempt;
          }).pipe(
            Effect.flatMap((currentAttempt) =>
              currentAttempt === 1
                ? Effect.fail(new Mailer.MailError({}))
                : Effect.void,
            ),
          ),
      }),
    );
    const { runtime, command } = await makeRegistrationHarness(mailerLayer);
    const failingAction = registrationAction({
      success,
    });

    const body = registrantsBody(2, command);
    const result = await failingAction(makeRegistrationArgs(runtime, body));

    expect(result.status).toBe('error');
    expect(result.result.error?.formErrors).toEqual(['registration.form.error']);
    expect(result.command.preserved[FORM_VERSION_FIELD]).toBe(command.definitionVersion);
    expect(result.command.preserved[IDEMPOTENCY_TOKEN_FIELD]).toBe(
      command.idempotencyToken,
    );
    expect(result.command.disposition).toBe('preserve');

    const retryAction = registrationAction({
      success,
    });
    const retry = await retryAction(makeRegistrationArgs(runtime, body)).catch(
      (error) => error,
    );
    expect(retry).toBeInstanceOf(Response);
    expect((retry as Response).status).toBe(302);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.idempotencyKey).toBe(attempts[0]?.idempotencyKey);
    const ids = (mail: SentMail | undefined) =>
      [...(mail?.content.matchAll(/record ([A-Za-z0-9_-]+)/g) ?? [])]
        .map((match) => match[1])
        .sort();
    expect(ids(attempts[1])).toEqual(ids(attempts[0]));
  });
});
