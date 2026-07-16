export * as RegistrationOrders from './order-service.server';

import { nanoid } from 'nanoid';
import { Context, Effect, Layer, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { OrderActor } from './order-actor.server';
import { OrderId } from './order-repository.server';
import type { OrderStatus } from './order-transition';

export type PublicStatus = {
  readonly orderId: OrderId;
  readonly status: OrderStatus;
  readonly amount: number;
  readonly currency: 'cad';
  readonly registrantCount: number;
  readonly checkoutUrl?: string;
};

export type OpenReview = {
  readonly id: string;
  readonly orderId: OrderId;
  readonly reason: 'late_payment' | 'refund_failed' | 'amount_mismatch';
  readonly detail: string;
  readonly createdAt: string;
};

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  'RegistrationOrders.NotFound',
  {},
) {}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  'RegistrationOrders.PersistenceError',
  { operation: Schema.String },
) {}

interface StatusRow {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly amount: number;
  readonly currency: 'cad';
  readonly registrantCount: number;
  readonly checkoutUrl: string | null;
}

interface ReviewRow {
  readonly id: string;
  readonly orderId: string;
  readonly reason: OpenReview['reason'];
  readonly detail: string;
  readonly createdAt: string;
}

const decodeStatus = (row: StatusRow): PublicStatus => ({
  orderId: OrderId.make(row.orderId),
  status: row.status,
  amount: row.amount,
  currency: row.currency,
  registrantCount: row.registrantCount,
  ...(row.checkoutUrl === null ? {} : { checkoutUrl: row.checkoutUrl }),
});

export class Service extends Context.Service<
  Service,
  {
    readonly byOrder: (
      orderId: OrderId,
    ) => Effect.Effect<PublicStatus, NotFound | PersistenceError>;
    readonly byCheckoutSession: (
      sessionId: string,
    ) => Effect.Effect<PublicStatus, NotFound | PersistenceError>;
    readonly byRegistration: (
      registrationId: string,
    ) => Effect.Effect<ReadonlyArray<PublicStatus>, NotFound | PersistenceError>;
    readonly requestRefund: (
      orderId: OrderId,
      at: number,
    ) => Effect.Effect<string, PersistenceError>;
    readonly expireDue: (
      at: number,
      limit?: number,
    ) => Effect.Effect<number, PersistenceError>;
    readonly openReviews: Effect.Effect<
      ReadonlyArray<OpenReview>,
      PersistenceError
    >;
  }
>()('gycc/lib/registration/order-service.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const sender = yield* OrderActor.Sender;

    const one = Effect.fn('RegistrationOrders.one')(function* (
      query: Effect.Effect<ReadonlyArray<StatusRow>, unknown>,
    ) {
      const rows = yield* query.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'read public Order status' }),
        ),
      );
      const row = rows[0];
      if (row === undefined) return yield* new NotFound();
      return decodeStatus(row);
    });

    const byOrder = Effect.fn('RegistrationOrders.byOrder')((orderId: OrderId) =>
      one(sql<StatusRow>`
        SELECT
          registration_order.order_id AS "orderId",
          registration_order.status,
          registration_order.amount,
          registration_order.currency,
          count(link.registrant_id)::int AS "registrantCount",
          registration_order.stripe_checkout_url AS "checkoutUrl"
        FROM registration_orders AS registration_order
        LEFT JOIN registration_order_registrants AS link
          ON link.order_id = registration_order.order_id
        WHERE registration_order.order_id = ${orderId}
        GROUP BY registration_order.order_id
      `),
    );
    const byCheckoutSession = Effect.fn('RegistrationOrders.byCheckoutSession')(
      (sessionId: string) =>
        one(sql<StatusRow>`
          SELECT
            registration_order.order_id AS "orderId",
            registration_order.status,
            registration_order.amount,
            registration_order.currency,
            count(link.registrant_id)::int AS "registrantCount",
            registration_order.stripe_checkout_url AS "checkoutUrl"
          FROM registration_orders AS registration_order
          LEFT JOIN registration_order_registrants AS link
            ON link.order_id = registration_order.order_id
          WHERE registration_order.stripe_checkout_session_id = ${sessionId}
          GROUP BY registration_order.order_id
        `),
    );
    const byRegistration = Effect.fn('RegistrationOrders.byRegistration')(
      function* (registrationId: string) {
        const rows = yield* sql<StatusRow>`
          SELECT
            registration_order.order_id AS "orderId",
            registration_order.status,
            registration_order.amount,
            registration_order.currency,
            count(link.registrant_id)::int AS "registrantCount",
            registration_order.stripe_checkout_url AS "checkoutUrl"
          FROM registration_orders AS registration_order
          LEFT JOIN registration_order_registrants AS link
            ON link.order_id = registration_order.order_id
          WHERE registration_order.registration_id = ${registrationId}
          GROUP BY registration_order.order_id
          ORDER BY registration_order.ordinal
        `.pipe(
          Effect.mapError(
            () => new PersistenceError({ operation: 'read Registration status' }),
          ),
        );
        if (rows.length === 0) return yield* new NotFound();
        return rows.map(decodeStatus);
      },
    );
    const requestRefund = Effect.fn('RegistrationOrders.requestRefund')(
      function* (orderId: OrderId, at: number) {
        const attemptId = nanoid();
        yield* sender.refund(orderId, attemptId, at).pipe(
          Effect.mapError(
            () => new PersistenceError({ operation: 'enqueue full refund' }),
          ),
        );
        return attemptId;
      },
    );
    const expireDue = Effect.fn('RegistrationOrders.expireDue')(function* (
      at: number,
      limit = 100,
    ) {
      const rows = yield* sql<{ orderId: string }>`
        SELECT order_id AS "orderId"
        FROM registration_orders
        WHERE status IN ('preparing_checkout', 'awaiting_payment', 'awaiting_async')
          AND quote_expires_at <= ${new Date(at).toISOString()}
        ORDER BY quote_expires_at, order_id
        LIMIT ${Math.max(1, Math.min(limit, 500))}
      `.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'read expired Orders' }),
        ),
      );
      yield* Effect.forEach(rows, (row) =>
        sender.expire(OrderId.make(row.orderId), at).pipe(
          Effect.mapError(
            () => new PersistenceError({ operation: 'enqueue Order expiry' }),
          ),
        ),
      );
      return rows.length;
    });
    const openReviews = sql<ReviewRow>`
      SELECT
        review_id AS id,
        order_id AS "orderId",
        reason,
        detail,
        created_at::text AS "createdAt"
      FROM registration_order_reviews
      WHERE status = 'open'
      ORDER BY created_at, review_id
    `.pipe(
      Effect.map(
        (rows): ReadonlyArray<OpenReview> =>
          rows.map((row) => ({
            ...row,
            orderId: OrderId.make(row.orderId),
          })),
      ),
      Effect.mapError(
        () => new PersistenceError({ operation: 'read open Order reviews' }),
      ),
    );

    return Service.of({
      byOrder,
      byCheckoutSession,
      byRegistration,
      requestRefund,
      expireDue,
      openReviews,
    });
  }),
);
