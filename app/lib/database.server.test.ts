import { describe, expect, it } from 'effect-bun-test';
import { Effect } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Database } from './database.server';
import { DatabaseTest } from './database.test-helper';

describe('Database lifecycle', () => {
  it.effect('runs the Form persistence migrations before reporting ready', () =>
    Effect.gen(function* () {
      const database = yield* Database.Service;
      const sql = yield* SqlClient;

      yield* database.ready;

      const rows = yield* sql<{ tableName: string }>`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'forms',
            'form_definition_versions',
            'submission_batches',
            'submissions'
          )
        ORDER BY table_name
      `;

      expect(rows.map((row) => row.tableName)).toEqual([
        'form_definition_versions',
        'forms',
        'submission_batches',
        'submissions',
      ]);
    }).pipe(Effect.provide(DatabaseTest.layer)),
  );
});
