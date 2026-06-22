import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';
import {
  ConfigProvider,
  DateTime,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Result,
  Schema,
} from 'effect';
import { ClusterError, MessageStorage } from 'effect/unstable/cluster';
import { TestClock } from 'effect/testing';
import { RouterContextProvider } from 'react-router';
import { isSuccess } from 'effect-encore';

import { Content } from '../content.server';
import { Env } from '../env.server';
import { IsoDate, type ListItemId, newListItemId } from '../content/schema';
import { defaultRegistrationForm } from '../content/pages/defaults';
import { orderKey, submissionKey } from '../content/pages/registry';
import {
  type AppLayer,
  makeAppLayer,
  makeRequestRuntimeFromLayer,
  type RequestRuntime,
} from '../effect/runtime';
import type { RouteArgs } from '../effect/router-context';
import { Order } from '../order/runner.server';
import { OrderActor } from '../order/order.actor';
import { Payment } from '../payment.server';
import { type ObjectHead, NotFound, Storage } from '../storage.server';
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

// ── (2b) the webhook cannot RESURRECT a terminal order (F1 — transition guards) ─

/**
 * F1 (final --deep BLOCKERs) — the webhook's bucket flips MUST agree with the G4
 * transition table (`order/transitions.ts`, the single source of truth). A late
 * `checkout.session.completed` racing a terminal `expired`/`cancelled`/`refunded`/
 * `failed` order must NOT resurrect it to `paid`, and a stray
 * `checkout.session.async_payment_failed` racing one of those terminals must NOT
 * overwrite it to `failed`. The guard runs at the BUCKET authority
 * (`markOrderPaid` / `markOrderFailed`), so the order AND its named registrant
 * submissions both stay frozen at the terminal state.
 *
 * A `paid` terminal carries the frozen `paidAt` (the bucket schema requires it on
 * a paid order); the other terminals carry no `paidAt`. None of these is `pending`,
 * so the late event's flip is illegal and a no-op.
 */
const terminalOrder = (
  orderId: string,
  amount: number,
  status: 'expired' | 'cancelled' | 'refunded' | 'failed' | 'paid',
): RegistrationOrder => ({
  ...pendingOrder(orderId, amount),
  status,
  ...(status === 'paid' ? { paidAt: IsoDate.make('2026-06-01') } : {}),
});

describe('/api/stripe/webhook — terminal orders cannot be resurrected (F1)', () => {
  const TERMINALS = ['expired', 'cancelled', 'refunded', 'failed'] as const;

  for (const terminal of TERMINALS) {
    it(`a completed (paid) event does NOT resurrect a ${terminal} order to paid, nor restamp registrants`, async () => {
      const runtime = makeRequestRuntimeFromLayer(
        stripeAppLayer(seed(terminalOrder('ord1', 15000, terminal))),
      );
      const body = eventBody('checkout.session.completed', 'ord1', 15000);
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      const args = webhookArgs(runtime, body, signature);
      const { action } = await import('../../routes/api.stripe-webhook');
      const response = await action(args);
      // The bucket flip is a guarded no-op (the order is already terminal), so the
      // webhook still 200s — but the order STAYS at its terminal state, and the
      // registrants are NOT restamped `paid`.
      expect(response.status).toBe(200);
      expect(await readStatus(runtime, args, 'ord1')).toBe(terminal);
      expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[0]!)).toBe(
        'none',
      );
      expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[1]!)).toBe(
        'none',
      );
    });

    it(`an async_payment_failed event leaves a ${terminal} order UNTOUCHED (no overwrite to failed)`, async () => {
      const runtime = makeRequestRuntimeFromLayer(
        stripeAppLayer(seed(terminalOrder('ord1', 15000, terminal))),
      );
      const body = eventBody(
        'checkout.session.async_payment_failed',
        'ord1',
        15000,
      );
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      const args = webhookArgs(runtime, body, signature);
      const { action } = await import('../../routes/api.stripe-webhook');
      const response = await action(args);
      // `markOrderFailed` is now pending-or-failed ONLY, so a stray failure event
      // for a terminal order keeps the order at its terminal STATE — it is never
      // overwritten to a DIFFERENT state. For `expired`/`cancelled`/`refunded` the
      // guard rejects the flip outright (registrants untouched); for an already-
      // `failed` order the flip is the legal IDENTITY case (`failed → failed`), a
      // byte-identical idempotent re-stamp, NOT a resurrection or downgrade.
      expect(response.status).toBe(200);
      expect(await readStatus(runtime, args, 'ord1')).toBe(terminal);
      expect(await readRegistrantTag(runtime, args, REGISTRANT_IDS[0]!)).toBe(
        terminal === 'failed' ? 'failed' : 'none',
      );
    });
  }

  it('a completed (paid) event on a paid order is idempotent — no registrant restamp drift', async () => {
    // `paid → paid` is the identity case (legal), so the flip converges to the
    // SAME bytes (the frozen `paidAt`), not a resurrection: the registrant
    // re-stamp is byte-identical (idempotent), never a downgrade or a re-clock.
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(terminalOrder('ord1', 15000, 'paid'))),
    );
    const body = eventBody('checkout.session.completed', 'ord1', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord1')).toBe('paid');
  });
});

