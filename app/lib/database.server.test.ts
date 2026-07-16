import { describe, expect, it } from 'effect-bun-test';
import { Effect, Exit } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Database } from './database.server';
import { DatabaseTest } from './database.test-helper';

describe('Database lifecycle', () => {
  it.effect('runs the application migrations before reporting ready', () =>
    Effect.gen(function* () {
      const database = yield* Database.Service;
      const sql = yield* SqlClient;

      yield* database.ready;

      const defaultChannel = yield* sql<{
        state: string;
        externalUrl: string | null;
      }>`
        SELECT state, external_url AS "externalUrl"
        FROM registration_channels
        WHERE conference_slug = '/2026'
      `;
      expect(defaultChannel).toEqual([
        {
          state: 'external',
          externalUrl: 'https://gyccanada.regfox.com/gyc-canada-2026-speak',
        },
      ]);

      const rows = yield* sql<{ tableName: string }>`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'forms',
            'form_definition_versions',
            'submission_batches',
            'submissions',
            'registration_channels',
            'form_definition_drafts',
            'registrations',
            'registrants',
            'registration_orders',
            'registration_order_registrants',
            'stripe_event_receipts',
            'registration_order_reviews',
            'notification_deliveries'
          )
        ORDER BY table_name
      `;

      expect(rows.map((row) => row.tableName)).toEqual([
        'form_definition_drafts',
        'form_definition_versions',
        'forms',
        'notification_deliveries',
        'registrants',
        'registration_channels',
        'registration_order_registrants',
        'registration_order_reviews',
        'registration_orders',
        'registrations',
        'stripe_event_receipts',
        'submission_batches',
        'submissions',
      ]);
    }).pipe(Effect.provide(DatabaseTest.layer)),
  );

  it.effect('enforces the five registrar channel shapes in PostgreSQL', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* sql`INSERT INTO forms (form_id) VALUES ('registration')`;
      yield* sql`
        INSERT INTO form_definition_versions (form_id, version_id, definition)
        VALUES ('registration', 'v1', '{}'::jsonb)
      `;

      yield* sql`
        INSERT INTO registration_channels (
          conference_slug,
          state,
          external_url
        ) VALUES ('/2025', 'external', 'https://example.com/register')
      `;
      yield* sql`
        INSERT INTO registration_channels (
          conference_slug,
          state,
          form_id,
          form_definition_version_id,
          conference_timezone
        ) VALUES (
          '/2027',
          'preview',
          'registration',
          'v1',
          'America/Toronto'
        )
      `;

      const malformedExternal = yield* Effect.exit(sql`
        INSERT INTO registration_channels (conference_slug, state)
        VALUES ('/2024', 'external')
      `);
      const danglingVersion = yield* Effect.exit(sql`
        INSERT INTO registration_channels (
          conference_slug,
          state,
          form_id,
          form_definition_version_id,
          conference_timezone
        ) VALUES (
          '/2028',
          'open',
          'registration',
          'missing',
          'America/Toronto'
        )
      `);

      expect(Exit.isFailure(malformedExternal)).toBe(true);
      expect(Exit.isFailure(danglingVersion)).toBe(true);
    }).pipe(Effect.provide(DatabaseTest.layer)),
  );

  it.effect('keeps Order quotes non-negative and links only within one Registration', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* sql`INSERT INTO forms (form_id) VALUES ('registration')`;
      yield* sql`
        INSERT INTO form_definition_versions (form_id, version_id, definition)
        VALUES ('registration', 'v1', '{}'::jsonb)
      `;
      yield* sql`
        INSERT INTO registration_channels (
          conference_slug,
          state,
          form_id,
          form_definition_version_id,
          conference_timezone
        ) VALUES (
          '/2027',
          'open',
          'registration',
          'v1',
          'America/Toronto'
        )
      `;

      for (const suffix of ['1', '2']) {
        yield* sql`
          INSERT INTO submission_batches (
            batch_id,
            form_id,
            definition_version_id,
            idempotency_token,
            command_hash
          ) VALUES (
            ${`batch-${suffix}`},
            'registration',
            'v1',
            ${`attempt-${suffix}`},
            ${`hash-${suffix}`}
          )
        `;
        yield* sql`
          INSERT INTO submissions (
            submission_id,
            batch_id,
            ordinal,
            payload
          ) VALUES (
            ${`submission-${suffix}`},
            ${`batch-${suffix}`},
            0,
            '{}'::jsonb
          )
        `;
        yield* sql`
          INSERT INTO registrations (
            registration_id,
            conference_slug,
            form_id,
            form_definition_version_id,
            submission_batch_id,
            idempotency_token,
            command_hash,
            billing_mode,
            currency,
            total_amount,
            priced_at,
            quote_expires_at
          ) VALUES (
            ${`registration-${suffix}`},
            '/2026',
            'registration',
            'v1',
            ${`batch-${suffix}`},
            ${`attempt-${suffix}`},
            ${`hash-${suffix}`},
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
            ${`registrant-${suffix}`},
            ${`registration-${suffix}`},
            ${`submission-${suffix}`},
            0
          )
        `;
      }

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
          'order-1',
          'registration-1',
          0,
          'preparing_checkout',
          0,
          'cad',
          'payer@example.com',
          '{"amount":0,"currency":"cad"}'::jsonb,
          '2026-08-01T12:00:00.000Z',
          '2026-08-02T12:00:00.000Z',
          'checkout-order-1'
        )
      `;
      yield* sql`
        INSERT INTO registration_order_registrants (
          order_id,
          registrant_id,
          registration_id
        ) VALUES ('order-1', 'registrant-1', 'registration-1')
      `;

      const crossRegistration = yield* Effect.exit(sql`
        INSERT INTO registration_order_registrants (
          order_id,
          registrant_id,
          registration_id
        ) VALUES ('order-1', 'registrant-2', 'registration-1')
      `);
      const negativeAmount = yield* Effect.exit(sql`
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
          'order-negative',
          'registration-1',
          1,
          'preparing_checkout',
          -1,
          'cad',
          'payer@example.com',
          '{}'::jsonb,
          '2026-08-01T12:00:00.000Z',
          '2026-08-02T12:00:00.000Z',
          'checkout-order-negative'
        )
      `);

      expect(Exit.isFailure(crossRegistration)).toBe(true);
      expect(Exit.isFailure(negativeAmount)).toBe(true);
      const rows = yield* sql<{ amount: number }>`
        SELECT amount FROM registration_orders WHERE order_id = 'order-1'
      `;
      expect(rows).toEqual([{ amount: 0 }]);
    }).pipe(Effect.provide(DatabaseTest.layer)),
  );
});
