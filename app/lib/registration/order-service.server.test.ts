import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { DatabaseTest } from '../database.test-helper';
import { OrderActor } from './order-actor.server';
import { OrderId } from './order-repository.server';
import { RegistrationOrders } from './order-service.server';

type ExpireCall = { readonly orderId: OrderId; readonly at: number };
type RefundCall = {
  readonly orderId: OrderId;
  readonly attemptId: string;
  readonly at: number;
};

const testLayer = (calls: {
  readonly expires: ExpireCall[];
  readonly refunds: RefundCall[];
}) => {
  const sender = Layer.succeed(
    OrderActor.Sender,
    OrderActor.Sender.of({
      createCheckout: () => Effect.die('unused'),
      applyStripeEvent: () => Effect.die('unused'),
      expire: (orderId, at) =>
        Effect.sync(() => {
          calls.expires.push({ orderId, at });
        }),
      refund: (orderId, attemptId, at) =>
        Effect.sync(() => {
          calls.refunds.push({ orderId, attemptId, at });
        }),
    }),
  );
  return RegistrationOrders.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(DatabaseTest.layer, sender)),
  );
};

const seedAggregate = Effect.gen(function* () {
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
    ) VALUES ('batch-status', 'registration', 'v1', 'attempt-status', 'hash-status')
  `;
  yield* sql`
    INSERT INTO submissions (submission_id, batch_id, ordinal, payload)
    VALUES
      ('submission-status-1', 'batch-status', 0, '{"name":"Ada"}'::jsonb),
      ('submission-status-2', 'batch-status', 1, '{"name":"Grace"}'::jsonb)
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
      'registration-status', '/2026', 'registration', 'v1', 'batch-status',
      'registration-attempt-status', 'registration-hash-status',
      'perRegistrant', 'cad', 10000,
      '2026-08-01T12:00:00Z', '2026-08-04T12:00:00Z'
    )
  `;
  yield* sql`
    INSERT INTO registrants (
      registrant_id,
      registration_id,
      submission_id,
      ordinal
    ) VALUES
      ('registrant-status-1', 'registration-status', 'submission-status-1', 0),
      ('registrant-status-2', 'registration-status', 'submission-status-2', 1)
  `;
});

const insertOrder = (input: {
  readonly orderId: OrderId;
  readonly ordinal: number;
  readonly registrantId: string;
  readonly quoteExpiresAt: string;
  readonly sessionId?: string;
  readonly checkoutUrl?: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
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
        stripe_idempotency_key,
        stripe_checkout_session_id,
        stripe_checkout_url
      ) VALUES (
        ${input.orderId},
        'registration-status',
        ${input.ordinal},
        'awaiting_payment',
        5000,
        'cad',
        ${`payer-${input.ordinal}@example.com`},
        '{}'::jsonb,
        '2026-08-01T12:00:00Z',
        ${input.quoteExpiresAt},
        ${`checkout-${input.orderId}`},
        ${input.sessionId ?? null},
        ${input.checkoutUrl ?? null}
      )
    `;
    yield* sql`
      INSERT INTO registration_order_registrants (
        order_id,
        registrant_id,
        registration_id
      ) VALUES (
        ${input.orderId},
        ${input.registrantId},
        'registration-status'
      )
    `;
  });

const calls = () => ({ expires: [] as ExpireCall[], refunds: [] as RefundCall[] });