// ── (3) the durable Order loop — webhook resolves `settle` via SQL MessageStorage ─

/**
 * order-workflow G8 — the webhook's `settle` drive end-to-end across the REAL
 * two-runtime topology. The webhook (the `AppRuntime` SENDER) `send`s the durable
 * `settle` op through the SAME SQL MessageStorage the `ServerLive` RUNNER
 * consumes; the runner runs the `pending → paid` continuation (mirrored into actor
 * State) and writes the durable reply, which a separate sender's `waitFor`
 * observes terminal. The two graphs coordinate ONLY through ONE shared sqlite FILE
 * + ONE shared bucket (the production seam, §1 two-runtime topology) — never an
 * in-memory layer instance.
 *
 * The webhook's bucket `markOrderPaid` flip stays the RECEIPT AUTHORITY (asserted
 * unchanged); the durable `settle` is the ADDITIVE durable lifecycle. The DB-less
 * path degrades to the bucket-only flip (backward compatible), proven below.
 */

/** A SINGLE shared Map-backed `Storage` layer (one bucket across BOTH graphs). */
const sharedStorageLayer = (
  seed: Parameters<typeof layerTest>[0] = {},
): Layer.Layer<Storage.Service> => {
  const entries = new Map<string, { body: string; contentType: string }>();
  for (const [key, object] of Object.entries(seed)) {
    entries.set(key, {
      body: String(object.body),
      contentType: object.contentType ?? 'application/json',
    });
  }
  return Layer.sync(Storage.Service, () =>
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
      put: Effect.fn('Storage.put')(
        (key: string, body: string | Uint8Array, contentType: string) =>
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

const tmpDbFile = (suffix: string): string =>
  `${tmpdir()}/gyc-order-webhook-${process.pid}-${Date.now()}-${suffix}.sqlite`;

/** The DB+stripe-enabled env: a sqlite FILE on disk (NOT `:memory:` — both graphs share it). */
const dbStripeEnv = (dbFile: string): Record<string, string> => ({
  ...STRIPE_ENV,
  DATABASE_URL: dbFile,
});

/**
 * Stand up the full durable two-runtime stack over ONE shared bucket + ONE shared
 * sqlite FILE, seeded with `order`:
 *
 *   - a live RUNNER graph (the `ServerLive` analog): the FULL Order runner over
 *     the shared file + the `arm`/`settle`/… handlers, with `Submissions` over the
 *     SHARED bucket so the `settle` handler's bucket read/flip lands where the
 *     webhook reads it;
 *   - a webhook AppRuntime (the `AppRuntime` SENDER analog): the real
 *     `makeAppLayer` over the SHARED bucket + the DB+stripe env, so the webhook's
 *     `settleOrder` drive builds the real sender over the SAME file;
 *   - a side SENDER graph (a SEPARATE sender build, distinct SqlClient over the
 *     SAME file) the assertions use to `waitFor`/`peek`/`executionId` the durable
 *     `settle` reply WITHOUT going through the webhook.
 *
 * `arm`s the order to `pending` on the runner first (the durable lifecycle anchor,
 * exactly as the registration action does, G7.1) so the entity exists before the
 * webhook drives `settle`. Returns the graphs + a disposer.
 */
const durableStack = async (order: RegistrationOrder) => {
  const dbFile = tmpDbFile(order.orderId);
  const storage = sharedStorageLayer(seed(order));
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: dbStripeEnv(dbFile) }),
  );

  const submissions = Layer.provideMerge(
    Submissions.layer,
    Layer.provideMerge(Content.layer, storage),
  );

  // RUNNER graph (ServerLive analog): the handlers consume the shared mailbox and
  // flip the SHARED bucket.
  const runner = ManagedRuntime.make(
    Order.fullRunnerLayer(Order.MessageStorageLive).pipe(
      Layer.provide(submissions),
      Layer.provide(Payment.testLayer()),
      Layer.provide(Env.layer),
      Layer.provide(config),
    ),
  );

  // Side SENDER graph (the webhook analog for assertions) over the SAME file.
  const sender = ManagedRuntime.make(
    Order.senderLayer(Order.MessageStorageLive).pipe(
      Layer.provide(Env.layer),
      Layer.provide(config),
    ),
  );

  // The webhook AppRuntime (the real request graph) over the SHARED bucket + DB env.
  const webhookRuntime = makeRequestRuntimeFromLayer(
    makeAppLayer(storage).pipe(Layer.provide(config)) as AppLayer,
  );

  // A read runtime that EXPOSES `Submissions.Service` over the SHARED bucket, so
  // the assertions can derive the actor `OrderState` VIEW (`OrderActor.readState`)
  // off the very bucket the runner's handlers flipped.
  const readRuntime = ManagedRuntime.make(submissions);

  // Boot the runner so its mailbox-poll fiber consumes the shared file.
  await runner.runPromise(Effect.void);
  // Anchor the entity at `pending` (the action's `arm`, G7.1) before settling.
  await sender.runPromise(
    Order.Entity.arm.send({
      orderId: order.orderId,
      mode: order.mode,
      amount: order.amount,
      currency: order.currency,
      receiptEmail: order.receiptEmail,
      sessionId: order.sessionId,
      registrantIds: order.registrantIds,
      deadline: order.deadline,
    }),
  );

  return {
    webhookRuntime,
    /** Resolve the durable `settle` reply for `orderId` from the side sender. */
    settleResult: (orderId: string) =>
      sender.runPromise(
        Order.Entity.settle.waitFor(
          {
            orderId,
            outcome: undefined,
            sessionId: undefined,
            paymentIntentId: undefined,
          },
          { filter: (result) => result._tag !== 'Pending' },
        ),
      ),
    /** Peek the durable `settle` reply WITHOUT waiting (for the unresolved case). */
    settlePeek: (orderId: string) =>
      sender.runPromise(
        Order.Entity.settle.peek({
          orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        }),
      ),
    /** The derived actor `OrderState` VIEW, read on the runner's SHARED bucket. */
    actorState: (orderId: string) =>
      readRuntime.runPromise(OrderActor.readState(orderId)),
    /** The webhook-side `settle` ExecId derived from the `{ orderId }`-only payload. */
    webhookExecId: (orderId: string) =>
      sender.runPromise(
        Order.Entity.settle.executionId({
          orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        }),
      ),
    dispose: async () => {
      await runner.dispose();
      await sender.dispose();
      await readRuntime.dispose();
    },
  };
};

