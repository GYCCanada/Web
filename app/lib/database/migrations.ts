import { Effect } from 'effect';
import * as Migrator from 'effect/unstable/sql/Migrator';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

const formRecords = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`
    CREATE TABLE forms (
      form_id text PRIMARY KEY,
      current_version_id text,
      CONSTRAINT forms_known_id CHECK (
        form_id IN ('contact', 'volunteer', 'registration')
      )
    )
  `;

  yield* sql`
    CREATE TABLE form_definition_versions (
      form_id text NOT NULL REFERENCES forms(form_id),
      version_id text NOT NULL,
      definition jsonb NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (form_id, version_id)
    )
  `;

  yield* sql`
    ALTER TABLE forms
    ADD CONSTRAINT forms_current_version
    FOREIGN KEY (form_id, current_version_id)
    REFERENCES form_definition_versions(form_id, version_id)
  `;

  yield* sql`
    CREATE TABLE submission_batches (
      batch_id text PRIMARY KEY,
      form_id text NOT NULL,
      definition_version_id text NOT NULL,
      idempotency_token text NOT NULL,
      command_hash text NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (form_id, idempotency_token),
      FOREIGN KEY (form_id, definition_version_id)
        REFERENCES form_definition_versions(form_id, version_id)
    )
  `;

  yield* sql`
    CREATE TABLE submissions (
      submission_id text PRIMARY KEY,
      batch_id text NOT NULL REFERENCES submission_batches(batch_id) ON DELETE CASCADE,
      form_id text NOT NULL,
      definition_version_id text NOT NULL,
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      payload jsonb NOT NULL,
      submitted_at timestamptz NOT NULL,
      UNIQUE (batch_id, ordinal),
      FOREIGN KEY (form_id, definition_version_id)
        REFERENCES form_definition_versions(form_id, version_id)
    )
  `;

  yield* sql`
    CREATE INDEX submissions_form_submitted_at
    ON submissions(form_id, submitted_at DESC)
  `;
});

const submissionTokens = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`
    ALTER TABLE submissions
    ADD COLUMN idempotency_token text
  `;
  yield* sql`
    UPDATE submissions AS submission
    SET idempotency_token = batch.idempotency_token
    FROM submission_batches AS batch
    WHERE batch.batch_id = submission.batch_id
  `;
  yield* sql`
    ALTER TABLE submissions
    ALTER COLUMN idempotency_token SET NOT NULL
  `;
});

const normalizeSubmissionAggregate = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`DROP INDEX submissions_form_submitted_at`;
  yield* sql`
    ALTER TABLE submissions
      DROP COLUMN form_id,
      DROP COLUMN definition_version_id,
      DROP COLUMN idempotency_token,
      DROP COLUMN submitted_at
  `;
  yield* sql`
    CREATE INDEX submission_batches_form_submitted_at
    ON submission_batches(form_id, submitted_at DESC)
  `;
});

const notificationDeliveries = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`
    CREATE TABLE notification_deliveries (
      delivery_key text PRIMARY KEY,
      status text NOT NULL CHECK (status IN ('failed', 'delivering', 'delivered')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_until timestamptz,
      delivered_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
});

const notificationOutbox = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`
    ALTER TABLE notification_deliveries
    ADD COLUMN batch_id text
  `;
  yield* sql`
    UPDATE notification_deliveries AS delivery
    SET batch_id = batch.batch_id
    FROM submission_batches AS batch
    WHERE delivery.delivery_key = 'form:' || batch.batch_id || ':admin-email'
  `;
  yield* sql`
    DELETE FROM notification_deliveries
    WHERE batch_id IS NULL
  `;
  yield* sql`
    ALTER TABLE notification_deliveries
      ALTER COLUMN batch_id SET NOT NULL,
      ADD CONSTRAINT notification_deliveries_batch
        FOREIGN KEY (batch_id) REFERENCES submission_batches(batch_id) ON DELETE CASCADE,
      ADD CONSTRAINT notification_deliveries_one_per_batch UNIQUE (batch_id)
  `;
});

const durableNotificationPayloads = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`
    ALTER TABLE notification_deliveries
      ADD COLUMN subject text,
      ADD COLUMN content text,
      ADD COLUMN claim_token text
  `;
  // Rows created by the preceding release predate rendered payload storage.
  // Preserve their durable intent with an actionable fallback rather than
  // dropping already-committed notifications during the migration.
  yield* sql`
    UPDATE notification_deliveries
    SET
      subject = '[!] Form submission ' || batch_id,
      content = 'A durable Form submission was committed. Batch: ' || batch_id
    WHERE subject IS NULL OR content IS NULL
  `;
  yield* sql`
    ALTER TABLE notification_deliveries
      ALTER COLUMN subject SET NOT NULL,
      ALTER COLUMN content SET NOT NULL
  `;
});

export const loader = Migrator.fromRecord({
  '0001_form_records': formRecords,
  '0002_submission_tokens': submissionTokens,
  '0003_normalize_submission_aggregate': normalizeSubmissionAggregate,
  '0004_notification_deliveries': notificationDeliveries,
  '0005_notification_outbox': notificationOutbox,
  '0006_durable_notification_payloads': durableNotificationPayloads,
});
