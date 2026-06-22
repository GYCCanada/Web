import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';
import {
  ConfigProvider,
  DateTime,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
} from 'effect';
import { Env } from '../env.server';
import { RouterContextProvider } from 'react-router';
import { isSuccess } from 'effect-encore';

import { defaultRegistrationForm } from '../content/pages/defaults';
import { Content } from '../content.server';
import { formObjectKey, orderKey } from '../content/pages/registry';
import { IsoDate } from '../content/schema';
import { formValidationError } from '../effect/errors';
import {
  type AppLayer,
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { Order } from '../order/runner.server';
import { type CreateCheckoutSessionCall, Payment } from '../payment.server';
import { type ObjectHead, NotFound, Storage, StorageError } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { Cents } from './pricing';
import { FormDefinition } from './definition';
import { RegistrationOrder } from './order';
import { registrationAction } from './registration-action';
import { Submissions } from './submissions.server';
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

/** The perRegistrant "links sent" toast copy (mirrors `registration-route.ts`). */
const perRegistrantSuccess = {
  title: 'registration.checkout.perRegistrant.success.title',
  description: 'registration.checkout.perRegistrant.success.description',
} as const;

/**
 * The required `RegistrationActionConfig` slots a test that only exercises the
 * group / legacy paths doesn't care about — a no-op `notifyPaymentLink` and the
 * shared `perRegistrantSuccess` copy. The perRegistrant block overrides
 * `notifyPaymentLink` with a spy to assert the per-registrant mail fan-out.
 */
const noopPaymentLink = (): Effect.Effect<void> => Effect.void;

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

/**
 * The party payer fields the live form now POSTs (registrar plan C7 — the default
 * `registration` form authors a GROUP-only `party` section, so the route-owned
 * shell requires the nominated payer's name + email). The mode discriminant is
 * left ABSENT so the shell's `withDecodingDefaultKey` fills the lone `group` mode.
 */
const partyPayerFields = {
  'party.payer.name': 'Group Leader',
  'party.payer.email': 'leader@example.com',
} as const;

/**
 * A POST body carrying `count` valid exhibitor registrants plus the group party
 * payer block (the shell decodes the party alongside the registrants).
 */
const registrantsBody = (count: number): URLSearchParams =>
  new URLSearchParams(
    Object.assign(
      {},
      ...Array.from({ length: count }, (_, i) => exhibitorFields(i)),
      partyPayerFields,
    ),
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
      // Registrant submissions sit at `submissions/registration/<id>.json`; the
      // frozen ORDERS nest one level UNDER at `submissions/registration/orders/`.
      // The shared `list` prefix returns BOTH, so the order keys are filtered out
      // here (they decode as orders, not submissions — the real registrar reads
      // them through `listOrders`).
      const listed = (
        yield* storage.list('submissions/registration/')
      ).filter((entry) => !entry.key.startsWith('submissions/registration/orders/'));
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
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
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
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });

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
      const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
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
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
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

/**
 * Registrar C7 — the GROUP checkout the action mints when the `Env.stripe` gate is
 * `Some` and the form authored a `party` section. The default `registration` form
 * authors a GROUP-only party (C7a), so a party submission decodes the group arm:
 * the action freezes ONE order for the party sum and mints ONE Checkout Session via
 * `Payment`, then REDIRECTS the browser (303) to the session's hosted `url` so the
 * visitor actually pays on Stripe — proven end-to-end through `Payment.testLayer`
 * (NO network). The order stays `pending`; the success notification moves to the
 * `checkout.session.completed` webhook (C8). When the gate is `None` the on-site
 * path is INERT (no session, no order) — the RegFox-era no-op behaviour. Both
 * halves are pinned here (the `--deep` blocker: the blank-non-leader-email drop is
 * proven on the REAL rendered `email: ''` payload, not just the schema).
 */
const STRIPE_ENABLED_ENV: Record<string, string> = {
  STRIPE_API_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_456',
  // STRIPE_CURRENCY unset ⇒ the `cad` default (the GYC settlement currency).
};

/**
 * The default `registration` form authors a `party` section but NO `pricing`
 * dimension (C7a/C7.5 — party scope without prices). Checkout is gated on BOTH
 * the `Env.stripe` `Some` AND `definition.pricing` being present (the --deep M2
 * finding: an unpriced form would otherwise mint ZERO-amount intents, which
 * Stripe rejects and which collect nothing). So a checkout assertion needs a
 * PRICED definition: this seeds `forms/registration.json` with the default form
 * plus a flat `base` fee, encoded as the bucket JSON `Content.getForm` reads back
 * and decodes (`derive-dont-sync` — the action prices off the stored definition,
 * not a hard-coded one). The `BASE_FEE` is the per-registrant base every priced
 * fixture charges.
 */
const BASE_FEE = 5000;
const pricedRegistrationObject = (): Record<string, { body: string }> => {
  const encoded = Schema.encodeSync(FormDefinition)(
    defaultRegistrationForm,
  ) as Record<string, unknown>;
  const priced = {
    ...encoded,
    pricing: { currency: 'cad', base: BASE_FEE, rules: [] },
  };
  return { [formObjectKey('registration')]: { body: JSON.stringify(priced) } };
};

/**
 * An app layer with the stripe gate forced `Some` (a ConfigProvider override, no
 * process.env leak) and the supplied `Payment` layer — `Payment.testLayer` for a
 * checkout assertion, or the real layer for the disabled case (gate `None`).
 */
const stripeEnabledLayer = (
  storageLayer: Parameters<typeof makeAppLayer>[0],
  paymentLayer: Layer.Layer<Payment.Service, never, never>,
): AppLayer =>
  makeAppLayer(storageLayer, paymentLayer).pipe(
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: STRIPE_ENABLED_ENV })),
    ),
  ) as AppLayer;

/** Read every persisted order back through the shared runtime's bucket. */
const listOrders = (runtime: RequestRuntime, args: RouteArgs) =>
  runtime.run(
    args,
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const listed = yield* storage.list('submissions/registration/orders/');
      const decode = Schema.decodeUnknownEffect(
        Schema.fromJsonString(RegistrationOrder),
      );
      return yield* Effect.forEach(listed, (entry) =>
        Effect.gen(function* () {
          const object = yield* storage.get(entry.key);
          const text = yield* Effect.promise(() =>
            new Response(object.stream).text(),
          );
          return { key: entry.key, order: yield* decode(text) };
        }),
      );
    }),
  );

