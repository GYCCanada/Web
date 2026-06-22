import { describe, expect, it } from 'bun:test';
import { ConfigProvider, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { defaultRegistrationForm } from '../content/pages/defaults';
import { formObjectKey } from '../content/pages/registry';
import { formValidationError } from '../effect/errors';
import {
  type AppLayer,
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { type CreateCheckoutSessionCall, Payment } from '../payment.server';
import { type ObjectHead, NotFound, Storage, StorageError } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { FormDefinition } from './definition';
import { RegistrationOrder } from './order';
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
      expect(call.idempotencyKey).toMatch(
        new RegExp(`^registration:checkout:[a-f0-9]+:perRegistrant:${index}$`),
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
