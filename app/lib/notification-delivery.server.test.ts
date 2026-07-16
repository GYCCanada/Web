import { describe, expect, it } from 'effect-bun-test';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';
import { TestClock } from 'effect/testing';

import { DatabaseTest } from './database.test-helper';
import { adminEmailDeliveryKey } from './forms/notification-intent';
import { SubmissionGroupId } from './forms/forms.server';
import { NotificationDelivery } from './notification-delivery.server';

const testLayer = NotificationDelivery.layer.pipe(
  Layer.provideMerge(DatabaseTest.layer),
);

const seedIntent = Effect.fn('test.seedNotificationIntent')(function* () {
  const sql = yield* SqlClient;
  const batchId = SubmissionGroupId.make('delivery-test-batch01');
  const key = adminEmailDeliveryKey(batchId);
  yield* sql`INSERT INTO forms (form_id, current_version_id) VALUES ('contact', NULL)`;
  yield* sql`
    INSERT INTO form_definition_versions (form_id, version_id, definition)
    VALUES ('contact', 'test-version', '{}'::jsonb)
  `;
  yield* sql`
    UPDATE forms SET current_version_id = 'test-version' WHERE form_id = 'contact'
  `;
  yield* sql`
    INSERT INTO submission_batches (
      batch_id,
      form_id,
      definition_version_id,
      idempotency_token,
      command_hash
    ) VALUES (
      ${batchId},
      'contact',
      'test-version',
      'test-token',
      'test-hash'
    )
  `;
  yield* sql`
    INSERT INTO notification_deliveries (
      delivery_key,
      batch_id,
      subject,
      content,
      status
    ) VALUES (${key}, ${batchId}, 'subject', 'content', 'failed')
  `;
  return { sql, key };
});

describe('NotificationDelivery fencing', () => {
  it.effect('admits only one simultaneous claim', () =>
    Effect.gen(function* () {
      const { key } = yield* seedIntent();
      const deliveries = yield* NotificationDelivery.Service;
      const intent = yield* deliveries.intent(key);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let sends = 0;
      const first = yield* deliveries
        .deliver(
          intent,
          Effect.sync(() => {
            sends += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);

      const second = yield* deliveries.deliver(
        intent,
        Effect.sync(() => {
          sends += 1;
        }),
      );
      expect(second._tag).toBe('InProgress');
      expect(sends).toBe(1);

      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(first))._tag).toBe('Delivered');
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('lets an expired claim be taken over and fences the stale owner', () =>
    Effect.gen(function* () {
      const { sql, key } = yield* seedIntent();
      const deliveries = yield* NotificationDelivery.Service;
      const intent = yield* deliveries.intent(key);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const stale = yield* deliveries
        .deliver(
          intent,
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* sql`
        UPDATE notification_deliveries
        SET lease_until = now() - interval '1 second'
        WHERE delivery_key = ${key}
      `;

      expect((yield* deliveries.deliver(intent, Effect.void))._tag).toBe(
        'Delivered',
      );
      yield* Deferred.succeed(release, undefined);
      const staleExit = yield* Fiber.join(stale).pipe(Effect.exit);
      expect(staleExit._tag).toBe('Failure');

      const rows = yield* sql<{ status: string; claimToken: string | null }>`
        SELECT status, claim_token AS "claimToken"
        FROM notification_deliveries
        WHERE delivery_key = ${key}
      `;
      expect(rows).toEqual([{ status: 'delivered', claimToken: null }]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('renews an owned lease while sending', () =>
    Effect.gen(function* () {
      const { sql, key } = yield* seedIntent();
      const deliveries = yield* NotificationDelivery.Service;
      const intent = yield* deliveries.intent(key);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fiber = yield* deliveries
        .deliver(
          intent,
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* sql`
        UPDATE notification_deliveries
        SET lease_until = now() + interval '10 seconds'
        WHERE delivery_key = ${key}
      `;
      yield* TestClock.adjust('1 minute');

      const rows = yield* sql<{ renewed: boolean }>`
        SELECT lease_until > now() + interval '4 minutes' AS renewed
        FROM notification_deliveries
        WHERE delivery_key = ${key}
      `;
      expect(rows[0]?.renewed).toBe(true);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('times out below the lease and records a retryable failure', () =>
    Effect.gen(function* () {
      const { sql, key } = yield* seedIntent();
      const deliveries = yield* NotificationDelivery.Service;
      const intent = yield* deliveries.intent(key);
      const fiber = yield* deliveries
        .deliver(intent, Effect.never)
        .pipe(Effect.forkChild);
      yield* TestClock.adjust('4 minutes');
      const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
      expect(exit._tag).toBe('Failure');

      const rows = yield* sql<{
        status: string;
        claimToken: string | null;
        leased: boolean;
      }>`
        SELECT
          status,
          claim_token AS "claimToken",
          lease_until IS NOT NULL AS leased
        FROM notification_deliveries
        WHERE delivery_key = ${key}
      `;
      expect(rows).toEqual([
        { status: 'failed', claimToken: null, leased: false },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );
});
