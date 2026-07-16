import { describe, expect, it, test } from 'effect-bun-test';
import { ConfigProvider, Effect, Layer } from 'effect';

import { Env } from './env.server';
import { Cents, CurrencyCode } from './forms/pricing';
import {
  Payment,
  PaymentDisabled,
  PaymentWebhookError,
} from './payment.server';

/**
 * C6 — the `Payment` boundary over the distilled Stripe SDK. These tests pin the
 * two contracts the registrar checkout (C7) and webhook (C8) build on, WITHOUT
 * any network:
 *
 *   - the `Env.stripe` `None`-gate: when stripe is unconfigured BOTH operations
 *     fail `PaymentDisabled` (the inert on-site path), mirroring `SendgridDisabled`;
 *   - the `Payment.testLayer` double proves the create-session SHAPE — a fake
 *     Checkout Session comes back with no network, threading amount/currency/
 *     receiptEmail/urls/metadata/idempotencyKey, and a verbatim retry (same
 *     idempotency key) yields the SAME session (the idempotency contract the
 *     registrar relies on so a retry never starts a second checkout).
 *
 * A live Stripe round-trip is deliberately NOT exercised here (it would require a
 * real key + network); the SDK call path typechecks against distilled's exported
 * operation/error types, and the wiring is proven through the double.
 */

/** An `Env` layer with no stripe vars ⇒ `Env.stripe` is `None`. */
const disabledEnv = Layer.provide(
  Env.layer,
  ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: { NODE_ENV: 'development' } }),
  ),
);

describe('Payment — Env.stripe None-gate', () => {
  it.effect('createCheckoutSession fails PaymentDisabled when stripe is unconfigured', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const payment = yield* Payment.Service;
          yield* payment.createCheckoutSession({
            amount: Cents.make(5000),
            currency: CurrencyCode.make('cad'),
            receiptEmail: 'payer@example.com',
            productName: 'GYC Canada registration',
            successUrl: 'https://gyc.test/2026/form?checkout=success',
            cancelUrl: 'https://gyc.test/2026/form?checkout=cancelled',
            metadata: { orderId: 'order-1' },
            idempotencyKey: 'registration:checkout:fp:group',
          });
        }),
      );
      expect(error).toBeInstanceOf(PaymentDisabled);
    }).pipe(Effect.provide(Layer.provide(Payment.layer, disabledEnv))),
  );

  it.effect('createRefund fails PaymentDisabled when stripe is unconfigured', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const payment = yield* Payment.Service;
          yield* payment.createRefund({
            sessionId: 'cs_test_1',
            amount: Cents.make(5000),
            idempotencyKey: 'registration:refund:order-1',
          });
        }),
      );
      expect(error).toBeInstanceOf(PaymentDisabled);
    }).pipe(Effect.provide(Layer.provide(Payment.layer, disabledEnv))),
  );

  it.effect('constructEvent fails PaymentDisabled when stripe is unconfigured', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const payment = yield* Payment.Service;
          yield* payment.constructEvent('{}', 't=1,v1=deadbeef');
        }),
      );
      expect(error).toBeInstanceOf(PaymentDisabled);
    }).pipe(Effect.provide(Layer.provide(Payment.layer, disabledEnv))),
  );
});

