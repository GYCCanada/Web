import { describe, expect, it } from 'bun:test';
import {
  ConfigProvider,
  Effect,
  Layer,
  Result,
  Schema,
} from 'effect';
import { TestClock } from 'effect/testing';
import { RouterContextProvider } from 'react-router';

import { Content } from '../content.server';
import { Env } from '../env.server';
import { type ListItemId, newListItemId } from '../content/schema';
import { defaultRegistrationForm } from '../content/pages/defaults';
import { orderKey, submissionKey } from '../content/pages/registry';
import {
  type AppLayer,
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { RegistrationOrder } from './order';
import { Cents, CurrencyCode } from './pricing';
import { submissionSchema } from './submission';
import { Submissions } from './submissions.server';

/**
 * Registrar plan C8 — the Stripe webhook's two halves:
 *
 *   1. The `Submissions` order-state flips (`markOrderPaid` / `markOrderFailed` /
 *      `getOrder`): the bucket-level reconcile primitives, pinned at the SERVICE
 *      level (no env, no HMAC) — the idempotent terminal-state short-circuit and
 *      the never-downgrade-a-paid-order guard.
 *   2. The route (`/api/stripe/webhook`) end-to-end through the real request
 *      runtime over an in-memory bucket + a configured-stripe `Env` (so the REAL
 *      `Payment.constructEvent` runs WebCrypto HMAC with no network): a forged
 *      signature ⇒ 400, a valid `checkout.session.completed` (paid) with a matching
 *      `amount_total` flips the order to `paid`, an amount MISMATCH ⇒ 400 + the
 *      order stays pending, an `unpaid` completion ⇒ 200 ack + the order stays
 *      pending, replaying the same event is idempotent, and an
 *      `checkout.session.async_payment_failed` ⇒ `failed`.
 */

const WEBHOOK_SECRET = 'whsec_test_c8';

/** The configured-stripe env the route's verify path needs (mirrors services.test). */
const STRIPE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '465',
  MAIL_USER: 'user',
  MAIL_PASS: 'secret',
  MAIL_FROM: 'from@example.com',
  MAIL_TO: 'to@example.com',
  STRIPE_API_KEY: 'sk_test_c8',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

/** Encode a `RegistrationOrder` to the JSON shape stored on the bucket. */
const encodeOrder = Schema.encodeSync(Schema.fromJsonString(RegistrationOrder));

/** The two registrant ids every seeded order names — seeded as real submissions. */
const REGISTRANT_IDS: readonly ListItemId[] = [newListItemId(), newListItemId()];

/** A pending group order frozen at `amount`, naming {@link REGISTRANT_IDS}. */
const pendingOrder = (orderId: string, amount: number): RegistrationOrder => ({
  orderId,
  mode: 'group',
  sessionId: `cs_${orderId}`,
  amount: Cents.make(amount),
  currency: CurrencyCode.make('cad'),
  receiptEmail: 'leader@example.com',
  status: 'pending',
  registrantIds: [...REGISTRANT_IDS],
});

/**
 * Encode one registrant `Submission` (a minimal valid exhibitor payload) to the
 * JSON shape `submissions/registration/<id>.json` holds — WITHOUT a `payment`
 * field, so the seed mirrors a record persisted before any order stamp (the
 * webhook flip is what stamps it). The webhook's registrant flip re-reads this
 * exact object, so it must decode against the live registration definition.
 */
const registrantSubmissionJson = (id: ListItemId): string =>
  Schema.encodeSync(Schema.fromJsonString(submissionSchema(defaultRegistrationForm)))(
    Schema.decodeUnknownSync(submissionSchema(defaultRegistrationForm))({
      id,
      form: 'registration',
      submittedAt: '2026-06-17',
      payload: {
        name: 'Ada Co',
        phone: '123-456-7890',
        type: 'exhibitor',
        synopsis: 'We sell books',
        website: 'https://example.com',
        company: 'Ada Books',
      },
    }),
  );

// ── (1) service-level order-state flips ───────────────────────────────────────

/**
 * Run an effect needing `Submissions` + `Storage` over a SHARED in-memory bucket
 * seeded with `objects` (mirrors `submissions.server.test.ts`'s
 * `provideSubmissions`), with `Env` the development default — the flips never
 * touch stripe. Returns a promise so the section runs as plain `bun:test` tests.
 */
const runSubmissions = <A, E>(
  objects: Parameters<typeof layerTest>[0],
  effect: Effect.Effect<A, E, Submissions.Service | Storage.Service>,
): Promise<A> => {
  const storage = layerTest(objects);
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.provideMerge(
          Submissions.layer,
          Layer.provideMerge(Content.layer, storage),
        ).pipe(Layer.provide(Env.defaultLayer)),
      ),
    ),
  );
};

