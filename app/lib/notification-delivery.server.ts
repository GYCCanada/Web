export * as NotificationDelivery from './notification-delivery.server';

import { nanoid } from 'nanoid';
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

export class DeliveryTimeout extends Schema.TaggedErrorClass<DeliveryTimeout>()(
  'NotificationDelivery.Timeout',
  { key: DeliveryKeySchema },
) {}

export interface Intent {
  readonly key: DeliveryKeyType;
  readonly batchId: SubmissionGroupId;
  readonly subject: string;
  readonly content: string;
}

export type DeliveryResult<A> =
  | { readonly _tag: 'Delivered'; readonly value: A }
  | { readonly _tag: 'AlreadyDelivered' }
  | { readonly _tag: 'InProgress' };

export class Service extends Context.Service<
  Service,
  {
    readonly intent: (
      key: DeliveryKeyType,
    ) => Effect.Effect<Intent, PersistenceError>;
    readonly deliver: <A, E, R>(
      intent: Intent,
      send: Effect.Effect<A, E, R>,
    ) => Effect.Effect<
      DeliveryResult<A>,
      E | PersistenceError | DeliveryTimeout,
      R
    >;
    readonly pending: (
      limit?: number,
    ) => Effect.Effect<readonly Intent[], PersistenceError>;
  }
>()('gycc/lib/notification-delivery.server/Service') {}

interface StatusRow {
  readonly status: 'failed' | 'delivering' | 'delivered';
}

interface IntentRow {
  readonly key: string;
  readonly batchId: string;
  readonly subject: string;
  readonly content: string;
}

interface ClaimRow {
  readonly claimToken: string;
}

const decodeIntent = (row: IntentRow): Intent => ({
  key: DeliveryKeySchema.make(row.key),
  batchId: SubmissionGroupId.make(row.batchId),
  subject: row.subject,
  content: row.content,
});

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const intent = Effect.fn('NotificationDelivery.intent')(function* (
      key: DeliveryKeyType,
    ) {
      const rows = yield* sql<IntentRow>`
        SELECT
          delivery_key AS key,
          batch_id AS "batchId",
          subject,
          content
        FROM notification_deliveries
        WHERE delivery_key = ${key}
      `.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'read notification intent' }),
        ),
      );
      const row = Option.fromNullishOr(rows[0]);
      if (Option.isNone(row)) {
        return yield* new PersistenceError({
          operation: 'resolve notification intent',
        });
      }
      return decodeIntent(row.value);
    });

    const deliver = Effect.fn('NotificationDelivery.deliver')(function* <
      A,
      E,
      R,
    >(notification: Intent, send: Effect.Effect<A, E, R>) {
      const claimToken = nanoid();
      const claimed = yield* sql<ClaimRow>`
        UPDATE notification_deliveries
        SET
          status = 'delivering',
          attempts = attempts + 1,
          lease_until = now() + interval '5 minutes',
          claim_token = ${claimToken},
          last_error = NULL,
          updated_at = now()
        WHERE delivery_key = ${notification.key}
          AND status <> 'delivered'
          AND (status <> 'delivering' OR lease_until <= now())
        RETURNING claim_token AS "claimToken"
      `.pipe(
        Effect.mapError(
          () =>
            new PersistenceError({ operation: 'claim notification delivery' }),
        ),
      );

      if (claimed.length === 0) {
        const rows = yield* sql<StatusRow>`
          SELECT status
          FROM notification_deliveries
          WHERE delivery_key = ${notification.key}
        `.pipe(
          Effect.mapError(
            () =>
              new PersistenceError({ operation: 'read notification delivery' }),
          ),
        );
        const row = Option.fromNullishOr(rows[0]);
        if (Option.isNone(row)) {
          return yield* new PersistenceError({
            operation: 'resolve notification delivery',
          });
        }
        return row.value.status === 'delivered'
          ? ({ _tag: 'AlreadyDelivered' } as const)
          : ({ _tag: 'InProgress' } as const);
      }

      const renew = sql<ClaimRow>`
        UPDATE notification_deliveries
        SET lease_until = now() + interval '5 minutes', updated_at = now()
        WHERE delivery_key = ${notification.key}
          AND status = 'delivering'
          AND claim_token = ${claimToken}
        RETURNING claim_token AS "claimToken"
      `.pipe(
        Effect.mapError(
          () => new PersistenceError({ operation: 'renew notification lease' }),
        ),
        Effect.flatMap((rows) =>
          rows.length > 0
            ? Effect.void
            : Effect.fail(
                new PersistenceError({
                  operation: 'renew owned notification lease',
                }),
              ),
        ),
      );
      const boundedSend = Effect.raceFirst(
        send,
        Effect.sleep('4 minutes').pipe(
          Effect.andThen(
            Effect.fail(new DeliveryTimeout({ key: notification.key })),
          ),
        ),
      );
      const sent = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.sleep('1 minute').pipe(
            Effect.andThen(renew),
            Effect.forever,
            Effect.forkScoped,
          );
          return yield* boundedSend.pipe(Effect.result);
        }),
      );

      if (sent._tag === 'Failure') {
        const updated = yield* sql<ClaimRow>`
          UPDATE notification_deliveries
          SET
            status = 'failed',
            lease_until = NULL,
            claim_token = NULL,
            last_error = ${String(sent.failure)},
            updated_at = now()
          WHERE delivery_key = ${notification.key}
            AND status = 'delivering'
            AND claim_token = ${claimToken}
          RETURNING ${claimToken} AS "claimToken"
        `.pipe(
          Effect.mapError(
            () =>
              new PersistenceError({
                operation: 'record notification failure',
              }),
          ),
        );
        if (updated.length === 0) {
          return yield* new PersistenceError({
            operation: 'record owned notification failure',
          });
        }
        return yield* Effect.fail(sent.failure);
      }

      const updated = yield* sql<ClaimRow>`
        UPDATE notification_deliveries
        SET
          status = 'delivered',
          lease_until = NULL,
          claim_token = NULL,
          delivered_at = now(),
          updated_at = now()
        WHERE delivery_key = ${notification.key}
          AND status = 'delivering'
          AND claim_token = ${claimToken}
        RETURNING ${claimToken} AS "claimToken"
      `.pipe(
        Effect.mapError(
          () =>
            new PersistenceError({ operation: 'record notification delivery' }),
        ),
      );
      if (updated.length === 0) {
        return yield* new PersistenceError({
          operation: 'record owned notification delivery',
        });
      }
      return { _tag: 'Delivered', value: sent.success } as const;
    });

    const pending = Effect.fn('NotificationDelivery.pending')(function* (
      limit = 50,
    ) {
      const rows = yield* sql<IntentRow>`
        SELECT
          delivery_key AS key,
          batch_id AS "batchId",
          subject,
          content
        FROM notification_deliveries
        WHERE status = 'failed'
           OR (status = 'delivering' AND lease_until <= now())
        ORDER BY updated_at, delivery_key
        LIMIT ${limit}
      `.pipe(
        Effect.mapError(
          () =>
            new PersistenceError({ operation: 'list pending notifications' }),
        ),
      );
      return rows.map(decodeIntent);
    });

    return Service.of({ intent, deliver, pending });
  }),
);
