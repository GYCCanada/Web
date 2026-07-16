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

const registrationCommerce = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`
    CREATE TABLE registration_channels (
      conference_slug text PRIMARY KEY,
      state text NOT NULL CHECK (
        state IN ('closed', 'external', 'preview', 'open', 'draining')
      ),
      external_url text,
      form_id text,
      form_definition_version_id text,
      conference_timezone text,
      revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (form_id, form_definition_version_id)
        REFERENCES form_definition_versions(form_id, version_id),
      CONSTRAINT registration_channels_slug CHECK (
        conference_slug ~ '^/[0-9]{4}$'
      ),
      CONSTRAINT registration_channels_shape CHECK (
        (
          state = 'closed'
          AND external_url IS NULL
          AND form_id IS NULL
          AND form_definition_version_id IS NULL
          AND conference_timezone IS NULL
        )
        OR (
          state = 'external'
          AND external_url IS NOT NULL
          AND external_url ~ '^https://'
          AND form_id IS NULL
          AND form_definition_version_id IS NULL
          AND conference_timezone IS NULL
        )
        OR (
          state IN ('preview', 'open', 'draining')
          AND external_url IS NULL
          AND form_id IS NOT NULL
          AND form_id = 'registration'
          AND form_definition_version_id IS NOT NULL
          AND conference_timezone IS NOT NULL
          AND length(conference_timezone) > 0
        )
      )
    )
  `;

  yield* sql`
    CREATE TABLE form_definition_drafts (
      form_id text PRIMARY KEY REFERENCES forms(form_id) ON DELETE CASCADE,
      base_version_id text,
      definition jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
      saved_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (form_id, base_version_id)
        REFERENCES form_definition_versions(form_id, version_id)
    )
  `;

  yield* sql`
    CREATE TABLE registrations (
      registration_id text PRIMARY KEY,
      conference_slug text NOT NULL
        REFERENCES registration_channels(conference_slug),
      form_id text NOT NULL CHECK (form_id = 'registration'),
      form_definition_version_id text NOT NULL,
      submission_batch_id text NOT NULL UNIQUE
        REFERENCES submission_batches(batch_id),
      idempotency_token text NOT NULL,
      command_hash text NOT NULL,
      billing_mode text NOT NULL CHECK (
        billing_mode IN ('group', 'perRegistrant')
      ),
      currency text NOT NULL CHECK (currency = 'cad'),
      total_amount integer NOT NULL CHECK (total_amount >= 0),
      priced_at timestamptz NOT NULL,
      quote_expires_at timestamptz NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (conference_slug, idempotency_token),
      FOREIGN KEY (form_id, form_definition_version_id)
        REFERENCES form_definition_versions(form_id, version_id),
      CONSTRAINT registrations_quote_window CHECK (
        quote_expires_at > priced_at
      )
    )
  `;

  yield* sql`
    CREATE TABLE registrants (
      registrant_id text PRIMARY KEY,
      registration_id text NOT NULL
        REFERENCES registrations(registration_id) ON DELETE CASCADE,
      submission_id text NOT NULL UNIQUE
        REFERENCES submissions(submission_id),
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      status text NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'confirmed', 'cancelled')
      ),
      confirmed_at timestamptz,
      cancelled_at timestamptz,
      UNIQUE (registration_id, ordinal),
      UNIQUE (registrant_id, registration_id),
      CONSTRAINT registrants_status_shape CHECK (
        (status = 'pending' AND confirmed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE TABLE registration_orders (
      order_id text PRIMARY KEY,
      registration_id text NOT NULL
        REFERENCES registrations(registration_id) ON DELETE CASCADE,
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      status text NOT NULL CHECK (
        status IN (
          'preparing_checkout',
          'awaiting_payment',
          'awaiting_async',
          'confirmed',
          'failed',
          'expired',
          'refund_pending',
          'refunded',
          'refund_failed'
        )
      ),
      amount integer NOT NULL CHECK (amount >= 0),
      currency text NOT NULL CHECK (currency = 'cad'),
      receipt_email text NOT NULL CHECK (length(receipt_email) > 0),
      quote_snapshot jsonb NOT NULL,
      priced_at timestamptz NOT NULL,
      quote_expires_at timestamptz NOT NULL,
      stripe_idempotency_key text NOT NULL UNIQUE,
      stripe_checkout_session_id text UNIQUE,
      stripe_checkout_url text,
      stripe_payment_intent_id text UNIQUE,
      last_stripe_event_id text,
      confirmed_at timestamptz,
      expired_at timestamptz,
      refund_started_at timestamptz,
      refunded_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (registration_id, ordinal),
      UNIQUE (order_id, registration_id),
      CONSTRAINT registration_orders_quote_window CHECK (
        quote_expires_at > priced_at
      ),
      CONSTRAINT registration_orders_checkout_pair CHECK (
        (stripe_checkout_session_id IS NULL AND stripe_checkout_url IS NULL)
        OR (stripe_checkout_session_id IS NOT NULL AND stripe_checkout_url IS NOT NULL)
      ),
      CONSTRAINT registration_orders_status_shape CHECK (
        (status NOT IN ('confirmed', 'refund_pending', 'refunded', 'refund_failed'))
        OR confirmed_at IS NOT NULL
      ),
      CONSTRAINT registration_orders_expiry_shape CHECK (
        status <> 'expired' OR expired_at IS NOT NULL
      ),
      CONSTRAINT registration_orders_refund_shape CHECK (
        (
          status NOT IN ('refund_pending', 'refunded', 'refund_failed')
          OR refund_started_at IS NOT NULL
        )
        AND (status <> 'refunded' OR refunded_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX registration_orders_non_terminal
    ON registration_orders(registration_id, status)
    WHERE status IN (
      'preparing_checkout',
      'awaiting_payment',
      'awaiting_async',
      'refund_pending'
    )
  `;

  yield* sql`
    CREATE TABLE registration_order_registrants (
      order_id text NOT NULL,
      registrant_id text NOT NULL,
      registration_id text NOT NULL,
      PRIMARY KEY (order_id, registrant_id),
      FOREIGN KEY (order_id, registration_id)
        REFERENCES registration_orders(order_id, registration_id)
        ON DELETE CASCADE,
      FOREIGN KEY (registrant_id, registration_id)
        REFERENCES registrants(registrant_id, registration_id)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE stripe_event_receipts (
      stripe_event_id text PRIMARY KEY,
      order_id text REFERENCES registration_orders(order_id),
      event_type text NOT NULL,
      outcome text NOT NULL CHECK (
        outcome IN ('received', 'processed', 'ignored', 'failed')
      ),
      received_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      last_error text,
      CONSTRAINT stripe_event_receipts_outcome_shape CHECK (
        (outcome = 'received' AND processed_at IS NULL)
        OR (outcome <> 'received' AND processed_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE TABLE registration_order_reviews (
      review_id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES registration_orders(order_id),
      reason text NOT NULL CHECK (
        reason IN ('late_payment', 'refund_failed', 'amount_mismatch')
      ),
      status text NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'resolved')
      ),
      detail text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      CONSTRAINT registration_order_reviews_status_shape CHECK (
        (status = 'open' AND resolved_at IS NULL)
        OR (status = 'resolved' AND resolved_at IS NOT NULL)
      )
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX registration_order_reviews_one_open_reason
    ON registration_order_reviews(order_id, reason)
    WHERE status = 'open'
  `;
});

export const loader = Migrator.fromRecord({
  '0001_form_records': formRecords,
  '0002_submission_tokens': submissionTokens,
  '0003_normalize_submission_aggregate': normalizeSubmissionAggregate,
  '0004_notification_deliveries': notificationDeliveries,
  '0005_notification_outbox': notificationOutbox,
  '0006_durable_notification_payloads': durableNotificationPayloads,
  '0007_registration_commerce': registrationCommerce,
});
