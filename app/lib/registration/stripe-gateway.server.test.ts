import { describe, expect, it } from 'effect-bun-test';
import { Effect, Option } from 'effect';

import { Cents } from '../forms/pricing';
import { OrderId } from './order-repository.server';
import {
  checkoutExpiresAt,
  type Client,
  makeLayer,
  StripeGateway,
  Unavailable,
  RequestFailed,
} from './stripe-gateway.server';

const command = {
  orderId: OrderId.make('order-1'),
  registrationId: 'registration-1',
  amount: Cents.make(0),
  receiptEmail: 'payer@example.com',
  idempotencyKey: 'checkout-order-1',
  now: Date.parse('2026-08-01T12:00:00Z'),
  quoteExpiresAt: Date.parse('2026-08-01T13:00:00Z'),
};

describe('StripeGateway', () => {
  it.effect('rejects a too-short quote instead of extending it past Registration close', () =>
    Effect.sync(() => {
      const now = Date.parse('2026-08-01T12:00:00.500Z');
      expect(checkoutExpiresAt(now, now + 10 * 60_000)).toBeUndefined();
      expect(checkoutExpiresAt(now, now + 60 * 60_000)).toBe(
        Math.floor((now + 60 * 60_000) / 1_000),
      );
      expect(checkoutExpiresAt(now, now + 48 * 60 * 60_000)).toBe(
        Math.floor((now + 24 * 60 * 60_000) / 1_000),
      );
    }),
  );

  it.effect('creates hosted Checkout for a zero-dollar frozen Order with stable metadata', () => {
    const calls: unknown[] = [];
    const client: Client = {
      createCheckout: (input, options) => {
        calls.push({ input, options });
        return Effect.succeed({
          id: 'cs_1',
          url: 'https://checkout.stripe.test/cs_1',
        });
      },
      refund: () => Effect.succeed({ id: 're_1', status: 'succeeded' }),
      constructEvent: () => Effect.succeed({}),
    };
    return Effect.gen(function* () {
      const gateway = yield* StripeGateway.Service;
      const checkout = yield* gateway.createCheckout(command);

      expect(checkout).toEqual({
        sessionId: 'cs_1',
        url: 'https://checkout.stripe.test/cs_1',
      });
      expect(calls).toEqual([
        {
          input: expect.objectContaining({
            mode: 'payment',
            client_reference_id: 'order-1',
            customer_email: 'payer@example.com',
            metadata: {
              orderId: 'order-1',
              registrationId: 'registration-1',
            },
            line_items: [
              expect.objectContaining({
                price_data: expect.objectContaining({ unit_amount: 0 }),
              }),
            ],
            success_url:
              'https://gyc.ca/registration/status?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://gyc.ca/registration/status?order=order-1',
          }),
          options: { idempotencyKey: 'checkout-order-1' },
        },
      ]);
    }).pipe(Effect.provide(makeLayer(Option.some(client))));
  });

  it.effect('fails closed when Stripe is not configured', () =>
    Effect.gen(function* () {
      const gateway = yield* StripeGateway.Service;
      expect(gateway.available).toBe(false);
      const error = yield* gateway.createCheckout(command).pipe(Effect.flip);
      expect(error).toBeInstanceOf(Unavailable);
    }).pipe(Effect.provide(makeLayer(Option.none()))),
  );

  it.effect('preserves the provider failure detail after adapter retries are exhausted', () => {
    const client: Client = {
      createCheckout: () => Effect.fail(new Error('provider unavailable')),
      refund: () => Effect.die('unused'),
      constructEvent: () => Effect.die('unused'),
    };
    return Effect.gen(function* () {
      const gateway = yield* StripeGateway.Service;
      const error = yield* gateway.createCheckout(command).pipe(Effect.flip);
      expect(error).toBeInstanceOf(RequestFailed);
      if (error instanceof RequestFailed) {
        expect(error.operation).toBe('create Checkout Session');
        expect(error.detail).toContain('provider unavailable');
      }
    }).pipe(Effect.provide(makeLayer(Option.some(client))));
  });

  it.effect('requests a full refund by PaymentIntent with Order metadata', () => {
    const calls: unknown[] = [];
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: (input, options) => {
        calls.push({ input, options });
        return Effect.succeed({ id: 're_1', status: 'succeeded' });
      },
      constructEvent: () => Effect.succeed({}),
    };
    return Effect.gen(function* () {
      const gateway = yield* StripeGateway.Service;
      const result = yield* gateway.refund({
        orderId: OrderId.make('order-1'),
        paymentIntentId: 'pi_1',
        idempotencyKey: 'refund-order-1',
      });
      expect(result).toEqual({ refundId: 're_1', status: 'succeeded' });
      expect(calls).toEqual([
        {
          input: {
            payment_intent: 'pi_1',
            reason: 'requested_by_customer',
            metadata: { orderId: 'order-1' },
          },
          options: { idempotencyKey: 'refund-order-1' },
        },
      ]);
    }).pipe(Effect.provide(makeLayer(Option.some(client))));
  });
});
