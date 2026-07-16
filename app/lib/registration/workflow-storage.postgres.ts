import { expect, it } from 'effect-bun-test';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Redacted, Schedule, Schema } from 'effect';
import { SingleRunner } from 'effect/unstable/cluster';
import { SqlClient } from 'effect/unstable/sql/SqlClient';
import { Actor } from 'effect-encore';

import { Database } from '../database.server';

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

const testLayer = probeHandlers.pipe(Layer.provideMerge(runnerLayer));
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
