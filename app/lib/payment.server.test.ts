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
 *   - the `Payment.testLayer` double proves the create-intent SHAPE — a fake
 *     intent comes back with no network, threading amount/currency/receiptEmail/
 *     metadata/idempotencyKey, and a verbatim retry (same idempotency key) yields
 *     the SAME intent (the idempotency contract the registrar relies on).
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
  it.effect('createIntent fails PaymentDisabled when stripe is unconfigured', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const payment = yield* Payment.Service;
          yield* payment.createIntent(
            Cents.make(5000),
            CurrencyCode.make('cad'),
            'payer@example.com',
            { orderId: 'order-1' },
            'registration:checkout:fp:group',
          );
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

describe('Payment.testLayer — create-intent double (no network)', () => {
  it.effect('returns a fake intent and threads every create-intent argument', () => {
    // The test owns the `calls` array the double pushes into, so it can assert
    // exactly what `createIntent` was invoked with.
    const calls: Array<Payment.CreateIntentCall> = [];
    return Effect.gen(function* () {
      const payment = yield* Payment.Service;

      const intent = yield* payment.createIntent(
        Cents.make(12_000),
        CurrencyCode.make('cad'),
        'payer@example.com',
        { orderId: 'order-42', mode: 'group' },
        'registration:checkout:fp42:group',
      );

      // No network — a deterministic fake intent derived from the idempotency key.
      expect(intent.intentId).toBe('pi_test_registration:checkout:fp42:group');
      expect(intent.clientSecret).toBe(
        'pi_test_registration:checkout:fp42:group_secret',
      );

      // Every argument threaded through verbatim (the wiring C7 freezes onto an order).
      expect(calls).toHaveLength(1);
      expect(calls[0]?.amount).toBe(Cents.make(12_000));
      expect(calls[0]?.currency).toBe(CurrencyCode.make('cad'));
      expect(calls[0]?.receiptEmail).toBe('payer@example.com');
      expect(calls[0]?.metadata).toEqual({ orderId: 'order-42', mode: 'group' });
      expect(calls[0]?.idempotencyKey).toBe(
        'registration:checkout:fp42:group',
      );
    }).pipe(Effect.provide(Payment.testLayer({ calls })));
  });

  it.effect('replays the same intent for a verbatim retry (same idempotency key)', () =>
    Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const key = 'registration:checkout:fp99:perRegistrant:0';

      const first = yield* payment.createIntent(
        Cents.make(8000),
        CurrencyCode.make('cad'),
        'one@example.com',
        {},
        key,
      );
      const retry = yield* payment.createIntent(
        Cents.make(8000),
        CurrencyCode.make('cad'),
        'one@example.com',
        {},
        key,
      );

      // Same idempotency key ⇒ same fake intent (the no-double-charge contract).
      expect(retry.intentId).toBe(first.intentId);
      expect(retry.clientSecret).toBe(first.clientSecret);
    }).pipe(Effect.provide(Payment.testLayer())),
  );

  it.effect('constructEvent returns the configured fake event', () =>
    Effect.gen(function* () {
      const payment = yield* Payment.Service;
      const event = yield* payment.constructEvent('{}', 't=1,v1=abc');
      expect(event.type).toBe('payment_intent.succeeded');
    }).pipe(
      Effect.provide(
        Payment.testLayer({
          event: { type: 'payment_intent.succeeded' },
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