describe('Payment.testLayer — create-session double (no network)', () => {
  it.effect('returns a fake session and threads every create-session argument', () => {
    // The test owns the `calls` array the double pushes into, so it can assert
    // exactly what `createCheckoutSession` was invoked with.
    const calls: Array<Payment.CreateCheckoutSessionCall> = [];
    return Effect.gen(function* () {
      const payment = yield* Payment.Service;

      const session = yield* payment.createCheckoutSession({
        amount: Cents.make(12_000),
        currency: CurrencyCode.make('cad'),
        receiptEmail: 'payer@example.com',
        productName: 'GYC Canada registration',
        successUrl: 'https://gyc.test/2026/form?checkout=success',
        cancelUrl: 'https://gyc.test/2026/form?checkout=cancelled',
        metadata: { orderId: 'order-42', mode: 'group' },
        idempotencyKey: 'registration:checkout:fp42:group',
      });

      // No network — a deterministic fake session derived from the idempotency key,
      // carrying the hosted URL the registrar redirects the browser to.
      expect(session.sessionId).toBe('cs_test_registration:checkout:fp42:group');
      expect(session.url).toBe(
        'https://checkout.stripe.test/registration:checkout:fp42:group',
      );

      // Every argument threaded through verbatim (the wiring C7 freezes onto an order).
      expect(calls).toHaveLength(1);
      expect(calls[0]?.amount).toBe(Cents.make(12_000));
      expect(calls[0]?.currency).toBe(CurrencyCode.make('cad'));
      expect(calls[0]?.receiptEmail).toBe('payer@example.com');
      expect(calls[0]?.productName).toBe('GYC Canada registration');
      expect(calls[0]?.successUrl).toBe(
        'https://gyc.test/2026/form?checkout=success',
      );
      expect(calls[0]?.cancelUrl).toBe(
        'https://gyc.test/2026/form?checkout=cancelled',
      );
      expect(calls[0]?.metadata).toEqual({ orderId: 'order-42', mode: 'group' });
      expect(calls[0]?.idempotencyKey).toBe(
        'registration:checkout:fp42:group',
      );
    }).pipe(Effect.provide(Payment.testLayer({ calls })));
  });

  it.effect('replays the same session for a verbatim retry (same idempotency key)', () =>
    Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const key = 'registration:checkout:fp99:perRegistrant:0';

      const first = yield* payment.createCheckoutSession({
        amount: Cents.make(8000),
        currency: CurrencyCode.make('cad'),
        receiptEmail: 'one@example.com',
        productName: 'GYC Canada registration',
        successUrl: 'https://gyc.test/2026/form?checkout=success',
        cancelUrl: 'https://gyc.test/2026/form?checkout=cancelled',
        metadata: {},
        idempotencyKey: key,
      });
      const retry = yield* payment.createCheckoutSession({
        amount: Cents.make(8000),
        currency: CurrencyCode.make('cad'),
        receiptEmail: 'one@example.com',
        productName: 'GYC Canada registration',
        successUrl: 'https://gyc.test/2026/form?checkout=success',
        cancelUrl: 'https://gyc.test/2026/form?checkout=cancelled',
        metadata: {},
        idempotencyKey: key,
      });

      // Same idempotency key ⇒ same fake session (the no-second-checkout contract).
      expect(retry.sessionId).toBe(first.sessionId);
      expect(retry.url).toBe(first.url);
    }).pipe(Effect.provide(Payment.testLayer())),
  );

  it.effect('createRefund records the call (session + frozen amount + idempotency key) and returns a fake refund', () => {
    const refundCalls: Array<Payment.CreateRefundCall> = [];
    return Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const refund = yield* payment.createRefund({
        sessionId: 'cs_test_order-42',
        amount: Cents.make(15_000),
        idempotencyKey: 'registration:refund:order-42',
      });

      // The fake refund's ids derive from the session + key (no network), and the
      // resolved PaymentIntent is the session-derived stub (the production op
      // resolves it from the session via GetCheckoutSessionsSession).
      expect(refund.refundId).toBe('re_test_registration:refund:order-42');
      expect(refund.paymentIntentId).toBe('pi_test_cs_test_order-42');

      // The frozen amount + session + key threaded through verbatim.
      expect(refundCalls).toHaveLength(1);
      expect(refundCalls[0]?.sessionId).toBe('cs_test_order-42');
      expect(refundCalls[0]?.amount).toBe(Cents.make(15_000));
      expect(refundCalls[0]?.idempotencyKey).toBe(
        'registration:refund:order-42',
      );
    }).pipe(Effect.provide(Payment.testLayer({ refundCalls })));
  });

  it.effect('createRefund replays the same fake refund for a verbatim retry (same idempotency key)', () =>
    Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const params = {
        sessionId: 'cs_test_order-99',
        amount: Cents.make(8000),
        idempotencyKey: 'registration:refund:order-99',
      };
      const first = yield* payment.createRefund(params);
      const retry = yield* payment.createRefund(params);
      // Same key ⇒ same fake refund (the no-second-refund contract the durable
      // `refund` op relies on).
      expect(retry.refundId).toBe(first.refundId);
      expect(retry.paymentIntentId).toBe(first.paymentIntentId);
    }).pipe(Effect.provide(Payment.testLayer())),
  );

  it.effect('constructEvent returns the configured fake event', () =>
    Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const event = yield* payment.constructEvent('{}', 't=1,v1=abc');
      expect(event.type).toBe('checkout.session.completed');
    }).pipe(
      Effect.provide(
        Payment.testLayer({
          event: { type: 'checkout.session.completed' },
        }),
      ),
    ),
  );
});

// `PaymentWebhookError` is referenced by the webhook route (C8); assert it is a
// constructible tagged error here so the export contract is pinned.
describe('Payment — error contract', () => {
  test('PaymentWebhookError is a tagged error carrying an optional message', () => {
    const error = new PaymentWebhookError({ message: 'bad signature' });
    expect(error._tag).toBe('Payment.WebhookError');
    expect(error.message).toBe('bad signature');
  });
});