/**
 * Seed one order onto a bucket under its real `orderKey`, ALONGSIDE the registrant
 * submissions it names (each a `payment`-less exhibitor record under its
 * `submissionKey`). The webhook's two-sided flip needs both present: the order to
 * amount-check + flip, and the registrant records to stamp `paid`/`failed`.
 */
const seed = (order: RegistrationOrder): Parameters<typeof layerTest>[0] => ({
  [orderKey('registration', order.orderId)]: {
    body: encodeOrder(order),
    contentType: 'application/json',
  },
  ...Object.fromEntries(
    order.registrantIds.map((id) => [
      submissionKey('registration', id),
      { body: registrantSubmissionJson(id), contentType: 'application/json' },
    ]),
  ),
});

/**
 * Read one stored registrant submission off the SHARED bucket (the same Storage
 * the service flips through) and return its `payment` tag (or `'none'`). Used
 * INSIDE a `runSubmissions` / runtime effect so it observes the post-flip state.
 */
const readRegistrantPaymentTag = (id: ListItemId) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const object = yield* storage.get(submissionKey('registration', id));
    const text = yield* Effect.promise(() =>
      new Response(object.stream).text(),
    );
    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(submissionSchema(defaultRegistrationForm)),
    )(text);
    return decoded.payment?._tag ?? 'none';
  });

/**
 * Read one stored registrant submission's RAW JSON bytes off the SHARED bucket —
 * the exact `submissions/registration/<id>.json` text on disk. Byte-identity of
 * this string across a webhook replay is the idempotency invariant: a replayed
 * `checkout.session.completed` on a LATER date must rewrite the SAME bytes (esp.
 * `paidAt` unchanged), not just the same `payment._tag`.
 */
const readRegistrantJson = (id: ListItemId) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const object = yield* storage.get(submissionKey('registration', id));
    return yield* Effect.promise(() => new Response(object.stream).text());
  });

