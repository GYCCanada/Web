export * as OrderActor from './order-actor.server';

import { Clock, Context, Effect, Layer, Schema } from 'effect';
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

export class EnqueueError extends Schema.TaggedErrorClass<EnqueueError>()(
  'OrderActor.EnqueueError',
  { operation: Schema.String },
) {}

export class Sender extends Context.Service<
  Sender,
  {
    readonly createCheckout: (
      orderId: OrderId,
    ) => Effect.Effect<void, EnqueueError>;
    readonly applyStripeEvent: (command: {
      readonly orderId: OrderId;
      readonly stripeEventId: StripeEventId;
      readonly stripeEventType: string;
      readonly event: typeof OrderEvent.Type;
    }) => Effect.Effect<void, EnqueueError>;
    readonly expire: (
      orderId: OrderId,
      at: number,
    ) => Effect.Effect<void, EnqueueError>;
    readonly refund: (
      orderId: OrderId,
      attemptId: string,
      at: number,
    ) => Effect.Effect<void, EnqueueError>;
  }
>()('gycc/lib/registration/order-actor.server/Sender') {}

export const senderLayer = Layer.effect(
  Sender,
  Effect.gen(function* () {
    const checkoutContext = yield* Effect.context<
      Effect.Services<ReturnType<typeof Order.CreateCheckout.send>>
    >();
    const stripeContext = yield* Effect.context<
      Effect.Services<ReturnType<typeof Order.ApplyStripeEvent.send>>
    >();
    const expiryContext = yield* Effect.context<
      Effect.Services<ReturnType<typeof Order.Expire.send>>
    >();
    const refundContext = yield* Effect.context<
      Effect.Services<ReturnType<typeof Order.Refund.send>>
    >();
    return Sender.of({
      createCheckout: (orderId) =>
        Order.CreateCheckout.send({ orderId }).pipe(
          Effect.provide(checkoutContext),
          Effect.asVoid,
          Effect.mapError(
            () => new EnqueueError({ operation: 'enqueue Checkout creation' }),
          ),
        ),
      applyStripeEvent: (command) =>
        Order.ApplyStripeEvent.send(command).pipe(
          Effect.provide(stripeContext),
          Effect.asVoid,
          Effect.mapError(
            () => new EnqueueError({ operation: 'enqueue Stripe settlement' }),
          ),
        ),
      expire: (orderId, at) =>
        Order.Expire.send({ orderId, at }).pipe(
          Effect.provide(expiryContext),
          Effect.asVoid,
          Effect.mapError(
            () => new EnqueueError({ operation: 'enqueue Order expiry' }),
          ),
        ),
      refund: (orderId, attemptId, at) =>
        Order.Refund.send({ orderId, attemptId, at }).pipe(
          Effect.provide(refundContext),
          Effect.asVoid,
          Effect.mapError(
            () => new EnqueueError({ operation: 'enqueue Order refund' }),
          ),
        ),
    });
  }),
);

export const processorLayer = Layer.effect(
  Processor,
  Effect.gen(function* () {
    const repository = yield* OrderRepository.Service;
    const stripe = yield* StripeGateway.Service;

    const createCheckout = Effect.fn('OrderProcessor.createCheckout')(
      function* (orderId: OrderId) {
        const checkout = yield* repository.checkout(orderId).pipe(Effect.result);
        if (checkout._tag === 'Failure') {
          if (checkout.failure instanceof OrderRepository.OrderNotFound) return;
          return yield* Effect.die(checkout.failure);
        }
        const now = yield* Clock.currentTimeMillis;
        const created = yield* stripe
          .createCheckout({
            ...checkout.success,
            now,
          })
          .pipe(Effect.orDie);
        yield* repository
          .apply(
            {
              orderId,
              event: {
                _tag: 'CheckoutCreated',
                sessionId: created.sessionId,
                checkoutUrl: created.url,
              },
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
          requested.transition.state.status !== 'refund_pending'
        ) {
          return;
        }

        const paymentIntentId =
          requested.transition.state.stripePaymentIntentId;
        const completedAt = yield* Clock.currentTimeMillis;
        if (paymentIntentId === undefined) {
          yield* repository
            .apply({
              orderId,
              event: {
                _tag: 'RefundFailed',
                at: completedAt,
                detail: 'Order has no Stripe PaymentIntent',
              },
            })
            .pipe(Effect.asVoid, Effect.orDie);
          return;
        }
        const refunded = yield* stripe
          .refund({
            orderId,
            paymentIntentId,
            idempotencyKey: `registration:refund:${orderId}`,
          })
          .pipe(Effect.orDie);

        if (refunded.status === 'succeeded') {
          yield* repository
            .apply({
              orderId,
              event: { _tag: 'RefundSucceeded', at: completedAt },
            })
            .pipe(Effect.asVoid, Effect.orDie);
        } else if (
          refunded.status === 'failed' ||
          refunded.status === 'canceled' ||
          refunded.status === 'cancelled'
        ) {
          yield* repository
            .apply({
              orderId,
              event: {
                _tag: 'RefundFailed',
                at: completedAt,
                detail: `Stripe refund entered ${refunded.status} status`,
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
