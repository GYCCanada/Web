import { expect, it } from 'effect-bun-test';
import { PgClient } from '@effect/sql-pg';
import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Redacted,
  Schedule,
  Schema,
} from 'effect';
import { SingleRunner } from 'effect/unstable/cluster';
import { SqlClient } from 'effect/unstable/sql/SqlClient';
import { Actor } from 'effect-encore';

import { Database } from '../database.server';
import { ConferenceSlug } from '../content/schema';
import { ActiveOrders, Registrar } from './registrar.server';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('TEST_DATABASE_URL is required for the PostgreSQL integration gate');
}

const ProbeActor = Actor.fromEntity('RegistrationWorkflowProbe', {
  Process: {
    payload: { key: Schema.String },
    success: Schema.Void,
    persisted: true,
    id: (payload: { readonly key: string }) => payload.key,
  },
});

const probeHandlers = Actor.toLayer(
  ProbeActor,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return {
      Process: ({ operation }: { operation: { readonly key: string } }) =>
        sql`
          INSERT INTO registration_workflow_probe (probe_key)
          VALUES (${operation.key})
          ON CONFLICT (probe_key) DO NOTHING
        `.pipe(Effect.asVoid, Effect.orDie),
    };
  }),
);

const databaseLayer = Database.makeLayer(
  PgClient.layer({
    url: Redacted.make(databaseUrl),
    applicationName: 'gycc-registration-workflow-test',
  }),
);

const runnerLayer = SingleRunner.layer({
  runnerStorage: 'sql',
  shardingConfig: {
    entityMessagePollInterval: '25 millis',
    entityReplyPollInterval: '25 millis',
    refreshAssignmentsInterval: '25 millis',
  },
}).pipe(Layer.provideMerge(databaseLayer));

const testLayer = Layer.merge(probeHandlers, Registrar.layer).pipe(
  Layer.provideMerge(runnerLayer),
);
const test = it.scopedLive.layer(testLayer);

test(
  'SQL-backed persisted send commits and rolls back with its caller transaction',
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* sql`
        CREATE TABLE IF NOT EXISTS registration_workflow_probe (
          probe_key text PRIMARY KEY,
          processed_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      yield* sql`TRUNCATE registration_workflow_probe`;
      yield* sql`TRUNCATE cluster_replies, cluster_messages CASCADE`;

      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* ProbeActor.Process.send({ key: 'rolled-back' });
            return yield* Effect.fail('force rollback');
          }),
        )
        .pipe(Effect.catch(() => Effect.void));

      const afterRollback = yield* sql<{ count: number }>`
        SELECT count(*)::integer AS count
        FROM cluster_messages
        WHERE entity_type = 'RegistrationWorkflowProbe'
      `;
      expect(afterRollback).toEqual([{ count: 0 }]);

      yield* sql.withTransaction(
        ProbeActor.Process.send({ key: 'committed' }),
      );

      const afterCommit = yield* sql<{ count: number }>`
        SELECT count(*)::integer AS count
        FROM cluster_messages
        WHERE entity_type = 'RegistrationWorkflowProbe'
      `;
      expect(afterCommit).toEqual([{ count: 1 }]);

      const processed = yield* sql<{ count: number }>`
        SELECT count(*)::integer AS count
        FROM registration_workflow_probe
        WHERE probe_key = 'committed'
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0]?.count === 1 ? Effect.succeed(rows) : Effect.fail('pending'),
        ),
        Effect.retry({
          times: 200,
          schedule: Schedule.spaced('25 millis'),
        }),
      );
      expect(processed).toEqual([{ count: 1 }]);

      const libraryTables = yield* sql<{ tableName: string }>`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'cluster_messages',
            'cluster_replies',
            'cluster_migrations',
            'cluster_runners',
            'cluster_runner_migrations'
          )
        ORDER BY table_name
      `;
      expect(libraryTables.map((row) => row.tableName)).toContain(
        'cluster_messages',
      );
      expect(libraryTables.map((row) => row.tableName)).toContain(
        'cluster_replies',
      );
      expect(libraryTables.map((row) => row.tableName)).toContain(
        'cluster_migrations',
      );
    }),
  20_000,
);