describe('/api/stripe/webhook — durable Order settle drive (order-workflow G8)', () => {
  it('resolves settle to Success across the SQL MessageStorage: State + bucket paid, replay byte-identical', async () => {
    const order = pendingOrder('ord-g8-paid', 15000);
    const stack = await durableStack(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    try {
      const body = eventBody('checkout.session.completed', order.orderId, 15000);
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      const args = webhookArgs(stack.webhookRuntime, body, signature);

      const response = await action(args);
      expect(response.status).toBe(200);

      // The durable `settle` op resolved Success on the runner ...
      const settled = await stack.settleResult(order.orderId);
      expect(settled._tag).toBe('Success');

      // ... the actor State (derived view over the SHARED bucket) reads `paid` ...
      const state = await stack.actorState(order.orderId);
      expect(state.status).toBe('paid');
      expect(state.paidAt).toBeDefined();

      // ... and the bucket order (the RECEIPT AUTHORITY the webhook flipped) is
      // `paid` with a frozen `paidAt`.
      const paid = await readStatus(stack.webhookRuntime, args, order.orderId);
      expect(paid).toBe('paid');

      // A verbatim REPLAY POST is a 200 no-op leaving `paidAt` byte-identical
      // (encore dedup re-resolves the already-terminal ExecId; `markOrderPaid`
      // freezes `paidAt`).
      const replayBody = eventBody(
        'checkout.session.completed',
        order.orderId,
        15000,
      );
      const replaySig = await signPayload(
        replayBody,
        Math.floor(Date.now() / 1000),
      );
      const replayArgs = webhookArgs(
        stack.webhookRuntime,
        replayBody,
        replaySig,
      );
      const firstPaidAt = String(state.paidAt);
      expect((await action(replayArgs)).status).toBe(200);
      const afterReplay = await stack.actorState(order.orderId);
      expect(String(afterReplay.paidAt)).toBe(firstPaidAt);
    } finally {
      await stack.dispose();
    }
  });

  it('ExecId round-trip (Decision 4): the webhook `{ orderId }`-only ExecId equals the manual format the runner replied to', async () => {
    const order = pendingOrder('ord-g8-execid', 15000);
    const stack = await durableStack(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    try {
      const body = eventBody('checkout.session.completed', order.orderId, 15000);
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      await action(webhookArgs(stack.webhookRuntime, body, signature));

      // The webhook holds only `metadata.orderId`, yet its `{ orderId }`-only
      // payload derives the SAME ExecId the runner keyed its reply by — `id`
      // ignores every other payload field (the property the whole G8 resolution
      // hinges on). It also equals the manually formatted
      // `entityId\x00tag\x00primaryKey` string.
      const webhookExecId = await stack.webhookExecId(order.orderId);
      const manual = `${order.orderId}\x00settle\x00${order.orderId}`;
      expect(String(webhookExecId)).toBe(manual);

      // And the reply that ExecId resolves is the runner's terminal Success.
      const settled = await stack.settleResult(order.orderId);
      expect(isSuccess(settled)).toBe(true);
    } finally {
      await stack.dispose();
    }
  });

  it('an amount MISMATCH leaves the settle op UNRESOLVED + the order pending + 400', async () => {
    const order = pendingOrder('ord-g8-mismatch', 15000);
    const stack = await durableStack(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    try {
      // The charged amount (9999) differs from the frozen order amount (15000) —
      // the verified-amount guard short-circuits BEFORE the settle drive.
      const body = eventBody('checkout.session.completed', order.orderId, 9999);
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      const args = webhookArgs(stack.webhookRuntime, body, signature);

      const response = await action(args);
      expect(response.status).toBe(400);

      // The order stays pending (the bucket authority never flipped) ...
      expect(await readStatus(stack.webhookRuntime, args, order.orderId)).toBe(
        'pending',
      );
      // ... and the durable `settle` op was NEVER sent — its reply is Pending
      // (only the `arm` anchor exists, no settle send happened).
      const peeked = await stack.settlePeek(order.orderId);
      expect(peeked._tag).toBe('Pending');
    } finally {
      await stack.dispose();
    }
  });

  it('async_payment_failed flips the bucket failed AND resolves settle to a Failure (no regression, Decision 7)', async () => {
    const order = pendingOrder('ord-g8-failed', 15000);
    const stack = await durableStack(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    try {
      const body = eventBody(
        'checkout.session.async_payment_failed',
        order.orderId,
        15000,
      );
      const signature = await signPayload(body, Math.floor(Date.now() / 1000));
      const args = webhookArgs(stack.webhookRuntime, body, signature);

      const response = await action(args);
      expect(response.status).toBe(200);

      // The bucket flipped `failed` (the existing webhook behavior, preserved) ...
      expect(await readStatus(stack.webhookRuntime, args, order.orderId)).toBe(
        'failed',
      );
      // ... and the durable `settle` resolved to a Failure (`SettleFailed`) — the
      // op terminal, the durable reply a Failure, mirroring the bucket `failed`.
      const settled = await stack.settleResult(order.orderId);
      expect(settled._tag).toBe('Failure');
    } finally {
      await stack.dispose();
    }
  });
});

/**
 * Build the webhook AppRuntime (the `AppRuntime` SENDER) over a DB-configured env
 * + shared bucket but DELIBERATELY boot NO runner: the SQL MessageStorage exists
 * (the `settle` `send` lands durably) but NOTHING consumes the mailbox, so the
 * persisted reply never goes terminal. This models the single-instance partial
 * failure where the runner/sweep fiber has defected while the HTTP server keeps
 * serving — `waitFor` would poll the never-terminal reply forever. Returns the
 * webhook runtime (no runner/sender exist to tear down; the bucket is in-memory).
 */
const runnerlessWebhookRuntime = (order: RegistrationOrder): RequestRuntime => {
  const dbFile = tmpDbFile(order.orderId);
  const storage = sharedStorageLayer(seed(order));
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: dbStripeEnv(dbFile) }),
  );
  return makeRequestRuntimeFromLayer(
    makeAppLayer(storage).pipe(Layer.provide(config)) as AppLayer,
  );
};

describe('/api/stripe/webhook — settle drive is BOUNDED when the runner is down (G8 200-guarantee)', () => {
  it('returns 200 within the timeout bound (not hang) when NO runner consumes the mailbox', async () => {
    // DB IS configured (so `settleOrder` runs the real `send` + bounded `waitFor`),
    // but no runner is booted — the mailbox is never consumed, so the durable reply
    // stays Pending FOREVER. An unbounded `waitFor` would hang the request fiber and
    // never return; the `Effect.timeout('5 seconds')` bound degrades to the
    // swallow-and-200 path the drive already claims. The bucket flip (the receipt
    // authority) still earned the 200.
    const order = pendingOrder('ord-g8-norunner', 15000);
    const runtime = runnerlessWebhookRuntime(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    const body = eventBody('checkout.session.completed', order.orderId, 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);

    const started = Date.now();
    const response = await action(args);
    const elapsed = Date.now() - started;

    // The action returned 200 (the bucket flip's status) rather than hanging ...
    expect(response.status).toBe(200);
    // ... and it returned within the bound + slack (well under an unbounded hang).
    expect(elapsed).toBeLessThan(8000);
    // ... and the bucket order (the receipt authority) is `paid` regardless of
    // the dead runner — the durable `send` landed and reconciles on recovery.
    expect(await readStatus(runtime, args, order.orderId)).toBe('paid');
  }, 15000);
});

/**
 * (F3) A webhook AppRuntime whose Order SENDER is wired over a FAULTY
 * `MessageStorage`: it DELEGATES every method to the real `MessageStorageLive`
 * (over a real shared sqlite FILE, so `Env.database` is genuinely Some and the
 * `settleOrder` drive runs) EXCEPT `saveRequest`, which fails with a typed
 * `PersistenceError` — modelling a SQL/mailbox fault on the durable `settle.send`
 * write. `send` calls `mailbox.send → storage.saveRequest` (effect-encore
 * `actor-mailbox.js`), so this fails the `send` with a `PersistenceError` (mapped
 * by `Entity.settle.send` into `Order.SettleSendError`) BEFORE any durable row
 * lands. The faulty sender is injected through `makeAppLayer`'s `senderLayer`
 * test seam (mirroring the existing `paymentLayer` seam), shadowing the real
 * `appSenderLayer` for this one runtime only.
 */
const faultySenderWebhookRuntime = (order: RegistrationOrder): RequestRuntime => {
  const dbFile = tmpDbFile(order.orderId);
  const storage = sharedStorageLayer(seed(order));
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: dbStripeEnv(dbFile) }),
  );
  // Decorate the real storage: every method delegates to `MessageStorageLive`
  // (resolved from the underlying provide), but `saveRequest` fails — so the
  // `settle.send` write fails with a `PersistenceError` while every other read
  // (the runner has none here anyway) stays faithful.
  const faultyStorage = Layer.effect(
    MessageStorage.MessageStorage,
    Effect.gen(function* () {
      const real = yield* MessageStorage.MessageStorage;
      return MessageStorage.MessageStorage.of({
        ...real,
        saveRequest: () =>
          Effect.fail(
            new ClusterError.PersistenceError({
              cause: new Error('injected: settle.send mailbox write failed'),
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(Order.MessageStorageLive));

  // Mirror `appSenderLayer`'s `orDie` on the real DB branch: `Env.database` IS Some
  // here, so `MessageStorageLive`'s `DatabaseUnconfigured` gate cannot fire — `orDie`
  // discharges it to keep the sender's error channel `never` (the seam `makeAppLayer`
  // requires). The INJECTED `saveRequest` `PersistenceError` is in the per-op `send`
  // channel, not the layer build, so it is untouched by `orDie`.
  const appLayer = makeAppLayer(
    storage,
    undefined,
    Order.senderLayer(faultyStorage).pipe(Layer.orDie),
  ).pipe(Layer.provide(config)) as AppLayer;
  return makeRequestRuntimeFromLayer(appLayer);
};

describe('/api/stripe/webhook — settle `send` persistence failure fails the response so Stripe retries (F3)', () => {
  it('a completed paid event whose durable `settle.send` cannot persist returns a retryable 502', async () => {
    // The `settle.send` write fails with a `PersistenceError` BEFORE the durable
    // row lands. F3: this MUST NOT be swallowed into a 200 — with no durable
    // settle the runner has nothing to reconcile (a lost-settle money hazard), so
    // the webhook returns a retryable 502 and Stripe retries until the send lands.
    const order = pendingOrder('ord-f3-sendfail', 15000);
    const runtime = faultySenderWebhookRuntime(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    const body = eventBody(
      'checkout.session.completed',
      order.orderId,
      15000,
    );
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);

    const response = await action(args);
    // Non-2xx — Stripe retries (the durable settle never persisted).
    expect(response.status).toBe(502);
    // The bucket DID flip paid (the receipt authority earned it before the drive);
    // the F1 `canTransition` identity case makes the inevitable Stripe RETRY a safe
    // no-op on the already-paid bucket, re-driving only the failed `send`.
    expect(await readStatus(runtime, args, order.orderId)).toBe('paid');
  });

  it('an async_payment_failed event whose durable `settle.send` cannot persist also returns a retryable 502', async () => {
    // The `async_payment_failed` path drives `settle` with `outcome: 'failed'`;
    // its `send` persistence failure is fatal for the same reason — fail the
    // response so Stripe retries. The bucket already flipped `failed`; the F1
    // `markOrderFailed` identity case makes the retry a safe no-op.
    const order = pendingOrder('ord-f3-failsend', 15000);
    const runtime = faultySenderWebhookRuntime(order);
    const { action } = await import('../../routes/api.stripe-webhook');
    const body = eventBody(
      'checkout.session.async_payment_failed',
      order.orderId,
      15000,
    );
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);

    const response = await action(args);
    expect(response.status).toBe(502);
    expect(await readStatus(runtime, args, order.orderId)).toBe('failed');
  });
});

describe('/api/stripe/webhook — wait-timeout AFTER a successful `send` still 200s + converges (F3)', () => {
  it('the durable `send` LANDS, the runner is down so the wait times out, yet the webhook 200s and the runner converges on recovery', async () => {
    // The F3 split swallows ONLY the post-`send` `waitFor`/timeout. Here the
    // `send` SUCCEEDS (the durable row lands in the shared mailbox) but NO runner
    // consumes it, so the bounded `waitFor` times out. That is safe to 200: the
    // durable row is persisted, so the runner reconciles it on recovery. This is
    // the SAME runner-down stack as the G8 200-guarantee, asserted here for the
    // `send`-succeeds-wait-fails half of the split — and we prove convergence by
    // booting a runner against the SAME file afterward and observing the durable
    // settle resolve to a terminal reply.
    const order = pendingOrder('ord-f3-waittimeout', 15000);
    const dbFile = tmpDbFile(order.orderId);
    const storage = sharedStorageLayer(seed(order));
    const config = ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: dbStripeEnv(dbFile) }),
    );

    const submissions = Layer.provideMerge(
      Submissions.layer,
      Layer.provideMerge(Content.layer, storage),
    );
    // The webhook AppRuntime over the REAL sender (durable send LANDS), no runner.
    const webhookRuntime = makeRequestRuntimeFromLayer(
      makeAppLayer(storage).pipe(Layer.provide(config)) as AppLayer,
    );
    // A side sender over the SAME file to anchor `arm` and later read the reply.
    const sender = ManagedRuntime.make(
      Order.senderLayer(Order.MessageStorageLive).pipe(
        Layer.provide(Env.layer),
        Layer.provide(config),
      ),
    );
    // Anchor the entity at `pending` (the action's `arm`) before settling.
    await sender.runPromise(
      Order.Entity.arm.send({
        orderId: order.orderId,
        mode: order.mode,
        amount: order.amount,
        currency: order.currency,
        receiptEmail: order.receiptEmail,
        sessionId: order.sessionId,
        registrantIds: order.registrantIds,
        deadline: order.deadline,
      }),
    );

    const { action } = await import('../../routes/api.stripe-webhook');
    const body = eventBody('checkout.session.completed', order.orderId, 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(webhookRuntime, body, signature);

    try {
      const started = Date.now();
      const response = await action(args);
      const elapsed = Date.now() - started;

      // 200 (the bucket flip's status) — the post-send wait timed out but was
      // swallowed, NOT propagated, because the durable `send` already landed.
      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(8000);
      expect(await readStatus(webhookRuntime, args, order.orderId)).toBe('paid');

      // The durable `settle` row PERSISTED (the send succeeded): the reply is
      // Pending while no runner consumes it — proving the row is in storage to
      // reconcile, not lost.
      const pending = await sender.runPromise(
        Order.Entity.settle.peek({
          orderId: order.orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        }),
      );
      expect(pending._tag).toBe('Pending');

      // CONVERGENCE: boot a runner against the SAME file; it consumes the
      // persisted `send` and resolves the durable settle to a terminal reply.
      const runner = ManagedRuntime.make(
        Order.fullRunnerLayer(Order.MessageStorageLive).pipe(
          Layer.provide(submissions),
          Layer.provide(Payment.testLayer()),
          Layer.provide(Env.layer),
          Layer.provide(config),
        ),
      );
      await runner.runPromise(Effect.void);
      try {
        const settled = await sender.runPromise(
          Order.Entity.settle.waitFor(
            {
              orderId: order.orderId,
              outcome: undefined,
              sessionId: undefined,
              paymentIntentId: undefined,
            },
            { filter: (result) => result._tag !== 'Pending' },
          ),
        );
        expect(settled._tag).toBe('Success');
      } finally {
        await runner.dispose();
      }
    } finally {
      await sender.dispose();
    }
  }, 20000);
});

describe('/api/stripe/webhook — DB-less degrades to the bucket-only flip (G8 backward compat)', () => {
  it('a completed paid event still 200s + flips the bucket paid with NO DB configured', async () => {
    // The default `stripeAppLayer` has NO `DATABASE_URL`, so `Env.database` is
    // None — the webhook's `settleOrder` drive is skipped entirely and the bucket
    // flip is the sole reconcile (the pre-G8 behavior, unchanged).
    const runtime = makeRequestRuntimeFromLayer(
      stripeAppLayer(seed(pendingOrder('ord-no-db', 15000))),
    );
    const body = eventBody('checkout.session.completed', 'ord-no-db', 15000);
    const signature = await signPayload(body, Math.floor(Date.now() / 1000));
    const args = webhookArgs(runtime, body, signature);
    const { action } = await import('../../routes/api.stripe-webhook');
    const response = await action(args);
    expect(response.status).toBe(200);
    expect(await readStatus(runtime, args, 'ord-no-db')).toBe('paid');
  });
});