describe('RegistrationOrders', () => {
  it.effect('returns the same non-PII public status by Order and Checkout session', () => {
    const captured = calls();
    const orderId = OrderId.make('order-status-1');
    return Effect.gen(function* () {
      yield* seedAggregate;
      yield* insertOrder({
        orderId,
        ordinal: 0,
        registrantId: 'registrant-status-1',
        quoteExpiresAt: '2026-08-04T12:00:00Z',
        sessionId: 'cs_status',
        checkoutUrl: 'https://checkout.stripe.test/cs_status',
      });
      const orders = yield* RegistrationOrders.Service;
      const byOrder = yield* orders.byOrder(orderId);
      const bySession = yield* orders.byCheckoutSession('cs_status');
      const byRegistration = yield* orders.byRegistration('registration-status');
      const expected = {
        orderId,
        status: 'awaiting_payment',
        amount: 5000,
        currency: 'cad',
        registrantCount: 1,
        checkoutUrl: 'https://checkout.stripe.test/cs_status',
      } as const;
      expect(byOrder).toEqual(expected);
      expect(bySession).toEqual(expected);
      expect(byRegistration).toEqual([expected]);
      expect('receiptEmail' in byOrder).toBe(false);
      expect('payload' in byOrder).toBe(false);
    }).pipe(Effect.provide(testLayer(captured)));
  });

  it.effect('expires only due awaiting-payment Orders', () => {
    const captured = calls();
    const due = OrderId.make('order-status-1');
    const future = OrderId.make('order-status-2');
    const at = Date.parse('2026-08-03T00:00:00Z');
    return Effect.gen(function* () {
      yield* seedAggregate;
      yield* insertOrder({
        orderId: due,
        ordinal: 0,
        registrantId: 'registrant-status-1',
        quoteExpiresAt: '2026-08-02T12:00:00Z',
      });
      yield* insertOrder({
        orderId: future,
        ordinal: 1,
        registrantId: 'registrant-status-2',
        quoteExpiresAt: '2026-08-04T12:00:00Z',
      });
      const count = yield* (yield* RegistrationOrders.Service).expireDue(at);
      expect(count).toBe(1);
      expect(captured.expires).toEqual([{ orderId: due, at }]);
    }).pipe(Effect.provide(testLayer(captured)));
  });

  it.effect('requests a refund with one generated attempt id', () => {
    const captured = calls();
    const orderId = OrderId.make('order-status-1');
    const at = Date.parse('2026-08-03T00:00:00Z');
    return Effect.gen(function* () {
      yield* seedAggregate;
      yield* insertOrder({
        orderId,
        ordinal: 0,
        registrantId: 'registrant-status-1',
        quoteExpiresAt: '2026-08-04T12:00:00Z',
      });
      const attemptId = yield* (yield* RegistrationOrders.Service).requestRefund(
        orderId,
        at,
      );
      expect(attemptId.length).toBeGreaterThan(0);
      expect(captured.refunds).toEqual([{ orderId, attemptId, at }]);
    }).pipe(Effect.provide(testLayer(captured)));
  });

  it.effect('lists open reviews and excludes resolved reviews', () => {
    const captured = calls();
    const orderId = OrderId.make('order-status-1');
    return Effect.gen(function* () {
      yield* seedAggregate;
      yield* insertOrder({
        orderId,
        ordinal: 0,
        registrantId: 'registrant-status-1',
        quoteExpiresAt: '2026-08-04T12:00:00Z',
      });
      const sql = yield* SqlClient;
      yield* sql`
        INSERT INTO registration_order_reviews (
          review_id,
          order_id,
          reason,
          status,
          detail,
          created_at,
          resolved_at
        ) VALUES
          (
            'review-open', ${orderId}, 'late_payment', 'open',
            'Payment arrived after expiry.', '2026-08-03T00:00:00Z', NULL
          ),
          (
            'review-resolved', ${orderId}, 'late_payment', 'resolved',
            'Operator resolved it.', '2026-08-02T00:00:00Z',
            '2026-08-02T01:00:00Z'
          )
      `;
      const reviews = yield* (yield* RegistrationOrders.Service).openReviews;
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        id: 'review-open',
        orderId,
        reason: 'late_payment',
        detail: 'Payment arrived after expiry.',
      });
      yield* (yield* RegistrationOrders.Service).resolveReview(
        'review-open',
        Date.parse('2026-08-03T01:00:00Z'),
      );
      expect(yield* (yield* RegistrationOrders.Service).openReviews).toEqual([]);
      const resolved = yield* sql<{ status: string; resolvedAt: string }>`
        SELECT status, resolved_at::text AS "resolvedAt"
        FROM registration_order_reviews
        WHERE review_id = 'review-open'
      `;
      expect(resolved[0]?.status).toBe('resolved');
      expect(resolved[0]?.resolvedAt).toContain('2026-08-03 01:00:00');
    }).pipe(Effect.provide(testLayer(captured)));
  });
});
