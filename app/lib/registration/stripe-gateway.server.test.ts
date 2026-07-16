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
} from './stripe-gateway.server';

const command = {
  orderId: OrderId.make('order-1'),
  registrationId: 'registration-1',
  amount: Cents.make(0),
  receiptEmail: 'payer@example.com',
  idempotencyKey: 'checkout-order-1',
  now: Date.parse('2026-08-01T12:00:00Z'),
  quoteExpiresAt: Date.parse('2026-08-01T12:10:00Z'),
  successUrl: 'https://gyc.ca/registration/status/token',
  cancelUrl: 'https://gyc.ca/registration/status/token',
};

describe('StripeGateway', () => {
  it.effect('keeps Checkout expiry inside Stripe 30-minute/24-hour bounds', () =>
    Effect.sync(() => {
      const now = Date.parse('2026-08-01T12:00:00.500Z');
      expect(checkoutExpiresAt(now, now + 10 * 60_000)).toBe(
        Math.ceil((now + 30 * 60_000) / 1_000),
      );
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
      refund: () => Effect.void,
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
});
