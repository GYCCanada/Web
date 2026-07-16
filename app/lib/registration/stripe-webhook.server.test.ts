import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Option } from 'effect';

import { OrderActor } from './order-actor.server';
import { StripeEventId } from './order-repository.server';
import {
  type Client,
  makeLayer as stripeLayer,
} from './stripe-gateway.server';
import {
  processStripeWebhook,
  Rejected,
} from './stripe-webhook.server';

const request = () =>
  new Request('https://gyc.ca/api/stripe/webhook', {
    method: 'POST',
    body: '{"exact":"raw body"}',
    headers: { 'stripe-signature': 't=123,v1=signature' },
  });

describe('Stripe webhook boundary', () => {
  it.effect('verifies exact raw bytes and durably sends the normalized event', () => {
    const verified: unknown[] = [];
    const sent: unknown[] = [];
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: () => Effect.die('unused'),
      constructEvent: (payload, signature) => {
        verified.push({
          payload:
            typeof payload === 'string'
              ? payload
              : new TextDecoder().decode(payload),
          signature,
        });
        return Effect.succeed({
          id: 'evt_webhook',
          type: 'checkout.session.completed',
          created: 1_786_104_000,
          data: {
            object: {
              metadata: { orderId: 'order-webhook' },
              payment_status: 'paid',
              amount_total: 5_000,
              payment_intent: 'pi_webhook',
            },
          },
        });
      },
    };
    const layer = Layer.mergeAll(
      stripeLayer(Option.some(client)),
      Layer.succeed(
        OrderActor.Sender,
        OrderActor.Sender.of({
          createCheckout: () => Effect.die('unused'),
          applyStripeEvent: (command) =>
            Effect.sync(() => {
              sent.push(command);
            }),
          expire: () => Effect.die('unused'),
          refund: () => Effect.die('unused'),
        }),
      ),
    );
    return Effect.gen(function* () {
      expect(yield* processStripeWebhook(request(), 0)).toEqual({
        _tag: 'Processed',
      });
      expect(verified).toEqual([
        {
          payload: '{"exact":"raw body"}',
          signature: 't=123,v1=signature',
        },
      ]);
      expect(sent).toEqual([
        expect.objectContaining({
          stripeEventId: StripeEventId.make('evt_webhook'),
          stripeEventType: 'checkout.session.completed',
          event: expect.objectContaining({ _tag: 'CheckoutCompleted' }),
        }),
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect('rejects a signature failure without enqueueing', () => {
    const client: Client = {
      createCheckout: () => Effect.die('unused'),
      refund: () => Effect.die('unused'),
      constructEvent: () => Effect.fail('invalid signature'),
    };
    const layer = Layer.mergeAll(
      stripeLayer(Option.some(client)),
      Layer.succeed(
        OrderActor.Sender,
        OrderActor.Sender.of({
          createCheckout: () => Effect.die('unused'),
          applyStripeEvent: () => Effect.die('must not enqueue'),
          expire: () => Effect.die('unused'),
          refund: () => Effect.die('unused'),
        }),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* processStripeWebhook(request(), 0).pipe(Effect.flip);
      expect(error).toBeInstanceOf(Rejected);
    }).pipe(Effect.provide(layer));
  });
});
