import { Effect, Schema } from 'effect';

import { OrderActor } from './order-actor.server';
import { routeStripeEvent } from './stripe-event';
import { StripeGateway } from './stripe-gateway.server';

export type WebhookResult =
  | { readonly _tag: 'Processed' }
  | { readonly _tag: 'Ignored'; readonly type: string };

export class Rejected extends Schema.TaggedErrorClass<Rejected>()(
  'StripeWebhook.Rejected',
  {},
) {}

export class Unavailable extends Schema.TaggedErrorClass<Unavailable>()(
  'StripeWebhook.Unavailable',
  {},
) {}

export class EnqueueFailed extends Schema.TaggedErrorClass<EnqueueFailed>()(
  'StripeWebhook.EnqueueFailed',
  {},
) {}

/** Verify the raw request, normalize its event, and durably enqueue settlement. */
export const processStripeWebhook = Effect.fn('StripeWebhook.process')(
  function* (request: Request, receivedAt: number) {
    const stripe = yield* StripeGateway.Service;
    const sender = yield* OrderActor.Sender;
    const payload = yield* Effect.promise(() => request.arrayBuffer());
    const envelope = yield* stripe
      .constructEvent(payload, request.headers.get('stripe-signature'))
      .pipe(
        Effect.mapError((error) =>
          error instanceof StripeGateway.Unavailable
            ? new Unavailable()
            : new Rejected(),
        ),
      );
    const routed = yield* Effect.try({
      try: () => routeStripeEvent(envelope, receivedAt),
      catch: () => new Rejected(),
    });
    if (routed._tag === 'Ignored') {
      return { _tag: 'Ignored', type: routed.type } as const;
    }
    yield* sender
      .applyStripeEvent({
        orderId: routed.value.orderId,
        stripeEventId: routed.value.receipt.id,
        stripeEventType: routed.value.receipt.type,
        event: routed.value.event,
      })
      .pipe(Effect.mapError(() => new EnqueueFailed()));
    return { _tag: 'Processed' } as const;
  },
);
