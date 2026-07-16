import { describe, expect, it } from 'effect-bun-test';
import { ConfigProvider, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { DatabaseTest } from '../database.test-helper';
import { Env } from '../env.server';
import { Mailer } from '../mailer.server';
import { NotificationDelivery } from '../notification-delivery.server';
import { RegistrationAlerts } from './registration-alerts.server';

const configuredEnv = Env.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        NODE_ENV: 'development',
        MAIL_HOST: 'smtp.example.com',
        MAIL_PORT: 587,
        MAIL_USER: 'user',
        MAIL_PASS: 'secret',
        MAIL_FROM: 'from@example.com',
        MAIL_TO: 'forms@example.com',
        REGISTRATION_ALERT_EMAIL: 'registration-ops@example.com',
      }),
    ),
  ),
);

const seedOrderAndReview = Effect.fn('test.seedOrderAndReview')(function* () {
  const sql = yield* SqlClient;
  yield* sql`INSERT INTO forms (form_id) VALUES ('registration')`;
  yield* sql`
    INSERT INTO form_definition_versions (form_id, version_id, definition)
    VALUES ('registration', 'v1', '{}'::jsonb)
  `;
  yield* sql`DELETE FROM registration_channels WHERE conference_slug = '/2026'`;
  yield* sql`
    INSERT INTO registration_channels (
      conference_slug,
      state,
      form_id,
      form_definition_version_id,
      conference_timezone
    ) VALUES ('/2026', 'open', 'registration', 'v1', 'America/Toronto')
  `;
  yield* sql`
    INSERT INTO submission_batches (
      batch_id,
      form_id,
      definition_version_id,
      idempotency_token,
      command_hash
    ) VALUES ('batch-alert', 'registration', 'v1', 'attempt-alert', 'hash-alert')
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
      'registration-alert', '/2026', 'registration', 'v1', 'batch-alert',
      'registration-attempt-alert', 'registration-hash-alert', 'group', 'cad',
      5000, '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z'
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
      'order-alert', 'registration-alert', 0, 'failed', 5000, 'cad',
      'payer@example.com', '{}'::jsonb, '2026-08-01T12:00:00Z',
      '2026-08-02T12:00:00Z', 'checkout-order-alert'
    )
  `;
  yield* sql`
    INSERT INTO registration_order_reviews (
      review_id,
      order_id,
      reason,
      detail,
      created_at
    ) VALUES (
      'review-alert', 'order-alert', 'amount_mismatch', 'Expected 5000 cents',
      '2026-08-01T12:00:00Z'
    )
  `;
  yield* sql`
    INSERT INTO notification_deliveries (
      delivery_key,
      registration_order_id,
      subject,
      content,
      status
    ) VALUES (
      'order:order-alert:checkout-failed', 'order-alert',
      '[Registration] Checkout failed — order-alert', 'Checkout failed.', 'failed'
    )
  `;
  yield* sql`
    INSERT INTO notification_deliveries (
      delivery_key,
      batch_id,
      subject,
      content,
      status
    ) VALUES (
      'form:batch-alert:admin-email', 'batch-alert',
      'Form notification', 'Must remain scoped to the Form worker.', 'failed'
    )
  `;
});

describe('Registration mailbox alerts', () => {
  it.effect('delivers failures and daily unresolved-review reminders to the configured mailbox', () => {
    const sent: Array<{
      readonly recipient?: string;
      readonly senderName?: string;
      readonly subject: string;
      readonly idempotencyKey?: string;
    }> = [];
    const mailer = Layer.succeed(
      Mailer.Service,
      Mailer.Service.of({
        send: (input) => Effect.sync(() => void sent.push(input)),
      }),
    );
    const relational = NotificationDelivery.layer.pipe(
      Layer.provideMerge(DatabaseTest.layer),
    );
    const testLayer = RegistrationAlerts.layer.pipe(
      Layer.provideMerge(relational),
      Layer.provideMerge(configuredEnv),
      Layer.provideMerge(mailer),
    );

    return Effect.gen(function* () {
      yield* seedOrderAndReview();
      const alerts = yield* RegistrationAlerts.Service;
      const firstPass = Date.parse('2026-08-03T12:00:00Z');
      expect(alerts.available).toBe(true);
      expect(yield* alerts.drain(firstPass)).toBe(2);
      expect(yield* alerts.drain(firstPass)).toBe(0);
      expect(sent.map((message) => message.recipient)).toEqual([
        'registration-ops@example.com',
        'registration-ops@example.com',
      ]);
      expect(sent.map((message) => message.senderName)).toEqual([
        'GYCC Registration',
        'GYCC Registration',
      ]);
      expect(sent.map((message) => message.subject)).toContain(
        '[Registration] Unresolved Order review — order-alert',
      );

      const sql = yield* SqlClient;
      const formDelivery = yield* sql<{ status: string }>`
        SELECT status FROM notification_deliveries
        WHERE delivery_key = 'form:batch-alert:admin-email'
      `;
      expect(formDelivery).toEqual([{ status: 'failed' }]);
      yield* sql`
        UPDATE registration_order_reviews
        SET status = 'resolved', resolved_at = now()
        WHERE review_id = 'review-alert'
      `;
      expect(
        yield* alerts.drain(Date.parse('2026-08-04T12:00:00Z')),
      ).toBe(0);
    }).pipe(Effect.provide(testLayer));
  });
});
