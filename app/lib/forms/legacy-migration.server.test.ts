import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { defaultContactForm } from '../content/pages/defaults';
import { Database } from '../database.server';
import { layerTest } from '../storage.test-helper';

import { migrate } from './legacy-migration.server';

const id = 'abcdefghijklmnopqrstu';
const payload = {
  name: 'Ada Lovelace',
  method: 'email',
  email: 'ada@example.com',
  message: 'Migrate me.',
};
const objects = {
  'forms/contact.json': { body: JSON.stringify(defaultContactForm) },
  [`submissions/contact/${id}.json`]: {
    body: JSON.stringify({
      id,
      form: 'contact',
      submittedAt: '2026-07-15',
      payload,
    }),
  },
  'forms/contact.draft.json': { body: '{}' },
};

const testLayer = Layer.merge(layerTest(objects), Database.layerTest);

describe('legacy Form storage migration', () => {
  it.effect('dry-runs without writing relational records', () =>
    Effect.gen(function* () {
      const report = yield* migrate({ apply: false });
      const sql = yield* SqlClient;
      const rows = yield* sql<{ count: string }>`
        SELECT count(*)::text AS count FROM submission_batches
      `;

      expect(report).toEqual({
        applied: false,
        definitions: 3,
        legacyDefinitionObjects: 1,
        submissions: 1,
        alreadyImportedSubmissions: 0,
        ignoredDraftObjects: 1,
      });
      expect(rows[0]?.count).toBe('0');
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('imports atomically and is safe to rerun', () =>
    Effect.gen(function* () {
      const first = yield* migrate({ apply: true });
      const second = yield* migrate({ apply: true });
      const sql = yield* SqlClient;
      const rows = yield* sql<{
        form: string;
        submittedAt: string;
        payload: string;
      }>`
        SELECT
          batch.form_id AS form,
          batch.submitted_at::text AS "submittedAt",
          submission.payload::text AS payload
        FROM submission_batches AS batch
        JOIN submissions AS submission ON submission.batch_id = batch.batch_id
      `;

      expect(first.alreadyImportedSubmissions).toBe(0);
      expect(second.alreadyImportedSubmissions).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.form).toBe('contact');
      expect(rows[0]?.submittedAt).toContain('2026-07-15');
      expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual(payload);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('rejects a malformed object before any write', () => {
    const layer = Layer.merge(
      layerTest({
        'forms/contact.json': { body: JSON.stringify(defaultContactForm) },
        [`submissions/contact/${id}.json`]: { body: '{"id":' },
      }),
      Database.layerTest,
    );
    return Effect.gen(function* () {
      const error = yield* migrate({ apply: true }).pipe(Effect.flip);
      const sql = yield* SqlClient;
      const rows = yield* sql<{ count: string }>`
        SELECT count(*)::text AS count FROM form_definition_versions
      `;

      expect(error._tag).toBe('LegacyFormsMigration.Rejected');
      expect(rows[0]?.count).toBe('0');
    }).pipe(Effect.provide(layer));
  });
});
