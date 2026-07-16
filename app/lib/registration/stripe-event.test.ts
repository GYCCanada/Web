import { describe, expect, test } from 'bun:test';

import { OrderId } from './order-repository.server';
import { MalformedStripeEvent, routeStripeEvent } from './stripe-event';

const envelope = (
  type: string,
  object: Record<string, unknown>,
) => ({
  id: `evt_${type}`,
  type,
  created: 1_786_104_000,
  data: { object: { metadata: { orderId: 'order-1' }, ...object } },
});

describe('Stripe event routing', () => {
  test.each([
    ['paid', 'CheckoutCompleted'],
    ['no_payment_required', 'CheckoutCompleted'],
    ['unpaid', 'CheckoutCompleted'],
  ] as const)('routes completed %s Checkout', (paymentStatus, expected) => {
    const result = routeStripeEvent(
      envelope('checkout.session.completed', {
        payment_status: paymentStatus,
        amount_total: paymentStatus === 'no_payment_required' ? 0 : 5_000,
        payment_intent: paymentStatus === 'paid' ? { id: 'pi_1' } : null,
      }),
      0,
    );
    expect(result._tag).toBe('Routed');
    if (result._tag === 'Routed') {
      expect(result.value.orderId).toBe(OrderId.make('order-1'));
      expect(result.value.event._tag).toBe(expected);
      expect(result.value.receipt.type).toBe('checkout.session.completed');
    }
  });

  test.each([
    ['checkout.session.async_payment_succeeded', 'AsyncPaymentSucceeded'],
    ['checkout.session.async_payment_failed', 'AsyncPaymentFailed'],
    ['checkout.session.expired', 'CheckoutExpired'],
  ] as const)('routes %s', (type, expected) => {
    const result = routeStripeEvent(
      envelope(type, { amount_total: 5_000, payment_intent: 'pi_async' }),
      0,
    );
    expect(result._tag).toBe('Routed');
    if (result._tag === 'Routed') expect(result.value.event._tag).toBe(expected);
  });

  test.each([
    ['refund.updated', 'succeeded', 'RefundSucceeded'],
    ['refund.failed', 'failed', 'RefundFailed'],
  ] as const)('routes terminal %s status', (type, status, expected) => {
    const result = routeStripeEvent(envelope(type, { status }), 0);
    expect(result._tag).toBe('Routed');
    if (result._tag === 'Routed') expect(result.value.event._tag).toBe(expected);
  });

  test('ignores unrelated signed events without treating them as malformed', () => {
    expect(routeStripeEvent(envelope('customer.created', {}), 0)).toEqual({
      _tag: 'Ignored',
      eventId: 'evt_customer.created',
      type: 'customer.created',
    });
  });

  test('rejects supported event shapes that cannot preserve money invariants', () => {
    expect(() =>
      routeStripeEvent(
        envelope('checkout.session.completed', {
          payment_status: 'paid',
          amount_total: null,
        }),
        0,
      ),
    ).toThrow(MalformedStripeEvent);
    expect(() =>
      routeStripeEvent(
        envelope('checkout.session.completed', {
          payment_status: 'paid',
          amount_total: 5_000,
          metadata: {},
        }),
        0,
      ),
    ).toThrow(MalformedStripeEvent);
  });
});
