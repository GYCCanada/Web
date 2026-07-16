import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { DatabaseTest } from '../database.test-helper';
import { Cents } from '../forms/pricing';
import {
  OrderId,
  OrderRepository,
  StripeEventId,
} from './order-repository.server';

const testLayer = OrderRepository.layer.pipe(
  Layer.provideMerge(DatabaseTest.layer),
);
const test = it.effect.layer(testLayer);
const orderId = OrderId.make('order-1');

const seedOrder = Effect.gen(function* () {
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
    ) VALUES ('/2026', 'open', 'registration', 'v1', 'America/Toronto')
  `;
  yield* sql`
    INSERT INTO submission_batches (
      batch_id,
      form_id,
      definition_version_id,
      idempotency_token,
      command_hash
    ) VALUES ('batch-1', 'registration', 'v1', 'attempt-1', 'hash-1')
  `;
  yield* sql`
    INSERT INTO submissions (submission_id, batch_id, ordinal, payload)
    VALUES ('submission-1', 'batch-1', 0, '{}'::jsonb)
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
      public_token_hash,
      billing_mode,
      currency,
      total_amount,
      priced_at,
      quote_expires_at
    ) VALUES (
      'registration-1', '/2026', 'registration', 'v1', 'batch-1',
      'registration-attempt-1', 'registration-hash-1', 'public-hash-1',
      'group', 'cad', 5000, '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z'
    )
  `;
  yield* sql`
    INSERT INTO registrants (
      registrant_id,
      registration_id,
      submission_id,
      ordinal
    ) VALUES ('registrant-1', 'registration-1', 'submission-1', 0)
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
      ${orderId}, 'registration-1', 0, 'awaiting_payment', 5000, 'cad',
      'payer@example.com', '{}'::jsonb, '2026-08-01T12:00:00Z',
      '2026-08-02T12:00:00Z', 'checkout-order-1'
    )
  `;
  yield* sql`
    INSERT INTO registration_order_registrants (
      order_id,
      registrant_id,
      registration_id
    ) VALUES (${orderId}, 'registrant-1', 'registration-1')
  `;
});

describe('OrderRepository', () => {
  test('reads the frozen Checkout request only while it is preparing', () =>
    Effect.gen(function* () {
      yield* seedOrder;
      const sql = yield* SqlClient;
      yield* sql`
        UPDATE registration_orders
        SET status = 'preparing_checkout'
        WHERE order_id = ${orderId}
      `;
      const repository = yield* OrderRepository.Service;
      const checkout = yield* repository.checkout(orderId);
      expect(checkout).toEqual({
        orderId,
        registrationId: 'registration-1',
        amount: Cents.make(5_000),
        receiptEmail: 'payer@example.com',
        idempotencyKey: 'checkout-order-1',
        quoteExpiresAt: Date.parse('2026-08-02T12:00:00Z'),
      });
    }),
  );

  test('atomically confirms an Order and every linked Registrant', () =>
    Effect.gen(function* () {
      yield* seedOrder;
      const repository = yield* OrderRepository.Service;
      const result = yield* repository.apply({
        orderId,
        event: {
          _tag: 'CheckoutCompleted',
          at: Date.parse('2026-08-01T12:05:00Z'),
          paymentStatus: 'paid',
          amountTotal: Cents.make(5_000),
          paymentIntentId: 'pi_1',
        },
        stripeReceipt: {
          id: StripeEventId.make('evt_paid'),
          type: 'checkout.session.completed',
        },
      });
      expect(result._tag).toBe('Applied');

      const sql = yield* SqlClient;
      const orders = yield* sql<{
        status: string;
        paymentIntent: string;
        lastEvent: string;
      }>`
        SELECT
          status,
          stripe_payment_intent_id AS "paymentIntent",
          last_stripe_event_id AS "lastEvent"
        FROM registration_orders
        WHERE order_id = ${orderId}
      `;
      const registrants = yield* sql<{ status: string }>`
        SELECT status FROM registrants WHERE registrant_id = 'registrant-1'
      `;
      const receipts = yield* sql<{ outcome: string }>`
        SELECT outcome FROM stripe_event_receipts WHERE stripe_event_id = 'evt_paid'
      `;
      expect(orders[0]).toEqual({
        status: 'confirmed',
        paymentIntent: 'pi_1',
        lastEvent: 'evt_paid',
      });
      expect(registrants[0]?.status).toBe('confirmed');
      expect(receipts[0]?.outcome).toBe('processed');
    }),
  );

  test('deduplicates Stripe events before applying their transition', () =>
    Effect.gen(function* () {
      yield* seedOrder;
      const repository = yield* OrderRepository.Service;
      const command = {
        orderId,
        event: {
          _tag: 'CheckoutCompleted' as const,
          at: Date.parse('2026-08-01T12:05:00Z'),
          paymentStatus: 'paid' as const,
          amountTotal: Cents.make(5_000),
        },
        stripeReceipt: {
          id: StripeEventId.make('evt_once'),
          type: 'checkout.session.completed',
        },
      };

      expect((yield* repository.apply(command))._tag).toBe('Applied');
      expect((yield* repository.apply(command))._tag).toBe(
        'DuplicateStripeEvent',
      );
      const sql = yield* SqlClient;
      const receipts = yield* sql<{ count: number }>`
        SELECT count(*)::int AS count FROM stripe_event_receipts
        WHERE stripe_event_id = 'evt_once'
      `;
      expect(receipts[0]?.count).toBe(1);
    }),
  );

  test('keeps mismatched money unchanged and upserts one open review', () =>
    Effect.gen(function* () {
      yield* seedOrder;
      const repository = yield* OrderRepository.Service;

      for (const eventId of ['evt_bad_1', 'evt_bad_2']) {
        yield* repository.apply({
          orderId,
          event: {
            _tag: 'CheckoutCompleted',
            at: Date.parse('2026-08-01T12:05:00Z'),
            paymentStatus: 'paid',
            amountTotal: Cents.make(4_999),
          },
          stripeReceipt: {
            id: StripeEventId.make(eventId),
            type: 'checkout.session.completed',
          },
        });
      }

      const sql = yield* SqlClient;
      const orders = yield* sql<{ status: string }>`
        SELECT status FROM registration_orders WHERE order_id = ${orderId}
      `;
      const reviews = yield* sql<{ count: number }>`
        SELECT count(*)::int AS count FROM registration_order_reviews
        WHERE order_id = ${orderId} AND reason = 'amount_mismatch' AND status = 'open'
      `;
      expect(orders[0]?.status).toBe('awaiting_payment');
      expect(reviews[0]?.count).toBe(1);
    }),
  );

  test('cancels linked Registrants when a refund begins', () =>
    Effect.gen(function* () {
      yield* seedOrder;
      const repository = yield* OrderRepository.Service;
      yield* repository.apply({
        orderId,
        event: {
          _tag: 'CheckoutCompleted',
          at: Date.parse('2026-08-01T12:05:00Z'),
          paymentStatus: 'paid',
          amountTotal: Cents.make(5_000),
        },
      });
      yield* repository.apply({
        orderId,
        event: {
          _tag: 'RefundRequested',
          at: Date.parse('2026-08-01T12:10:00Z'),
        },
      });

      const sql = yield* SqlClient;
      const orders = yield* sql<{ status: string }>`
        SELECT status FROM registration_orders WHERE order_id = ${orderId}
      `;
      const registrants = yield* sql<{ status: string }>`
        SELECT status FROM registrants WHERE registrant_id = 'registrant-1'
      `;
      expect(orders[0]?.status).toBe('refund_pending');
      expect(registrants[0]?.status).toBe('cancelled');
    }),
  );
});
