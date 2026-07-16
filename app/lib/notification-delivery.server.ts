export * as NotificationDelivery from './notification-delivery.server';

import { Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

export const DeliveryKey = Schema.NonEmptyString.check(
  Schema.isMaxLength(300),
).pipe(Schema.brand('NotificationDeliveryKey'));
export type DeliveryKey = typeof DeliveryKey.Type;

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
      key: DeliveryKey,
      send: Effect.Effect<A, E, R>,
    ) => Effect.Effect<DeliveryResult<A>, E | PersistenceError, R>;
  }
>()('gycc/lib/notification-delivery.server/Service') {}

interface StatusRow {
  readonly status: 'failed' | 'delivering' | 'delivered';
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const deliver = Effect.fn('NotificationDelivery.deliver')(function* <
      A,
      E,
      R,
    >(key: DeliveryKey, send: Effect.Effect<A, E, R>) {
      const claimed = yield* Effect.gen(function* () {
        yield* sql`
          INSERT INTO notification_deliveries (delivery_key, status)
          VALUES (${key}, 'failed')
          ON CONFLICT (delivery_key) DO NOTHING
        `;
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

    return Service.of({ deliver });
  }),
);
