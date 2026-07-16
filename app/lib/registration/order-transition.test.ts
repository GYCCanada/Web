import { describe, expect, test } from 'bun:test';

import { Cents } from '../forms/pricing';
import {
  type OrderEvent,
  type OrderState,
  type OrderStatus,
  transitionOrder,
} from './order-transition';

const order = (
  status: OrderStatus = 'awaiting_payment',
  amount = 5_000,
): OrderState => ({ status, amount: Cents.make(amount) });

describe('registration Order transition matrix', () => {
  test('moves a prepared Order to Checkout exactly once', () => {
    const created = transitionOrder(order('preparing_checkout'), {
      _tag: 'CheckoutCreated',
      sessionId: 'cs_123',
      checkoutUrl: 'https://checkout.stripe.test/cs_123',
    });

    expect(created).toEqual({
      changed: true,
      registrants: 'unchanged',
      state: {
        status: 'awaiting_payment',
        amount: Cents.make(5_000),
        stripeCheckoutSessionId: 'cs_123',
        stripeCheckoutUrl: 'https://checkout.stripe.test/cs_123',
      },
    });
    expect(
      transitionOrder(created.state, {
        _tag: 'CheckoutCreated',
        sessionId: 'cs_other',
        checkoutUrl: 'https://checkout.stripe.test/cs_other',
      }).changed,
    ).toBe(false);
  });

  test.each([
    ['paid' as const, 5_000],
    ['no_payment_required' as const, 0],
  ])('confirms completed %s Checkout, including zero-dollar Orders', (paymentStatus, amount) => {
    const result = transitionOrder(order('awaiting_payment', amount), {
      _tag: 'CheckoutCompleted',
      at: 100,
      paymentStatus,
      amountTotal: Cents.make(amount),
      paymentIntentId: amount === 0 ? undefined : 'pi_123',
    });

    expect(result.state.status).toBe('confirmed');
    expect(result.state.confirmedAt).toBe(100);
    expect(result.registrants).toBe('confirm');
  });

  test('waits for an asynchronous payment after unpaid Checkout completion', () => {
    const awaiting = transitionOrder(order(), {
      _tag: 'CheckoutCompleted',
      at: 100,
      paymentStatus: 'unpaid',
      amountTotal: Cents.make(5_000),
    });
    expect(awaiting.state.status).toBe('awaiting_async');

    const confirmed = transitionOrder(awaiting.state, {
      _tag: 'AsyncPaymentSucceeded',
      at: 200,
      amountTotal: Cents.make(5_000),
      paymentIntentId: 'pi_async',
    });
    expect(confirmed.state.status).toBe('confirmed');
    expect(confirmed.registrants).toBe('confirm');
  });

  test('a settled payment wins the local expiry race and opens a review', () => {
    const expired = transitionOrder(order(), {
      _tag: 'LocalExpired',
      at: 100,
    });
    const settled = transitionOrder(expired.state, {
      _tag: 'CheckoutCompleted',
      at: 101,
      paymentStatus: 'paid',
      amountTotal: Cents.make(5_000),
      paymentIntentId: 'pi_late',
    });

    expect(settled.state.status).toBe('confirmed');
    expect(settled.registrants).toBe('confirm');
    expect(settled.review?.reason).toBe('late_payment');
  });

  test('amount mismatch cannot confirm and opens an operator review', () => {
    const current = order();
    const result = transitionOrder(current, {
      _tag: 'CheckoutCompleted',
      at: 100,
      paymentStatus: 'paid',
      amountTotal: Cents.make(4_999),
    });

    expect(result.state).toBe(current);
    expect(result.changed).toBe(false);
    expect(result.registrants).toBe('unchanged');
    expect(result.review).toEqual({
      reason: 'amount_mismatch',
      detail: 'Expected 5000 cad cents but Stripe reported 4999',
    });
  });

  test('refund initiation cancels linked registrants and failure opens a review', () => {
    const pending = transitionOrder(
      { ...order('confirmed'), confirmedAt: 50 },
      { _tag: 'RefundRequested', at: 100 },
    );
    expect(pending.state.status).toBe('refund_pending');
    expect(pending.registrants).toBe('cancel');

    const failed = transitionOrder(pending.state, {
      _tag: 'RefundFailed',
      at: 110,
      detail: 'Stripe unavailable',
    });
    expect(failed.state.status).toBe('refund_failed');
    expect(failed.review).toEqual({
      reason: 'refund_failed',
      detail: 'Stripe unavailable',
    });

    const recovered = transitionOrder(failed.state, {
      _tag: 'RefundSucceeded',
      at: 120,
    });
    expect(recovered.state.status).toBe('refunded');
    expect(recovered.state.refundedAt).toBe(120);
  });

  test('terminal money states reject stale expiry and payment events', () => {
    const terminal: ReadonlyArray<OrderState> = [
      { ...order('confirmed'), confirmedAt: 1 },
      { ...order('refund_pending'), confirmedAt: 1, refundStartedAt: 2 },
      { ...order('refunded'), confirmedAt: 1, refundStartedAt: 2, refundedAt: 3 },
    ];
    const staleEvents: ReadonlyArray<OrderEvent> = [
      { _tag: 'CheckoutExpired', at: 4 },
      {
        _tag: 'AsyncPaymentSucceeded',
        at: 4,
        amountTotal: Cents.make(5_000),
      },
    ];

    for (const state of terminal) {
      for (const event of staleEvents) {
        expect(transitionOrder(state, event).changed).toBe(false);
      }
    }
  });

  test.each([
    ['preparing_checkout', 'expired'],
    ['awaiting_payment', 'expired'],
    ['awaiting_async', 'expired'],
    ['confirmed', 'confirmed'],
    ['failed', 'failed'],
    ['refund_pending', 'refund_pending'],
  ] as const)('expires %s as %s', (status, expected) => {
    const current =
      status === 'confirmed'
        ? { ...order(status), confirmedAt: 1 }
        : status === 'refund_pending'
          ? { ...order(status), confirmedAt: 1, refundStartedAt: 2 }
          : order(status);
    expect(
      transitionOrder(current, { _tag: 'CheckoutExpired', at: 10 }).state
        .status,
    ).toBe(expected);
  });
});
