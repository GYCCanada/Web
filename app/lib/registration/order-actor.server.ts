export * as OrderActor from './order-actor.server';

import { Clock, Context, Effect, Layer, Result, Schema } from 'effect';
import { Actor } from 'effect-encore';

import {
  OrderId,
  OrderRepository,
  StripeEventId,
} from './order-repository.server';
import { OrderEvent } from './order-transition';
import { StripeGateway } from './stripe-gateway.server';

export const Order = Actor.fromEntity('RegistrationOrder', {
  CreateCheckout: {
    payload: { orderId: OrderId },
    success: Schema.Void,
    persisted: true,
    id: (payload: { readonly orderId: string }) => payload.orderId,
  },
  ApplyStripeEvent: {
    payload: {
      orderId: OrderId,
      stripeEventId: StripeEventId,
      stripeEventType: Schema.NonEmptyString,
      event: OrderEvent,
    },
    success: Schema.Void,
    persisted: true,
    id: (payload: {
      readonly orderId: string;
      readonly stripeEventId: string;
    }) => ({
      entityId: payload.orderId,
      primaryKey: payload.stripeEventId,
    }),
  },
  Expire: {
    payload: { orderId: OrderId, at: Schema.Number },
    success: Schema.Void,
    persisted: true,
    id: (payload: { readonly orderId: string }) => ({
      entityId: payload.orderId,
      primaryKey: 'local-expiry',
    }),
  },
  Refund: {
    payload: {
      orderId: OrderId,
      attemptId: Schema.NonEmptyString,
      at: Schema.Number,
    },
    success: Schema.Void,
    persisted: true,
    id: (payload: {
      readonly orderId: string;
      readonly attemptId: string;
    }) => ({
      entityId: payload.orderId,
      primaryKey: `refund:${payload.attemptId}`,
    }),
  },
});

export class Processor extends Context.Service<
  Processor,
  {
    readonly createCheckout: (orderId: OrderId) => Effect.Effect<void>;
    readonly applyStripeEvent: (command: {
      readonly orderId: OrderId;
      readonly stripeEventId: StripeEventId;
      readonly stripeEventType: string;
      readonly event: typeof OrderEvent.Type;
    }) => Effect.Effect<void>;
    readonly expire: (orderId: OrderId, at: number) => Effect.Effect<void>;
    readonly refund: (
      orderId: OrderId,
      at: number,
    ) => Effect.Effect<void>;
  }
>()('gycc/lib/registration/order-actor.server/Processor') {}

export const processorLayer = Layer.effect(
  Processor,
  Effect.gen(function* () {
    const repository = yield* OrderRepository.Service;
    const stripe = yield* StripeGateway.Service;

    const createCheckout = Effect.fn('OrderProcessor.createCheckout')(
      function* (orderId: OrderId) {
        const checkout = yield* repository.checkout(orderId).pipe(
          Effect.orDie,
        );
        const now = yield* Clock.currentTimeMillis;
        const result = yield* stripe
          .createCheckout({
            ...checkout,
            now,
          })
          .pipe(Effect.result);
        yield* repository
          .apply(
            Result.isSuccess(result)
              ? {
                  orderId,
                  event: {
                    _tag: 'CheckoutCreated',
                    sessionId: result.success.sessionId,
                    checkoutUrl: result.success.url,
                  },
                }
              : {
                  orderId,
                  event: { _tag: 'CheckoutCreationFailed' },
                },
          )
          .pipe(Effect.asVoid, Effect.orDie);
      },
    );
    const applyStripeEvent = Effect.fn('OrderProcessor.applyStripeEvent')(
      (command: {
        readonly orderId: OrderId;
        readonly stripeEventId: StripeEventId;
        readonly stripeEventType: string;
        readonly event: typeof OrderEvent.Type;
      }) =>
        repository
          .apply({
            orderId: command.orderId,
            event: command.event,
            stripeReceipt: {
              id: command.stripeEventId,
              type: command.stripeEventType,
            },
          })
          .pipe(Effect.asVoid, Effect.orDie),
    );
    const expire = Effect.fn('OrderProcessor.expire')(
      (orderId: OrderId, at: number) =>
        repository
          .apply({
            orderId,
            event: { _tag: 'LocalExpired', at },
          })
          .pipe(Effect.asVoid, Effect.orDie),
    );
    const refund = Effect.fn('OrderProcessor.refund')(
      function* (orderId: OrderId, at: number) {
        const requested = yield* repository
          .apply({
            orderId,
            event: { _tag: 'RefundRequested', at },
          })
          .pipe(Effect.orDie);
        if (
          requested._tag !== 'Applied' ||
          !requested.transition.changed ||
          requested.transition.state.status !== 'refund_pending'
        ) {
          return;
        }

        const paymentIntentId =
          requested.transition.state.stripePaymentIntentId;
        const refunded =
          paymentIntentId === undefined
            ? Result.fail(new Error('Order has no Stripe PaymentIntent'))
            : yield* stripe
                .refund({
                  orderId,
                  paymentIntentId,
                  idempotencyKey: `registration:refund:${orderId}`,
                })
                .pipe(Effect.result);
        const completedAt = yield* Clock.currentTimeMillis;
        if (Result.isFailure(refunded)) {
          yield* repository
            .apply({
              orderId,
              event: {
                _tag: 'RefundFailed',
                at: completedAt,
                detail: 'Stripe did not accept the full refund',
              },
            })
            .pipe(Effect.asVoid, Effect.orDie);
          return;
        }

        if (refunded.success.status === 'succeeded') {
          yield* repository
            .apply({
              orderId,
              event: { _tag: 'RefundSucceeded', at: completedAt },
            })
            .pipe(Effect.asVoid, Effect.orDie);
        } else if (
          refunded.success.status === 'failed' ||
          refunded.success.status === 'canceled' ||
          refunded.success.status === 'cancelled'
        ) {
          yield* repository
            .apply({
              orderId,
              event: {
                _tag: 'RefundFailed',
                at: completedAt,
                detail: `Stripe refund entered ${refunded.success.status} status`,
              },
            })
            .pipe(Effect.asVoid, Effect.orDie);
        }
      },
    );

    return Processor.of({
      createCheckout,
      applyStripeEvent,
      expire,
      refund,
    });
  }),
);

const builder = Effect.gen(function* () {
  const processor = yield* Processor;
  return Order.of({
    CreateCheckout: ({ operation }) =>
      processor.createCheckout(operation.orderId),
    ApplyStripeEvent: ({ operation }) =>
      processor.applyStripeEvent(operation),
    Expire: ({ operation }) => processor.expire(operation.orderId, operation.at),
    Refund: ({ operation }) => processor.refund(operation.orderId, operation.at),
  });
});

export const handlers = Actor.toLayer(Order, builder);
export const testHandlers = Actor.toTestLayer(Order, builder);
