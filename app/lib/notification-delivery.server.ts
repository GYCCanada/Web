export * as NotificationDelivery from './notification-delivery.server';

import { Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import {
  DeliveryKey as DeliveryKeySchema,
  type DeliveryKey as DeliveryKeyType,
} from './forms/notification-intent';
import { SubmissionGroupId } from './forms/forms.server';

export const DeliveryKey = DeliveryKeySchema;
export type DeliveryKey = DeliveryKeyType;

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  'NotificationDelivery.PersistenceError',
  { operation: Schema.String },
) {}

export type DeliveryResult<A> =
  | { readonly _tag: 'Delivered'; readonly value: A }
  | { readonly _tag: 'AlreadyDelivered' }
  | { readonly _tag: 'InProgress' };

export class Service extends Context.Service<
  Service,
  {
    readonly deliver: <A, E, R>(
      key: DeliveryKeyType,
      send: Effect.Effect<A, E, R>,
    ) => Effect.Effect<DeliveryResult<A>, E | PersistenceError, R>;
    readonly pending: (
      limit?: number,
    ) => Effect.Effect<readonly SubmissionGroupId[], PersistenceError>;
  }
>()('gycc/lib/notification-delivery.server/Service') {}

interface StatusRow {
  readonly status: 'failed' | 'delivering' | 'delivered';
}

interface PendingRow {
  readonly batchId: string;
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const deliver = Effect.fn('NotificationDelivery.deliver')(function* <
      A,
      E,
      R,
    >(key: DeliveryKeyType, send: Effect.Effect<A, E, R>) {
      const claimed = yield* Effect.gen(function* () {
        return yield* sql<StatusRow>`
          UPDATE notification_deliveries
          SET
            status = 'delivering',
            attempts = attempts + 1,
            lease_until = now() + interval '5 minutes',
            last_error = NULL,
            updated_at = now()
          WHERE delivery_key = ${key}
            AND status <> 'delivered'
            AND (status <> 'delivering' OR lease_until <= now())
          RETURNING status
        `;
      }).pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'claim notification delivery' }),
        ),
      );

      if (claimed.length === 0) {
        const rows = yield* sql<StatusRow>`
          SELECT status
          FROM notification_deliveries
          WHERE delivery_key = ${key}
        `.pipe(
          Effect.mapError(
            () => new PersistenceError({ operation: 'read notification delivery' }),
          ),
        );
        const row = Option.fromNullishOr(rows[0]);
        if (Option.isNone(row)) {
          return yield* new PersistenceError({ operation: 'resolve notification delivery' });
        }
        return row.value.status === 'delivered'
          ? ({ _tag: 'AlreadyDelivered' } as const)
          : ({ _tag: 'InProgress' } as const);
      }

      const sent = yield* send.pipe(Effect.result);
      if (sent._tag === 'Failure') {
        yield* sql`
          UPDATE notification_deliveries
          SET
            status = 'failed',
            lease_until = NULL,
            last_error = ${String(sent.failure)},
            updated_at = now()
          WHERE delivery_key = ${key}
        `.pipe(
          Effect.mapError(
            () => new PersistenceError({ operation: 'record notification failure' }),
          ),
        );
        return yield* Effect.fail(sent.failure);
      }

      yield* sql`
        UPDATE notification_deliveries
        SET
          status = 'delivered',
          lease_until = NULL,
          delivered_at = now(),
          updated_at = now()
        WHERE delivery_key = ${key}
      `.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'record notification delivery' }),
        ),
      );
      return { _tag: 'Delivered', value: sent.success } as const;
    });

    const pending = Effect.fn('NotificationDelivery.pending')(function* (
      limit = 50,
    ) {
      const rows = yield* sql<PendingRow>`
        SELECT batch_id AS "batchId"
        FROM notification_deliveries
        WHERE status = 'failed'
           OR (status = 'delivering' AND lease_until <= now())
        ORDER BY updated_at, delivery_key
        LIMIT ${limit}
      `.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'list pending notifications' }),
        ),
      );
      return rows.map((row) => SubmissionGroupId.make(row.batchId));
    });

    return Service.of({ deliver, pending });
  }),
);