/** A group party POST body: `count` exhibitors (with per-registrant overrides) + the payer. */
const groupBody = (
  count: number,
  registrantOver: (i: number) => Record<string, string> = () => ({}),
): URLSearchParams =>
  new URLSearchParams(
    Object.assign(
      {},
      ...Array.from({ length: count }, (_, i) => {
        const fields = exhibitorFields(i);
        return Object.fromEntries(
          Object.entries({ ...stripRegistrantPrefix(fields, i), ...registrantOver(i) }).map(
            ([key, value]) => [`registrants[${i}].${key}`, value],
          ),
        );
      }),
      partyPayerFields,
    ),
  );

/** Strip the `registrants[i].` prefix from a built field map (so overrides merge cleanly). */
const stripRegistrantPrefix = (
  fields: Record<string, string>,
  i: number,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key.replace(`registrants[${i}].`, ''),
      value,
    ]),
  );

describe('registrationAction — group checkout (registrar C7)', () => {
  it('mints ONE Checkout Session + ONE frozen order and redirects to the hosted url (stripe enabled)', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(
        layerTest(pricedRegistrationObject()),
        Payment.testLayer({ calls }),
      ),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const args = makeRegistrationArgs(runtime, groupBody(2));

    let thrown: unknown;
    try {
      await action(args);
    } catch (error) {
      thrown = error;
    }

    // The action redirects the browser (303) to the hosted Checkout url — the
    // visitor actually pays on Stripe, the order stays pending. NOT a 302 success
    // toast (that would imply settlement the webhook hasn't confirmed yet).
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(303);
    const call = calls[0]!;
    expect(response.headers.get('location')).toBe(
      `https://checkout.stripe.test/${call.idempotencyKey}`,
    );

    // (a) Exactly ONE create-session call (the group: one session for the party).
    expect(calls.length).toBe(1);
    // The receipt routes to the NOMINATED payer (frozen), not a registrant.
    expect(call.receiptEmail).toBe('leader@example.com');
    expect(String(call.currency)).toBe('cad');
    // The return URLs are absolute + carry the checkout-outcome query the form reads.
    expect(call.successUrl).toBe('http://localhost/2026/form?checkout=success');
    expect(call.cancelUrl).toBe('http://localhost/2026/form?checkout=cancelled');
    // The idempotency key is the request-fingerprint + mode (Decision 2) — a
    // verbatim retry re-derives it ⇒ Stripe replays the first session.
    expect(call.idempotencyKey).toMatch(/^registration:checkout:[a-f0-9]+:group$/);
    expect(call.metadata).toEqual(
      expect.objectContaining({ mode: 'group' }),
    );

    // (b) Exactly ONE frozen order landed, keyed by the fingerprint, holding the
    // whole party + the frozen amount/receipt.
    const orders = await listOrders(runtime, args);
    expect(orders.length).toBe(1);
    const order = orders[0]!.order;
    expect(order.mode).toBe('group');
    expect(order.status).toBe('pending');
    expect(order.receiptEmail).toBe('leader@example.com');
    expect(order.registrantIds.length).toBe(2);
    expect(order.sessionId).toBe(`cs_test_${call.idempotencyKey}`);
    // The order amount is the frozen Cents the session charged.
    expect(order.amount).toBe(call.amount);
  });

  it('a group submission with a blank non-leader registrant email SUCCEEDS end-to-end (2b.3)', async () => {
    // The REAL rendered payload: registrant #1 POSTs `email: ''`. The shell drops
    // it to absent so the optional-at-key email decodes valid — proven through the
    // full action + parseSubmission path, not just the schema (the --deep blocker).
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(
        layerTest(pricedRegistrationObject()),
        Payment.testLayer({ calls }),
      ),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = groupBody(2, (i): Record<string, string> =>
      i === 1 ? { email: '' } : {},
    );

    let thrown: unknown;
    try {
      await action(makeRegistrationArgs(runtime, body));
    } catch (error) {
      thrown = error;
    }
    // It SUCCEEDED → the 303 redirect to the hosted Checkout url (a present-blank
    // that still rejected would surface as a form error, no redirect).
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(303);
    // And it still minted the group session + order.
    expect(calls.length).toBe(1);
    const orders = await listOrders(runtime, makeRegistrationArgs(runtime, body));
    expect(orders.length).toBe(1);
  });

  it('a group submission with a blank PAYER email FAILS (payer email required)', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(layerTest({}), Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = new URLSearchParams(
      Object.assign({}, exhibitorFields(0), {
        'party.payer.name': 'Group Leader',
        'party.payer.email': '',
      }),
    );
    const result = await action(makeRegistrationArgs(runtime, body));

    // A decode failure reports a form error — no redirect, no intent, no order.
    expect(result.status).toBe('error');
    expect(calls.length).toBe(0);
  });

  it('an empty party (zero registrants) FAILS before any checkout', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(layerTest({}), Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = new URLSearchParams({ ...partyPayerFields });
    const result = await action(makeRegistrationArgs(runtime, body));

    expect(result.status).toBe('error');
    expect(calls.length).toBe(0);
  });

  it('stripe DISABLED skips checkout — registration persists + redirects, no order', async () => {
    // The gate is `None` (no STRIPE env in the default test process), so the real
    // `Payment.layer` is wired but the action never calls it — the inert RegFox-era
    // path: persist + notify + redirect, with NO order written.
    const runtime = makeRequestRuntimeFromLayer(makeAppLayer(layerTest({})));
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const args = makeRegistrationArgs(runtime, registrantsBody(2));

    let thrown: unknown;
    try {
      await action(args);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);

    // Registrants persisted, but NO order (the checkout path was skipped).
    const stored = await listRegistrations(runtime, args);
    expect(stored.length).toBe(2);
    const orders = await listOrders(runtime, args);
    expect(orders.length).toBe(0);
  });

  it('stripe ENABLED but the form has NO pricing mints NO zero-amount intent/order (M2)', async () => {
    // The --deep MAJOR finding M2: the default `registration` form authors a
    // `party` section but NO `pricing`. With Stripe configured, gating checkout
    // purely on `Some(stripe) && 'party' in shell` enters the on-site path and
    // mints a ZERO-amount Checkout Session/order (`priceGroup` of an unpriced form is
    // `Cents(0)`). Stripe rejects zero-amount intents and there is nothing to
    // collect. The fix requires `definition.pricing` to ALSO be present: an
    // unpriced form (the default seeded here — `layerTest({})` falls back to the
    // bundled `defaultRegistrationForm`, which has no `pricing`) persists +
    // notifies + redirects with NO payment path, even with Stripe enabled.
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(layerTest({}), Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const args = makeRegistrationArgs(runtime, groupBody(2));

    let thrown: unknown;
    try {
      await action(args);
    } catch (error) {
      thrown = error;
    }
    // It SUCCEEDED — the submission still persists + notifies + redirects.
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);

    // No intent was minted (Stripe enabled but the form is unpriced) ...
    expect(calls.length).toBe(0);
    // ... and NO order was written (the zero-amount checkout was skipped) ...
    const orders = await listOrders(runtime, args);
    expect(orders.length).toBe(0);
    // ... while both registrants are durably persisted (the pre-registrar path).
    const stored = await listRegistrations(runtime, args);
    expect(stored.length).toBe(2);
  });
});

