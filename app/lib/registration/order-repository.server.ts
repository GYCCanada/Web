export * as OrderRepository from './order-repository.server';

import { Context, Effect, Layer, Schema } from 'effect';
import { nanoid } from 'nanoid';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Cents } from '../forms/pricing';
import {
  type OrderEvent,
  type OrderState,
  OrderStatus,
  type Transition,
  transitionOrder,
} from './order-transition';

export const OrderId = Schema.NonEmptyString.pipe(Schema.brand('OrderId'));
export type OrderId = typeof OrderId.Type;

export const StripeEventId = Schema.NonEmptyString.pipe(
  Schema.brand('StripeEventId'),
);
export type StripeEventId = typeof StripeEventId.Type;

export type StripeReceipt = {
  readonly id: StripeEventId;
  readonly type: string;
};

export type ApplyCommand = {
  readonly orderId: OrderId;
  readonly event: OrderEvent;
  readonly stripeReceipt?: StripeReceipt;
};

export type ApplyResult =
  | { readonly _tag: 'Applied'; readonly transition: Transition }
  | { readonly _tag: 'DuplicateStripeEvent' };

export class OrderNotFound extends Schema.TaggedErrorClass<OrderNotFound>()(
  'OrderRepository.OrderNotFound',
  { orderId: OrderId },
) {}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  'OrderRepository.PersistenceError',
  { operation: Schema.String },
) {}

export class Service extends Context.Service<
  Service,
  {
    readonly apply: (
      command: ApplyCommand,
    ) => Effect.Effect<ApplyResult, OrderNotFound | PersistenceError>;
  }
>()('gycc/lib/registration/order-repository.server/Service') {}

interface OrderRow {
  readonly status: OrderStatus;
  readonly amount: number;
  readonly stripeCheckoutSessionId: string | null;
  readonly stripeCheckoutUrl: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly confirmedAt: string | null;
  readonly expiredAt: string | null;
  readonly refundStartedAt: string | null;
  readonly refundedAt: string | null;
}

const millis = (value: string | null): number | undefined =>
  value === null ? undefined : Date.parse(value);

const decodeState = (row: OrderRow): OrderState => ({
  status: OrderStatus.make(row.status),
  amount: Cents.make(row.amount),
  ...(row.stripeCheckoutSessionId === null
    ? {}
    : { stripeCheckoutSessionId: row.stripeCheckoutSessionId }),
  ...(row.stripeCheckoutUrl === null
    ? {}
    : { stripeCheckoutUrl: row.stripeCheckoutUrl }),
  ...(row.stripePaymentIntentId === null
    ? {}
    : { stripePaymentIntentId: row.stripePaymentIntentId }),
  ...(millis(row.confirmedAt) === undefined
    ? {}
    : { confirmedAt: millis(row.confirmedAt) }),
  ...(millis(row.expiredAt) === undefined
    ? {}
    : { expiredAt: millis(row.expiredAt) }),
  ...(millis(row.refundStartedAt) === undefined
    ? {}
    : { refundStartedAt: millis(row.refundStartedAt) }),
  ...(millis(row.refundedAt) === undefined
    ? {}
    : { refundedAt: millis(row.refundedAt) }),
});

const timestamp = (value: number | undefined): string | null =>
  value === undefined ? null : new Date(value).toISOString();

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const apply = Effect.fn('OrderRepository.apply')(function* (
      command: ApplyCommand,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<OrderRow>`
            SELECT
              status,
              amount,
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              stripe_checkout_url AS "stripeCheckoutUrl",
              stripe_payment_intent_id AS "stripePaymentIntentId",
              confirmed_at::text AS "confirmedAt",
              expired_at::text AS "expiredAt",
              refund_started_at::text AS "refundStartedAt",
              refunded_at::text AS "refundedAt"
            FROM registration_orders
            WHERE order_id = ${command.orderId}
            FOR UPDATE
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new OrderNotFound({ orderId: command.orderId });
          }

          if (command.stripeReceipt !== undefined) {
            const inserted = yield* sql<{ id: string }>`
              INSERT INTO stripe_event_receipts (
                stripe_event_id,
                order_id,
                event_type,
                outcome
              ) VALUES (
                ${command.stripeReceipt.id},
                ${command.orderId},
                ${command.stripeReceipt.type},
                'received'
              )
              ON CONFLICT (stripe_event_id) DO NOTHING
              RETURNING stripe_event_id AS id
            `;
            if (inserted.length === 0) {
              return { _tag: 'DuplicateStripeEvent' } as const;
            }
          }

          const transition = transitionOrder(decodeState(row), command.event);
          if (transition.changed) {
            const state = transition.state;
            yield* sql`
              UPDATE registration_orders
              SET
                status = ${state.status},
                stripe_checkout_session_id = ${state.stripeCheckoutSessionId ?? null},
                stripe_checkout_url = ${state.stripeCheckoutUrl ?? null},
                stripe_payment_intent_id = ${state.stripePaymentIntentId ?? null},
                confirmed_at = ${timestamp(state.confirmedAt)},
                expired_at = ${timestamp(state.expiredAt)},
                refund_started_at = ${timestamp(state.refundStartedAt)},
                refunded_at = ${timestamp(state.refundedAt)},
                updated_at = now()
              WHERE order_id = ${command.orderId}
            `;
          }

          if (transition.registrants === 'confirm') {
            yield* sql`
              UPDATE registrants AS registrant
              SET status = 'confirmed', confirmed_at = ${timestamp(transition.state.confirmedAt)}
              FROM registration_order_registrants AS link
              WHERE link.order_id = ${command.orderId}
                AND registrant.registrant_id = link.registrant_id
                AND registrant.status = 'pending'
            `;
          } else if (transition.registrants === 'cancel') {
            const cancelledAt =
              command.event._tag === 'RefundRequested'
                ? command.event.at
                : undefined;
            yield* sql`
              UPDATE registrants AS registrant
              SET status = 'cancelled', cancelled_at = ${timestamp(cancelledAt)}
              FROM registration_order_registrants AS link
              WHERE link.order_id = ${command.orderId}
                AND registrant.registrant_id = link.registrant_id
                AND registrant.status <> 'cancelled'
            `;
          }

          if (transition.review !== undefined) {
            yield* sql`
              INSERT INTO registration_order_reviews (
                review_id,
                order_id,
                reason,
                detail
              ) VALUES (
                ${nanoid()},
                ${command.orderId},
                ${transition.review.reason},
                ${transition.review.detail}
              )
              ON CONFLICT (order_id, reason) WHERE status = 'open'
              DO UPDATE SET detail = EXCLUDED.detail
            `;
          }

          if (command.stripeReceipt !== undefined) {
            const outcome =
              transition.changed || transition.review !== undefined
                ? 'processed'
                : 'ignored';
            yield* sql`
              UPDATE stripe_event_receipts
              SET outcome = ${outcome}, processed_at = now()
              WHERE stripe_event_id = ${command.stripeReceipt.id}
            `;
            yield* sql`
              UPDATE registration_orders
              SET
                last_stripe_event_id = ${command.stripeReceipt.id},
                updated_at = now()
              WHERE order_id = ${command.orderId}
            `;
          }

          return { _tag: 'Applied', transition } as const;
        }),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof OrderNotFound
            ? error
            : new PersistenceError({ operation: 'apply Order transition' }),
        ),
      );
    });

    return Service.of({ apply });
  }),
);