test(
  'drain completion waits for in-flight intake and observes its committed Order',
  () =>
    Effect.gen(function* () {
      const registrar = yield* Registrar.Service;
      const sql = yield* SqlClient;
      const conference = ConferenceSlug.make('/2026');
      const version = `sha256:${'0'.repeat(64)}`;

      yield* sql`DELETE FROM registration_order_reviews`;
      yield* sql`DELETE FROM stripe_event_receipts`;
      yield* sql`DELETE FROM registration_order_registrants`;
      yield* sql`DELETE FROM registration_orders`;
      yield* sql`DELETE FROM registrants`;
      yield* sql`DELETE FROM registrations`;
      yield* sql`DELETE FROM submissions`;
      yield* sql`DELETE FROM submission_batches`;
      yield* sql`DELETE FROM registration_channels`;
      yield* sql`DELETE FROM form_definition_drafts`;
      yield* sql`DELETE FROM form_definition_versions`;
      yield* sql`DELETE FROM forms`;

      yield* sql`INSERT INTO forms (form_id) VALUES ('registration')`;
      yield* sql`
        INSERT INTO form_definition_versions (form_id, version_id, definition)
        VALUES ('registration', ${version}, '{}'::jsonb)
      `;
      yield* sql`
        INSERT INTO registration_channels (
          conference_slug,
          state,
          form_id,
          form_definition_version_id,
          conference_timezone
        ) VALUES (
          ${conference},
          'draining',
          'registration',
          ${version},
          'America/Toronto'
        )
      `;
      yield* sql`
        INSERT INTO submission_batches (
          batch_id,
          form_id,
          definition_version_id,
          idempotency_token,
          command_hash
        ) VALUES (
          'batch-concurrency',
          'registration',
          ${version},
          'attempt-concurrency',
          'submission-hash'
        )
      `;
      yield* sql`
        INSERT INTO submissions (submission_id, batch_id, ordinal, payload)
        VALUES (
          'submission-concurrency',
          'batch-concurrency',
          0,
          '{}'::jsonb
        )
      `;

      const locked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const intake = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
              SELECT conference_slug
              FROM registration_channels
              WHERE conference_slug = ${conference}
              FOR UPDATE
            `;
            yield* Deferred.succeed(locked, undefined);
            yield* Deferred.await(release);
            yield* sql`
              INSERT INTO registrations (
                registration_id,
                conference_slug,
                form_id,
                form_definition_version_id,
                submission_batch_id,
                idempotency_token,
                command_hash,
                public_token_hash,
                billing_mode,
                currency,
                total_amount,
                priced_at,
                quote_expires_at
              ) VALUES (
                'registration-concurrency',
                ${conference},
                'registration',
                ${version},
                'batch-concurrency',
                'commerce-attempt',
                'commerce-hash',
                'public-hash',
                'perRegistrant',
                'cad',
                0,
                '2026-08-01T12:00:00.000Z',
                '2026-08-02T12:00:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO registrants (
                registrant_id,
                registration_id,
                submission_id,
                ordinal
              ) VALUES (
                'registrant-concurrency',
                'registration-concurrency',
                'submission-concurrency',
                0
              )
            `;
            yield* sql`
              INSERT INTO registration_orders (
                order_id,
                registration_id,
                ordinal,
                status,
                amount,
                currency,
                receipt_email,
                quote_snapshot,
                priced_at,
                quote_expires_at,
                stripe_idempotency_key
              ) VALUES (
                'order-concurrency',
                'registration-concurrency',
                0,
                'preparing_checkout',
                0,
                'cad',
                'payer@example.com',
                '{}'::jsonb,
                '2026-08-01T12:00:00.000Z',
                '2026-08-02T12:00:00.000Z',
                'checkout-order-concurrency'
              )
            `;
          }),
        )
        .pipe(Effect.forkChild);

      yield* Deferred.await(locked);
      const close = yield* registrar
        .close({ conference, expectedRevision: 0 })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.sleep('50 millis');
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(intake);

      const blocked = yield* Fiber.join(close);
      expect(blocked).toBeInstanceOf(ActiveOrders);
      if (blocked instanceof ActiveOrders) expect(blocked.count).toBe(1);
      expect((yield* registrar.get(conference)).state).toBe('draining');
    }),
  20_000,
);