describe('Submissions order-state flips (C8 reconcile primitives)', () => {
  it('markOrderPaid flips a pending order to paid', async () => {
    const status = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        const flipped = yield* submissions.markOrderPaid('registration', 'ord1');
        expect(flipped.status).toBe('paid');
        // The on-bucket record reflects the flip, not just the returned value.
        const reread = yield* submissions.getOrder('registration', 'ord1');
        return reread.status;
      }),
    );
    expect(status).toBe('paid');
  });

  it('markOrderPaid stamps EVERY named registrant submission paid (B2)', async () => {
    const tags = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', 'ord1');
        // The flip is two-sided: each registrant the order names carries `paid` on
        // its OWN submission envelope, not just the order (plan :695 / C8 :904).
        const a = yield* readRegistrantPaymentTag(REGISTRANT_IDS[0]!);
        const b = yield* readRegistrantPaymentTag(REGISTRANT_IDS[1]!);
        return [a, b];
      }),
    );
    expect(tags).toEqual(['paid', 'paid']);
  });

  it('markOrderPaid registrant flip is idempotent on replay (B2)', async () => {
    const tag = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', 'ord1');
        // Replaying the same event re-reads an already-paid order and re-stamps the
        // registrant byte-identically — still `paid`, no churn.
        yield* submissions.markOrderPaid('registration', 'ord1');
        return yield* readRegistrantPaymentTag(REGISTRANT_IDS[0]!);
      }),
    );
    expect(tag).toBe('paid');
  });

  it('markOrderPaid freezes paidAt — a replay on a LATER date is byte-identical (R2-paidAt)', async () => {
    // 2026-06-20 — the date the order first settles.
    const FIRST_PAID = Date.UTC(2026, 5, 20);
    // 2026-09-15 — Stripe re-delivers the SAME event months later. The registrant
    // record (and order) must NOT pick up this later date: `paidAt` is frozen once.
    const REPLAY_LATER = Date.UTC(2026, 8, 15);
    const storage = layerTest(seed(pendingOrder('ord1', 15000)));
    const [first, replay] = await Effect.runPromise(
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        // First delivery at FIRST_PAID — flips the order paid and stamps registrants.
        yield* TestClock.setTime(FIRST_PAID);
        yield* submissions.markOrderPaid('registration', 'ord1');
        const firstJson = yield* readRegistrantJson(REGISTRANT_IDS[0]!);
        const firstOrder = yield* submissions.getOrder('registration', 'ord1');
        // Stripe replays the SAME event MONTHS later — advance the clock first.
        yield* TestClock.setTime(REPLAY_LATER);
        yield* submissions.markOrderPaid('registration', 'ord1');
        const replayJson = yield* readRegistrantJson(REGISTRANT_IDS[0]!);
        const replayOrder = yield* submissions.getOrder('registration', 'ord1');
        return [
          { json: firstJson, paidAt: firstOrder.paidAt },
          { json: replayJson, paidAt: replayOrder.paidAt },
        ] as const;
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            Submissions.layer,
            Layer.provideMerge(Content.layer, storage),
          ).pipe(Layer.provide(Env.defaultLayer)),
        ),
        // Control the clock so the two deliveries land on DIFFERENT calendar dates.
        Effect.provide(TestClock.layer()),
        // `TestClock.setTime` schedules its latch wakeups in a `Scope`.
        Effect.scoped,
      ),
    );
    // The registrant record is BYTE-IDENTICAL across the replay — the frozen
    // `paidAt` did not drift to the later replay date.
    expect(replay.json).toBe(first.json);
    expect(first.json).toContain('"paidAt":"2026-06-20"');
    expect(replay.json).not.toContain('2026-09-15');
    // The order's own frozen stamp is the first-settled date, unchanged on replay.
    expect(String(first.paidAt)).toBe('2026-06-20');
    expect(String(replay.paidAt)).toBe('2026-06-20');
  });

  it('markOrderPaid is idempotent — replaying leaves it paid', async () => {
    const status = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', 'ord1');
        const replay = yield* submissions.markOrderPaid('registration', 'ord1');
        return replay.status;
      }),
    );
    expect(status).toBe('paid');
  });

  it('markOrderFailed flips a pending order to failed', async () => {
    const status = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        const flipped = yield* submissions.markOrderFailed('registration', 'ord1');
        return flipped.status;
      }),
    );
    expect(status).toBe('failed');
  });

  it('markOrderFailed stamps EVERY named registrant submission failed (B2)', async () => {
    const tags = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderFailed('registration', 'ord1');
        const a = yield* readRegistrantPaymentTag(REGISTRANT_IDS[0]!);
        const b = yield* readRegistrantPaymentTag(REGISTRANT_IDS[1]!);
        return [a, b];
      }),
    );
    expect(tags).toEqual(['failed', 'failed']);
  });

  it('markOrderFailed NEVER downgrades an already-paid order', async () => {
    const status = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', 'ord1');
        const stillPaid = yield* submissions.markOrderFailed('registration', 'ord1');
        return stillPaid.status;
      }),
    );
    expect(status).toBe('paid');
  });

  it('markOrderFailed never downgrades an already-PAID registrant (B2)', async () => {
    const tag = await runSubmissions(
      seed(pendingOrder('ord1', 15000)),
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        yield* submissions.markOrderPaid('registration', 'ord1');
        // A stray later failure for a settled order leaves the order AND its
        // registrants `paid` — the guard short-circuits before any registrant write.
        yield* submissions.markOrderFailed('registration', 'ord1');
        return yield* readRegistrantPaymentTag(REGISTRANT_IDS[0]!);
      }),
    );
    expect(tag).toBe('paid');
  });

  it('getOrder fails NotFound for an unknown order', async () => {
    const result = await runSubmissions(
      {},
      Effect.gen(function* () {
        const submissions = yield* Submissions.Service;
        return yield* submissions.getOrder('registration', 'nope').pipe(
          Effect.result,
        );
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('Storage.NotFound');
    }
  });
});

// ── (2) route end-to-end (real HMAC, configured stripe, in-memory bucket) ─────

/** The Stripe-signed-payload HMAC the SDK verifies: hex(HMAC-SHA256(`${t}.${body}`)). */
const signPayload = async (body: string, timestamp: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `t=${timestamp},v1=${hex}`;
};