/**
 * A `perRegistrant` POST body: `count` exhibitors + `party._tag = 'perRegistrant'`
 * and NO payer (the perRegistrant arm carries none). The default `registration`
 * form now authors BOTH modes (C7.5), so this submission decodes the perRegistrant
 * arm and the action fans out one order/intent per registrant.
 */
const perRegistrantBody = (count: number): URLSearchParams =>
  new URLSearchParams(
    Object.assign(
      {},
      ...Array.from({ length: count }, (_, i) => exhibitorFields(i)),
      { 'party._tag': 'perRegistrant' },
    ),
  );

/**
 * Registrar C7.5 + round-2 --deep BLOCKER fix — the `perRegistrant` cardinality:
 * the decoded `party._tag` drives a fan-out, one Checkout Session + one frozen
 * order PER registrant (Decision 2b.6), each keyed `<fingerprint>:<index>` and
 * frozen on that registrant's OWN price + email (the receipt routing). The action
 * does NOT redirect (a single browser can only begin one of N hosted checkouts —
 * redirecting to the first stranded registrants 2..N forever); instead each
 * registrant is MAILED their own hosted Checkout url via `notifyPaymentLink`, and
 * the visitor lands on an HONEST "links sent — check your email" success toast.
 * Each order reconciles independently off its own `checkout.session.completed`.
 * Plus the email orthogonality: a perRegistrant blank registrant email FAILS at
 * decode (re-imposition), where a group blank non-leader passes (the C7 block).
 */
describe('registrationAction — perRegistrant checkout (registrar C7.5)', () => {
  it('mints N sessions + N orders, MAILS each registrant their own link, and redirects to the "links sent" toast (NOT a Stripe url)', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(
        layerTest(pricedRegistrationObject()),
        Payment.testLayer({ calls }),
      ),
    );
    // Spy the per-registrant payment-link mail: capture the registrant email + the
    // hosted url each call routes to. This is the `Mailer`-bound hook the route
    // module wires to `mailer.send({ to: registrant.email, ... })`; here we observe
    // it directly to assert one mail per registrant with THAT registrant's url.
    const mailed: Array<{ email: string; url: string }> = [];
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: ({ submission, url }) =>
        Effect.sync(() => {
          const email = submission.payload['email'];
          mailed.push({
            email: typeof email === 'string' ? email : '',
            url,
          });
        }),
      success,
      perRegistrantSuccess,
    });
    const args = makeRegistrationArgs(runtime, perRegistrantBody(3));

    let thrown: unknown;
    try {
      await action(args);
    } catch (error) {
      thrown = error;
    }
    // The action does NOT redirect to Stripe — it redirects (302) to the form with
    // the "payment links sent" success toast (perRegistrant cannot fan a single
    // browser out to N hosted checkouts, so it mails the links instead).
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/2026/form');
    // Crucially NOT a Stripe checkout url.
    expect(response.headers.get('location')).not.toContain(
      'checkout.stripe.test',
    );
    expect(response.headers.get('set-cookie')).toContain('toast');

    // (a0) Exactly THREE payment-link mails were sent — one per registrant — each
    // routed to ITS OWN registrant email and carrying THAT session's hosted url.
    expect(mailed.length).toBe(3);
    const mailedEmails = mailed.map((m) => m.email).sort();
    expect(mailedEmails).toEqual([
      'booth0@example.com',
      'booth1@example.com',
      'booth2@example.com',
    ]);
    // Every mailed url is one of the N minted hosted session urls, and the set of
    // mailed urls is exactly the set of minted urls (no url stranded / duplicated).
    const mintedUrls = calls
      .map((call) => `https://checkout.stripe.test/${call.idempotencyKey}`)
      .sort();
    expect(mailed.map((m) => m.url).sort()).toEqual(mintedUrls);

    // (a) Exactly THREE create-session calls — one per registrant.
    expect(calls.length).toBe(3);
    // Each session's receipt routes to ITS OWN registrant email (booth{i}@…), and
    // its idempotency key carries the `:perRegistrant:<index>` suffix (a retry
    // replays the same per-registrant sessions).
    const byKey = [...calls].sort((a, b) =>
      a.idempotencyKey.localeCompare(b.idempotencyKey),
    );
    byKey.forEach((call, index) => {
      // The idempotency key is derived from the RESOLVED orderId
      // (`<fingerprint>:<index>`) + mode (order-workflow round-2 --deep H1), so a
      // fresh generation after a dead terminal would key a new session; a verbatim
      // resubmit replays the same per-registrant session.
      expect(call.idempotencyKey).toMatch(
        new RegExp(`^registration:checkout:[a-f0-9]+:${index}:perRegistrant$`),
      );
      expect(call.receiptEmail).toBe(`booth${index}@example.com`);
      expect(call.metadata).toEqual(
        expect.objectContaining({ mode: 'perRegistrant' }),
      );
    });

    // (b) Exactly THREE frozen orders landed, each keyed `<fingerprint>:<index>`,
    // each linking exactly ONE registrant submission, receipt-routed to that
    // registrant.
    const orders = await listOrders(runtime, args);
    expect(orders.length).toBe(3);
    for (const { order } of orders) {
      expect(order.mode).toBe('perRegistrant');
      expect(order.status).toBe('pending');
      expect(order.registrantIds.length).toBe(1);
      expect(order.orderId).toMatch(/^[a-f0-9]+:\d+$/);
      // The order's frozen receipt is the same as the session that charged it.
      const matchingCall = calls.find(
        (call) => `cs_test_${call.idempotencyKey}` === order.sessionId,
      );
      expect(matchingCall?.receiptEmail).toBe(order.receiptEmail);
      expect(order.receiptEmail).toMatch(/^booth\d+@example\.com$/);
    }
    // Every registrant's own email is the receipt of exactly one order.
    const receipts = orders.map((entry) => entry.order.receiptEmail).sort();
    expect(receipts).toEqual([
      'booth0@example.com',
      'booth1@example.com',
      'booth2@example.com',
    ]);
  });

  it('a perRegistrant submission with a blank registrant email FAILS before any checkout (email re-imposition)', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(layerTest({}), Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    // Registrant #1 renders `email: ''` — in perRegistrant the shell re-imposes
    // presence on EVERY registrant, so this rejects (the orthogonal opposite of the
    // group blank-drop, which passes).
    const body = new URLSearchParams(
      Object.assign(
        {},
        exhibitorFields(0),
        Object.fromEntries(
          Object.entries(exhibitorFields(1)).map(([key, value]) =>
            key.endsWith('.email') ? [key, ''] : [key, value],
          ),
        ),
        { 'party._tag': 'perRegistrant' },
      ),
    );
    const result = await action(makeRegistrationArgs(runtime, body));

    expect(result.status).toBe('error');
    expect(calls.length).toBe(0);
  });
});

