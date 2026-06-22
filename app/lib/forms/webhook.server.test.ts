import { describe, expect, it } from 'bun:test';
import {
  ConfigProvider,
  Effect,
  Layer,
  Result,
  Schema,
} from 'effect';
import { RouterContextProvider } from 'react-router';

import { Content } from '../content.server';
import { Env } from '../env.server';
import { newListItemId } from '../content/schema';
import { orderKey } from '../content/pages/registry';
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
 *      signature ⇒ 400, a valid `succeeded` with a matching amount flips the order
 *      to `paid`, an amount MISMATCH ⇒ 400 + the order stays pending, replaying
 *      the same event is idempotent, and `payment_failed` ⇒ `failed`.
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

/** A pending group order frozen at `amount`, seeded onto the bucket. */
const pendingOrder = (orderId: string, amount: number): RegistrationOrder => ({
  orderId,
  mode: 'group',
  intentId: `pi_${orderId}`,
  amount: Cents.make(amount),
  currency: CurrencyCode.make('cad'),
  receiptEmail: 'leader@example.com',
  status: 'pending',
  registrantIds: [newListItemId(), newListItemId()],
});

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

/** Seed one order onto a bucket under its real `orderKey`. */
const seed = (order: RegistrationOrder): Parameters<typeof layerTest>[0] => ({
  [orderKey('registration', order.orderId)]: {
    body: encodeOrder(order),
    contentType: 'application/json',
  },
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

/** A `payment_intent.*` event body whose intent carries `{ id, amount, metadata }`. */
const eventBody = (
  type: string,
  orderId: string,
  amount: number,
): string =>
  JSON.stringify({
    id: `evt_${orderId}`,
    type,
    data: {
      object: {
        id: `pi_${orderId}`,
        amount,
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

describe('/api/stripe/webhook (C8 route)', () => {
  it('rejects a forged signature with 400', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('payment_intent.succeeded', 'ord1', 15000);
    const args = webhookArgs(runtime, body, 't=1,v1=deadbeef');
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(400);
    // The forged event NEVER reconciled — the order stays pending.
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
  });

  it('flips the order to paid on a valid succeeded event with a matching amount', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('payment_intent.succeeded', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('paid');
  });

  it('rejects an amount MISMATCH with 400 and leaves the order pending', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    // The charged amount (9999) differs from the frozen order amount (15000).
    const body = eventBody('payment_intent.succeeded', 'ord1', 9999);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(400);
    expect(await readStatus(runtime, args, 'ord1')).toBe('pending');
  });

  it('is idempotent — replaying the same succeeded event keeps it paid', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('payment_intent.succeeded', 'ord1', 15000);
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

  it('flips the order to failed on a payment_failed event', async () => {
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord1', 15000))),
    );
    const body = eventBody('payment_intent.payment_failed', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('failed');
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