/**
 * A `checkout.session.*` event body whose session carries
 * `{ id, amount_total, payment_status, metadata }`. `paymentStatus` defaults to
 * `'paid'` (a settled completion); pass `'unpaid'` to model a completion that did
 * NOT collect payment.
 */
const eventBody = (
  type: string,
  orderId: string,
  amount: number,
  paymentStatus: 'no_payment_required' | 'paid' | 'unpaid' = 'paid',
): string =>
  JSON.stringify({
    id: `evt_${orderId}`,
    type,
    data: {
      object: {
        id: `cs_${orderId}`,
        amount_total: amount,
        payment_status: paymentStatus,
        metadata: { orderId, mode: 'group' },
      },
    },
  });

/** Build a webhook POST `RouteArgs` over the shared runtime + a signed body. */
const webhookArgs = (
  runtime: RequestRuntime,
  body: string,
  signature: string | null,
): RouteArgs => {
  const url = 'http://localhost/api/stripe/webhook';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature;
  const request = new Request(url, { method: 'POST', body, headers });
  const context = new RouterContextProvider();
  context.runtime = runtime;
  return { request, url: new URL(url), pattern: '/api/stripe/webhook', params: {}, context };
};

/** The app layer with the configured-stripe env injected via a ConfigProvider. */
const stripeAppLayer = (objects: Parameters<typeof layerTest>[0]): AppLayer =>
  makeAppLayer(layerTest(objects)).pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: STRIPE_ENV }))),
  ) as AppLayer;

/** Read one order's status back through the SAME runtime/bucket the route used. */
const readStatus = (runtime: RequestRuntime, args: RouteArgs, orderId: string) =>
  runtime.run(
    args,
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;
      const order = yield* submissions.getOrder('registration', orderId);
      return order.status;
    }),
  );

/** Read a registrant submission's `payment` tag through the runtime's bucket. */
const readRegistrantTag = (
  runtime: RequestRuntime,
  args: RouteArgs,
  id: ListItemId,
) => runtime.run(args, readRegistrantPaymentTag(id));

describe('/api/stripe/webhook (C8 route)', () => {
  it('rejects a forged signature with 400', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('checkout.session.completed', 'ord1', 15000);
    const args = webhookArgs(runtime, body, 't=1,v1=deadbeef');
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(400);
    // The forged event NEVER reconciled — the order stays pending.
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
  });

  it('flips the order to paid on a valid completed (paid) event with a matching amount', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('checkout.session.completed', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('paid');
    // B2: the route's flip is two-sided — the REGISTRANT submission carries `paid`
    // on its own envelope, not just the order.
    expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[0]!)).toBe('paid');
    expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[1]!)).toBe('paid');
  });

  it('rejects an amount MISMATCH with 400 and leaves the order pending', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    // The charged amount (9999) differs from the frozen order amount (15000).
    const body = eventBody('checkout.session.completed', 'ord1', 9999);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(400);
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
    // The mismatch never reconciled — the registrant carries NO payment stamp.
    expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[0]!)).toBe('none');
  });

  it('is idempotent — replaying the same completed event keeps it paid', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('checkout.session.completed', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const { action } = await import('../../routes/api.stripe-webhook');
    // Each delivery is its OWN Request (a Request body streams once) — Stripe
    // re-delivers the same event bytes, so re-sign-free fresh args per call.
    expect((await action(webhookArgs(runtime, body, signature))).status).toBe(200);
    expect((await action(webhookArgs(runtime, body, signature))).status).toBe(200);
    expect(
      await readStatus(runtime, webhookArgs(runtime, body, signature), 'ord1'),
    ).toBe('paid');
  });

  it('flips the order to failed on an async_payment_failed event', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('checkout.session.async_payment_failed', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('failed');
  });

  it('acks an unpaid completed session with 200 and leaves the order pending', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    // A `checkout.session.completed` whose `payment_status` is `unpaid` is NOT a
    // settlement (e.g. an async/delayed payment method that never cleared) — the
    // endpoint acks it (200) without flipping the order or stamping registrants.
    const body = eventBody('checkout.session.completed', 'ord1', 15000, 'unpaid');
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
    expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[0]!)).toBe('none');
  });

  it('acks an unknown event type with 200 without touching the order', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('customer.created', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
  });
});