/**
 * order-workflow G7.1 — the action `send`s the durable Order `arm` op for EACH
 * minted order. This is proven end-to-end through the REAL cross-runtime seam
 * (order-workflow §1): a SENDER side (the action's `makeAppLayer` graph, wired
 * with `Env.database` Some so `Order.appSenderLayer` builds the real sender over
 * the shared sqlite FILE) and a RUNNER side (the `ServerLive` analog — the
 * in-process Sharding runner that consumes the mailbox + runs the `arm`
 * handler). The two graphs coordinate ONLY through (a) the shared sqlite FILE
 * (the `cluster_messages`/`cluster_replies` rows) and (b) the shared bucket (the
 * one Map-backed `Storage` BOTH the action's `Submissions` and the runner's
 * `Submissions` read) — exactly the production topology, where both share the
 * external bucket + the DB file.
 *
 * The assertion: after the action mints + freezes the order(s) and `send`s
 * `arm`, the runner consumes the send, the `arm` handler read-backs the bucket
 * order (the SHARED bucket), and a sender's `waitFor` observes the `arm` reply
 * terminal Success — proving the action actually dispatched the durable anchor.
 */

/** A SINGLE shared Map-backed `Storage` layer (one instance across BOTH graphs). */
const sharedStorageLayer = (
  seed: Record<string, { body: string }> = {},
): Layer.Layer<Storage.Service> => {
  const entries = new Map<string, { body: string; contentType: string }>();
  for (const [key, object] of Object.entries(seed)) {
    entries.set(key, { body: object.body, contentType: 'application/json' });
  }
  return Layer.sync(Storage.Service, () =>
    Storage.Service.of({
      get: Effect.fn('Storage.get')(function* (key: string) {
        const object = entries.get(key);
        if (object === undefined) return yield* new NotFound({ key });
        return {
          stream: new Response(object.body).body ?? new ReadableStream<Uint8Array>(),
          contentType: object.contentType,
          size: new TextEncoder().encode(object.body).byteLength,
        };
      }),
      put: Effect.fn('Storage.put')((key: string, body: string | Uint8Array, contentType: string) =>
        Effect.sync(() => {
          entries.set(key, { body: String(body), contentType });
        }),
      ),
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
};

/**
 * A Map-backed `Storage` over an EXTERNALLY-owned `entries` map (so a test can
 * seed it, read it, mutate it mid-action, and share one instance across submits).
 * Distinct from `sharedStorageLayer` (which owns its map internally): the H1
 * round-3 adversarial tests need to (i) flip an order to paid mid-action via a
 * Payment-hook side effect and (ii) inject a targeted `put` failure on the
 * registrant-stamp write — both require holding the map AND a `failPut` predicate.
 */
const mapBackedStorage = (
  entries: Map<string, { body: string; contentType: string }>,
  failPut: (key: string) => boolean = () => false,
): Layer.Layer<Storage.Service> =>
  Layer.sync(Storage.Service, () =>
    Storage.Service.of({
      get: Effect.fn('Storage.get')(function* (key: string) {
        const object = entries.get(key);
        if (object === undefined) return yield* new NotFound({ key });
        return {
          stream:
            new Response(object.body).body ?? new ReadableStream<Uint8Array>(),
          contentType: object.contentType,
          size: new TextEncoder().encode(object.body).byteLength,
        };
      }),
      put: Effect.fn('Storage.put')(function* (
        key: string,
        body: string | Uint8Array,
        contentType: string,
      ) {
        if (failPut(key)) return yield* new StorageError({ key, op: 'put' });
        entries.set(key, { body: String(body), contentType });
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

const tmpDbFile = (suffix: string): string =>
  `${tmpdir()}/gyc-order-action-${process.pid}-${Date.now()}-${suffix}.sqlite`;

/** The DB+stripe-enabled env: a sqlite FILE on disk (NOT `:memory:` — the two graphs share it). */
const dbStripeEnv = (dbFile: string): Record<string, string> => ({
  ...STRIPE_ENABLED_ENV,
  DATABASE_URL: dbFile,
});

/**
 * Drive a registration POST through a DB-enabled action graph (the sender) over
 * a shared sqlite FILE + shared bucket, with a live runner graph consuming the
 * mailbox, then return the runner-side `waitFor` outcome for each minted order's
 * `arm` op. Resolves to the orders minted + the per-order arm reply tags.
 */
const runActionAndAwaitArms = async (
  body: URLSearchParams,
  seed: Record<string, { body: string }>,
): Promise<{ orders: ReadonlyArray<RegistrationOrder>; armTags: ReadonlyArray<string> }> => {
  const dbFile = tmpDbFile('arms');
  const storage = sharedStorageLayer(seed);
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: dbStripeEnv(dbFile) }),
  );

  // The runner graph (ServerLive analog): the FULL runner over the shared FILE +
  // the arm/settle/… handlers, with `Submissions` over the SHARED bucket so the
  // `arm` handler's bucket read-back sees the order the action wrote.
  const runnerLayer = Order.fullRunnerLayer(Order.MessageStorageLive).pipe(
    Layer.provide(
      Layer.provideMerge(
        Submissions.layer,
        Layer.provideMerge(Content.layer, storage),
      ),
    ),
    Layer.provide(Payment.testLayer()),
    Layer.provide(Env.layer),
    Layer.provide(config),
  );
  const runner = ManagedRuntime.make(runnerLayer);

  // The sender graph that reads the arm replies (the webhook analog), over the
  // SAME file — a SEPARATE sender build (distinct SqlClient).
  const sender = ManagedRuntime.make(
    Order.senderLayer(Order.MessageStorageLive).pipe(
      Layer.provide(Env.layer),
      Layer.provide(config),
    ),
  );

  try {
    // Boot the runner so its mailbox-poll fiber consumes the shared file.
    await runner.runPromise(Effect.void);

    // The action graph (the AppRuntime sender analog): the real `makeAppLayer`
    // over the SHARED bucket + the DB env, so `Order.appSenderLayer` builds the
    // real sender and `armOrder` dispatches over the shared file.
    const actionRuntime = makeRequestRuntimeFromLayer(
      makeAppLayer(storage, Payment.testLayer()).pipe(
        Layer.provide(config),
      ) as AppLayer,
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    await action(makeRegistrationArgs(actionRuntime, body)).catch(() => {});

    const orders = await listOrders(
      actionRuntime,
      makeRegistrationArgs(actionRuntime, body),
    );

    // For each minted order, the runner-side `arm` reply observed terminal. The
    // `arm` payload-input requires every key (encore's mapped type re-requires
    // them — `id` ignores all but `orderId`, but the INPUT shape is full), so the
    // `waitFor` payload is reconstructed from the minted order.
    const armTags = await Promise.all(
      orders.map((entry) =>
        sender.runPromise(
          Order.Entity.arm.waitFor(
            {
              orderId: entry.order.orderId,
              mode: entry.order.mode,
              amount: entry.order.amount,
              currency: entry.order.currency,
              receiptEmail: entry.order.receiptEmail,
              sessionId: entry.order.sessionId,
              registrantIds: entry.order.registrantIds,
              deadline: entry.order.deadline,
            },
            { filter: (r) => isSuccess(r) },
          ),
        ).then((r) => r._tag),
      ),
    );

    return { orders: orders.map((e) => e.order), armTags };
  } finally {
    await runner.dispose();
    await sender.dispose();
  }
};

describe('registrationAction — durable Order arm send (order-workflow G7.1)', () => {
  it('group: the action sends ONE arm op that the runner anchors to Success', async () => {
    const { orders, armTags } = await runActionAndAwaitArms(
      groupBody(2),
      pricedRegistrationObject(),
    );
    // Exactly ONE order minted (group), and its `arm` op resolved Success on the
    // runner — the action dispatched the durable anchor.
    expect(orders.length).toBe(1);
    expect(armTags).toEqual(['Success']);
  });

  it('perRegistrant: the action sends N arm ops, each anchored to Success', async () => {
    const { orders, armTags } = await runActionAndAwaitArms(
      perRegistrantBody(3),
      pricedRegistrationObject(),
    );
    // THREE orders minted (one per registrant), each `arm` op resolved Success —
    // the N-per-request fan-out (Risk 6) each anchored its own entity.
    expect(orders.length).toBe(3);
    expect(armTags).toEqual(['Success', 'Success', 'Success']);
  });

  it('zero-amount (unpriced form): no order minted ⇒ no arm op sent', async () => {
    // An unpriced form mints NO order, so there is nothing to anchor — the arm
    // send is per-order, so zero orders ⇒ zero sends (no spurious entity).
    const { orders, armTags } = await runActionAndAwaitArms(groupBody(2), {});
    expect(orders.length).toBe(0);
    expect(armTags).toEqual([]);
  });
});

/**
 * order-workflow round-2 --deep H1 — the GUARDED order create/reuse on a
 * same-payload registration resubmit. A verbatim resubmit derives the SAME
 * deterministic `orderId` (the request fingerprint), so a naive
 * `persistOrder` would silently OVERWRITE whatever order already lives there —
 * restamping an already-PAID order's registrants back to `pending` (the F1
 * resurrection class through the CREATE path), or resurrecting a non-paid
 * TERMINAL order. These pin the CONFIRMED resubmit UX end-to-end through the real
 * action over a PERSISTENT shared bucket (so the second submit reads what the
 * first wrote):
 *   (a) resubmit after PAID  ⇒ existing receipt, NO new session, order stays
 *       paid, registrants NOT restamped;
 *   (b) resubmit while PENDING ⇒ replays the same session, NO restamp;
 *   (c) resubmit after a non-paid TERMINAL ⇒ a FRESH pending order (new
 *       generation) is allowed — the user legitimately re-registers;
 *   (d) a live PENDING whose frozen fields CONFLICT ⇒ explicit failure.
 */

/** A single-registrant priced GROUP body (the simplest order to drive). */
const oneRegistrantGroupBody = (): URLSearchParams => groupBody(1);

/**
 * Drive a registration action over the SAME runtime/bucket the test holds, and
 * return the thrown `Response` (the redirect) or the `FormResult` (an error
 * report). The action's terminal `toast.redirect`/Stripe `redirect` throws a
 * mapped `Response`; a validation failure resolves to a `FormResult`.
 */
const driveAction = async (
  runtime: RequestRuntime,
  action: ReturnType<typeof registrationAction>,
  body: URLSearchParams,
): Promise<Response | Awaited<ReturnType<ReturnType<typeof registrationAction>>>> => {
  try {
    return await action(makeRegistrationArgs(runtime, body));
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
};

/** Sync `RegistrationOrder` JSON codecs — the race-injection hook (i) rewrites a
 * stored order to `paid` through the SAME schema the action reads, no raw JSON. */
const decodeOrderSync = Schema.decodeUnknownSync(
  Schema.fromJsonString(RegistrationOrder),
);
const encodeOrderSync = Schema.encodeSync(
  Schema.fromJsonString(RegistrationOrder),
);
/** Decode a `YYYY-MM-DD` string to the branded, real-calendar `IsoDate`. */
const isoDateSync = Schema.decodeUnknownSync(IsoDate);

describe('registrationAction — guarded order create/reuse on resubmit (H1)', () => {
  it('(a) resubmit after PAID returns the existing ?checkout=success receipt — no new session, order stays paid, registrants NOT restamped, NO duplicate admin notify', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    // ONE shared bucket across both submits + the status mutation.
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    // Spy `notify`: the CONFIRMED paid-resubmit UX redirects to the existing
    // `?checkout=success` receipt state WITHOUT calling `config.notify` (a second
    // notify would re-send the admin `[!] Registration…` mail — round-3 --deep
    // MAJOR 1). The count must stay 0 across the paid resubmit.
    let notifyCount = 0;
    const action = registrationAction({
      notify: () =>
        Effect.sync(() => {
          notifyCount += 1;
        }),
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();

    // First submit: one pending order + one session.
    const first = await driveAction(runtime, action, body);
    expect(first).toBeInstanceOf(Response);
    expect((first as Response).status).toBe(303);
    expect(calls.length).toBe(1);
    const args = makeRegistrationArgs(runtime, body);
    const order = (await listOrders(runtime, args))[0]!.order;

    // Mark it PAID through the bucket authority (the webhook's reconcile).
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', order.orderId);
      }),
    );
    const paidRegistrants = await listRegistrations(runtime, args);
    expect(paidRegistrants[0]?.record.payment?._tag).toBe('paid');

    // Resubmit the SAME payload: the order is paid, so the action returns the
    // existing success/receipt — NO new Stripe session, the order stays paid,
    // and the registrant is NOT restamped back to pending.
    const second = await driveAction(runtime, action, body);
    expect(second).toBeInstanceOf(Response);
    // Lands on the EXISTING `?checkout=success` receipt state (303 to the same url
    // Stripe returns to on a first completion), NOT a Stripe checkout url and NOT
    // the legacy success toast (the CONFIRMED resubmit UX — round-3 --deep).
    expect((second as Response).status).toBe(303);
    expect((second as Response).headers.get('location')).toBe(
      'http://localhost/2026/form?checkout=success',
    );
    expect((second as Response).headers.get('location')).not.toContain(
      'checkout.stripe.test',
    );
    // The admin `notify` was NEVER called on the paid resubmit (no duplicate
    // notification — round-3 --deep MAJOR 1).
    expect(notifyCount).toBe(0);
    // No SECOND create-session call (no re-charge).
    expect(calls.length).toBe(1);
    // Still exactly ONE order, still `paid` (never overwritten to pending).
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(ordersAfter[0]!.order.status).toBe('paid');
    // The registrant kept its `paid` stamp — NOT restamped to pending.
    const registrantsAfter = await listRegistrations(runtime, args);
    expect(registrantsAfter[0]?.record.payment?._tag).toBe('paid');
  });

  it('(b) resubmit while PENDING reuses the same checkout — order not overwritten, registrants not restamped', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // First submit: pending order + session.
    const first = await driveAction(runtime, action, body);
    expect((first as Response).status).toBe(303);
    expect(calls.length).toBe(1);
    const firstOrder = (await listOrders(runtime, args))[0]!.order;
    const firstUrl = (first as Response).headers.get('location');

    // Resubmit the SAME payload while still pending: Stripe replays the SAME
    // session (idempotency key), so the visitor is redirected to the same hosted
    // url; the order is NOT overwritten (same orderId, same sessionId), and there
    // is still exactly ONE order.
    const second = await driveAction(runtime, action, body);
    expect((second as Response).status).toBe(303);
    expect((second as Response).headers.get('location')).toBe(firstUrl);
    // The Payment testLayer is idempotency-keyed, so a verbatim resubmit does NOT
    // double the create-session calls beyond the replayed one.
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(ordersAfter[0]!.order.orderId).toBe(firstOrder.orderId);
    expect(ordersAfter[0]!.order.sessionId).toBe(firstOrder.sessionId);
    expect(ordersAfter[0]!.order.status).toBe('pending');
  });

  it('(c) resubmit after a non-paid TERMINAL (expired) mints a FRESH pending order at a new generation — the dead order is left untouched', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // First submit → pending order. Expire it (the deadline sweep / abandon).
    await driveAction(runtime, action, body);
    const deadOrder = (await listOrders(runtime, args))[0]!.order;
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderExpired('registration', deadOrder.orderId);
      }),
    );
    const afterExpire = await listOrders(runtime, args);
    expect(afterExpire.length).toBe(1);
    expect(afterExpire[0]!.order.status).toBe('expired');

    // Resubmit the SAME payload: the user is legitimately re-registering past a
    // dead order, so a FRESH pending order is minted at a NEW generation — the
    // expired order is NEVER overwritten back to pending.
    const second = await driveAction(runtime, action, body);
    expect((second as Response).status).toBe(303);
    const ordersAfter = await listOrders(runtime, args);
    // TWO orders now: the dead expired one (untouched) + a fresh pending one.
    expect(ordersAfter.length).toBe(2);
    const byStatus = Object.fromEntries(
      ordersAfter.map((entry) => [entry.order.status, entry.order]),
    );
    expect(byStatus['expired']?.orderId).toBe(deadOrder.orderId);
    expect(byStatus['pending']).toBeDefined();
    // The fresh order is a DISTINCT generation key, not the dead one.
    expect(byStatus['pending']?.orderId).not.toBe(deadOrder.orderId);
    expect(byStatus['pending']?.orderId.startsWith(deadOrder.orderId)).toBe(true);
  });

  it('(i) PAID between resolve and commit (the race) lands on ?checkout=success — no Stripe redirect, no restamp, no duplicate notify', async () => {
    // The adversarial race the round-3 --deep BLOCKER 1 names: `resolveOrderSlot`
    // reads the order live-PENDING, then the order flips to PAID in the window
    // BEFORE the guarded `createOrReuseOrder` re-read at commit. The pre-mint
    // paid fast-path cannot catch this (it already saw pending); only the commit
    // branch on the FULL outcome union can. We inject the flip INSIDE
    // `createCheckoutSession` (which the action calls AFTER resolve, BEFORE the
    // commit re-read): the double rewrites the live order on the shared bucket to
    // `paid` as a side effect, so `createOrReuseOrder` re-reads `alreadyPaid`.
    const entries = new Map<string, { body: string; contentType: string }>();
    for (const [key, object] of Object.entries(pricedRegistrationObject())) {
      entries.set(key, { body: object.body, contentType: 'application/json' });
    }
    const mapStorage = mapBackedStorage(entries);
    // The Payment double: on every call, flip whatever pending registration order
    // already lives on the bucket to `paid` (the race), then return the session.
    let flipNext = false;
    const calls: Array<CreateCheckoutSessionCall> = [];
    const racingPayment = Layer.succeed(
      Payment.Service,
      Payment.Service.of({
        createCheckoutSession: (params) =>
          Effect.sync(() => {
            calls.push({
              amount: params.amount,
              currency: params.currency,
              receiptEmail: params.receiptEmail,
              productName: params.productName,
              successUrl: params.successUrl,
              cancelUrl: params.cancelUrl,
              metadata: params.metadata,
              idempotencyKey: params.idempotencyKey,
            });
            if (flipNext) {
              // Rewrite the order at the resolved orderId to `paid` — the exact
              // shape `markOrderPaid` would write (status + a frozen paidAt) —
              // through the `RegistrationOrder` codec (no raw JSON), so the
              // re-read sees a fully-valid paid order.
              const key = orderKey('registration', params.metadata['orderId']!);
              const current = entries.get(key);
              if (current !== undefined) {
                const order = decodeOrderSync(current.body);
                const paid = encodeOrderSync({
                  ...order,
                  status: 'paid',
                  paidAt: isoDateSync('2026-01-01'),
                });
                entries.set(key, {
                  body: paid,
                  contentType: 'application/json',
                });
              }
            }
            return {
              sessionId: `cs_test_${params.idempotencyKey}`,
              url: `https://checkout.stripe.test/${params.idempotencyKey}`,
            };
          }),
        createRefund: () => Effect.die(new Error('unused')),
        constructEvent: () => Effect.succeed({}),
      }),
    );
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(mapStorage, racingPayment),
    );
    let notifyCount = 0;
    const action = registrationAction({
      notify: () =>
        Effect.sync(() => {
          notifyCount += 1;
        }),
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // First submit: a normal pending order (no flip yet).
    const first = await driveAction(runtime, action, body);
    expect((first as Response).status).toBe(303);
    expect(calls.length).toBe(1);

    // Capture the registrant's stamp BEFORE the racing resubmit (it is `pending`
    // from the first submit; the webhook that would flip it `paid` alongside the
    // order has not run in this race scenario). The racing resubmit must NOT write
    // it at all — so the stamp must be byte-identical after.
    const stampBefore = (await listRegistrations(runtime, args))[0]?.record
      .payment;
    expect(stampBefore?._tag).toBe('pending');

    // Second submit WITH the race armed: resolve sees pending → session mints (and
    // flips the order to paid) → the commit re-read sees `alreadyPaid`.
    flipNext = true;
    const second = await driveAction(runtime, action, body);
    expect(second).toBeInstanceOf(Response);
    // Lands on the existing `?checkout=success` receipt (303), NOT a Stripe url.
    expect((second as Response).status).toBe(303);
    expect((second as Response).headers.get('location')).toBe(
      'http://localhost/2026/form?checkout=success',
    );
    expect((second as Response).headers.get('location')).not.toContain(
      'checkout.stripe.test',
    );
    // No admin notify on the paid-race landing (no duplicate notification).
    expect(notifyCount).toBe(0);
    // Still exactly ONE order, still `paid` (the race flip stuck; the commit did
    // NOT overwrite it back to pending).
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(ordersAfter[0]!.order.status).toBe('paid');
    // The registrant stamp is UNTOUCHED by the racing resubmit — byte-identical to
    // the pre-resubmit value (the `alreadyPaid` branch skips the stamp loop
    // entirely, so nothing re-wrote the registrant record).
    const registrantsAfter = await listRegistrations(runtime, args);
    expect(registrantsAfter[0]?.record.payment).toEqual(stampBefore);
  });

  it('(ii) perRegistrant resubmit after EVERY registrant PAID lands on ?checkout=success — no link mail, no duplicate notify', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    let notifyCount = 0;
    let mailCount = 0;
    const action = registrationAction({
      notify: () =>
        Effect.sync(() => {
          notifyCount += 1;
        }),
      notifyPaymentLink: () =>
        Effect.sync(() => {
          mailCount += 1;
        }),
      success,
      perRegistrantSuccess,
    });
    const body = perRegistrantBody(2);
    const args = makeRegistrationArgs(runtime, body);

    // First submit: 2 pending per-registrant orders + 2 link mails.
    const first = await driveAction(runtime, action, body);
    expect((first as Response).status).toBe(302);
    expect(calls.length).toBe(2);
    expect(mailCount).toBe(2);

    // Mark BOTH per-registrant orders paid (the webhook reconciles each).
    const orders = await listOrders(runtime, args);
    expect(orders.length).toBe(2);
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        for (const { order } of orders) {
          yield* submissions.markOrderPaid('registration', order.orderId);
        }
      }),
    );
    mailCount = 0;

    // Resubmit the SAME payload: every chargeable registrant is already paid, so
    // there is nothing to mail — land on the existing `?checkout=success` receipt,
    // NOT the legacy notify/toast and NOT a fresh link mail.
    const second = await driveAction(runtime, action, body);
    expect(second).toBeInstanceOf(Response);
    expect((second as Response).status).toBe(303);
    expect((second as Response).headers.get('location')).toBe(
      'http://localhost/2026/form?checkout=success',
    );
    // No new sessions, no link mails, no admin notify.
    expect(calls.length).toBe(2);
    expect(mailCount).toBe(0);
    expect(notifyCount).toBe(0);
    // Both orders stayed `paid`, registrants kept their `paid` stamp.
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.every((e) => e.order.status === 'paid')).toBe(true);
    const registrantsAfter = await listRegistrations(runtime, args);
    expect(registrantsAfter.every((e) => e.record.payment?._tag === 'paid')).toBe(
      true,
    );
  });

  it('(iii) a setRegistrantPayment failure AFTER the order write self-heals on retry — the registrant ends stamped, never permanently skipped', async () => {
    // The round-3 --deep BLOCKER 2: the first submit writes the pending order, then
    // `setRegistrantPayment` FAILS — leaving the order pending but the registrant
    // un-stamped. A retry sees the order `reused`; the OLD code skipped stamping on
    // `reused`, stranding the registrant un-stamped FOREVER. The fix re-stamps on
    // `reused`, so the retry self-heals.
    const entries = new Map<string, { body: string; contentType: string }>();
    for (const [key, object] of Object.entries(pricedRegistrationObject())) {
      entries.set(key, { body: object.body, contentType: 'application/json' });
    }
    // Fail the registrant-record put that happens AFTER the order already landed —
    // i.e. the `setRegistrantPayment` write (persist's first write happens BEFORE
    // any order exists). `failStampWrites` arms exactly that window.
    let failStampWrites = false;
    const failingStorage = mapBackedStorage(entries, (key) => {
      if (!failStampWrites) return false;
      const isOrder = key.startsWith('submissions/registration/orders/');
      const orderExists = [...entries.keys()].some((k) =>
        k.startsWith('submissions/registration/orders/'),
      );
      // A registrant-record write (not the order) while an order already exists =
      // the post-order `setRegistrantPayment` stamp.
      return !isOrder && orderExists;
    });
    const calls: Array<CreateCheckoutSessionCall> = [];
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(failingStorage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // Attempt 1: the order writes, then the registrant stamp put FAILS → 500.
    failStampWrites = true;
    const firstThrown = await driveAction(runtime, action, body);
    expect(firstThrown).toBeInstanceOf(Response);
    expect((firstThrown as Response).status).toBe(500);
    // The order landed (pending), but the registrant is NOT yet stamped (the put
    // that would have stamped it failed).
    const ordersMid = await listOrders(runtime, args);
    expect(ordersMid.length).toBe(1);
    expect(ordersMid[0]!.order.status).toBe('pending');
    const registrantsMid = await listRegistrations(runtime, args);
    expect(registrantsMid[0]?.record.payment).toBeUndefined();

    // Attempt 2 (retry), storage healthy: the order is seen `reused`, and the fix
    // RE-stamps the registrant — so it self-heals instead of being skipped forever.
    failStampWrites = false;
    const second = await driveAction(runtime, action, body);
    expect((second as Response).status).toBe(303);
    // Still exactly ONE order (reused, not duplicated), still pending.
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(ordersAfter[0]!.order.status).toBe('pending');
    // The registrant is NOW stamped `pending` (the reuse self-healed the stamp).
    const registrantsAfter = await listRegistrations(runtime, args);
    const healed = registrantsAfter[0]?.record.payment;
    expect(healed?._tag).toBe('pending');
    // The healed stamp links the SAME (reused) order.
    if (healed?._tag === 'pending') {
      expect(healed.orderId).toBe(ordersAfter[0]!.order.orderId);
    }
  });

  it('(iv) case (c) resubmitted a THIRD time re-walks to the SAME generation — no runaway #gN', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // Submit 1 → pending order at the base generation. Expire it.
    await driveAction(runtime, action, body);
    const base = (await listOrders(runtime, args))[0]!.order;
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderExpired('registration', base.orderId);
      }),
    );

    // Submit 2 → a fresh pending order at generation #g1 (walks past the expired
    // base). The base stays expired.
    const second = await driveAction(runtime, action, body);
    expect((second as Response).status).toBe(303);
    const afterSecond = await listOrders(runtime, args);
    expect(afterSecond.length).toBe(2);
    const g1 = afterSecond.find((e) => e.order.status === 'pending')!.order;
    expect(g1.orderId).toBe(`${base.orderId}#g1`);

    // Submit 3 (the THIRD time): the #g1 order is still live-pending, so the
    // resubmit REUSES it — it does NOT walk to #g2. No runaway generations.
    const third = await driveAction(runtime, action, body);
    expect((third as Response).status).toBe(303);
    const afterThird = await listOrders(runtime, args);
    // STILL exactly two orders (expired base + the one reused #g1) — no #g2 minted.
    expect(afterThird.length).toBe(2);
    const pendings = afterThird.filter((e) => e.order.status === 'pending');
    expect(pendings.length).toBe(1);
    expect(pendings[0]!.order.orderId).toBe(`${base.orderId}#g1`);
    // No order key carries a #g2 (or higher) suffix.
    expect(
      afterThird.some((e) => /#g[2-9]/.test(e.order.orderId)),
    ).toBe(false);
  });

  it('(d2) a real Stripe idempotency-parameter MISMATCH on a live pending order fails OrderConflict — not just a mutated stored receipt', async () => {
    // Case (d) modeled at the REAL idempotency boundary (round-3 --deep MAJOR 2):
    // two genuinely-DIFFERENT submissions whose request fingerprints COLLIDE onto
    // the same deterministic orderId would mint orders with disagreeing frozen
    // money/receipt. We drive a first real submit to a live pending order, then a
    // second submit whose registrant set differs (a different party size) but is
    // forced onto the SAME orderId — the guard must reject the mismatch rather
    // than silently overwrite the in-flight order's frozen registrantIds.
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // First submit → a live pending order with its real frozen amount (1 registrant).
    await driveAction(runtime, action, body);
    const order = (await listOrders(runtime, args))[0]!.order;

    // Simulate a colliding DIFFERENT submission landing on the SAME orderId by
    // rewriting the live order's frozen `amount` (the idempotency-parameter the
    // session was keyed on) to a different value — exactly what a second distinct
    // checkout would carry. The guard compares the proposed amount (the real
    // priced amount) against this tampered stored amount.
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        const tamperedAmount = yield* Schema.decodeUnknownEffect(Cents)(
          order.amount + 1,
        );
        yield* submissions.persistOrder('registration', {
          ...order,
          amount: tamperedAmount,
        });
      }),
    );

    // Resubmit: the live pending order's frozen `amount` now disagrees with the
    // proposed (real) amount — an idempotency-parameter mismatch — so the guard
    // fails OrderConflict on `amount` rather than overwriting it.
    const result = await driveAction(runtime, action, body);
    expect(result).not.toBeInstanceOf(Response);
    const formResult = result as Exclude<typeof result, Response>;
    expect(formResult.status).toBe('error');
    expect(formResult.result.error?.formErrors?.[0]).toContain(
      'registration.checkout.conflict:amount',
    );
    // The tampered order was NOT overwritten back to the proposed amount.
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(Number(ordersAfter[0]!.order.amount)).toBe(Number(order.amount) + 1);
  });

  it('(d) a live PENDING order whose frozen fields CONFLICT fails explicitly — the in-flight order is NOT overwritten', async () => {
    const calls: Array<CreateCheckoutSessionCall> = [];
    const storage = sharedStorageLayer(pricedRegistrationObject());
    const runtime = makeRequestRuntimeFromLayer(
      stripeEnabledLayer(storage, Payment.testLayer({ calls })),
    );
    const action = registrationAction({
      notify: () => Effect.void,
      notifyPaymentLink: noopPaymentLink,
      success,
      perRegistrantSuccess,
    });
    const body = oneRegistrantGroupBody();
    const args = makeRegistrationArgs(runtime, body);

    // First submit → a live pending order. Mutate its frozen `amount` on the
    // bucket to simulate a fingerprint COLLISION: a different order's frozen
    // fields now live at the orderId the resubmit derives.
    await driveAction(runtime, action, body);
    const order = (await listOrders(runtime, args))[0]!.order;
    const tamperedReceipt = 'collision@example.com';
    await runtime.run(
      args,
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.persistOrder('registration', {
          ...order,
          receiptEmail: tamperedReceipt,
        });
      }),
    );

    // Resubmit the SAME payload: the live pending order's frozen receiptEmail now
    // disagrees with the proposed order, so the guard FAILS explicitly rather
    // than overwriting the in-flight order's receipt routing.
    const result = await driveAction(runtime, action, body);
    // A form-level validation error report (not a redirect Response).
    expect(result).not.toBeInstanceOf(Response);
    const formResult = result as Exclude<typeof result, Response>;
    expect(formResult.status).toBe('error');
    expect(formResult.result.error?.formErrors?.[0]).toContain(
      'registration.checkout.conflict:receiptEmail',
    );
    // The tampered order was NOT overwritten back to the proposed receipt.
    const ordersAfter = await listOrders(runtime, args);
    expect(ordersAfter.length).toBe(1);
    expect(ordersAfter[0]!.order.receiptEmail).toBe(tamperedReceipt);
    expect(ordersAfter[0]!.order.status).toBe('pending');
  });
});
