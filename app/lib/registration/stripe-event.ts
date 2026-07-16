import { Schema } from 'effect';

import { Cents } from '../forms/pricing';
import {
  OrderId,
  StripeEventId,
  type StripeReceipt,
} from './order-repository.server';
import type { OrderEvent } from './order-transition';
import type { StripeEvent } from './stripe-gateway.server';

export type RoutedStripeEvent = {
  readonly orderId: OrderId;
  readonly receipt: StripeReceipt;
  readonly event: OrderEvent;
};

export type StripeEventRoute =
  | { readonly _tag: 'Routed'; readonly value: RoutedStripeEvent }
  | { readonly _tag: 'Ignored'; readonly eventId: string; readonly type: string };

export class MalformedStripeEvent extends Schema.TaggedErrorClass<MalformedStripeEvent>()(
  'StripeEvent.Malformed',
  { eventType: Schema.String, reason: Schema.String },
) {}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const metadataOrderId = (object: Record<string, unknown>): OrderId | undefined => {
  const metadata = record(object['metadata']);
  const value = metadata === undefined ? undefined : string(metadata['orderId']);
  return value === undefined ? undefined : OrderId.make(value);
};

const paymentIntentId = (value: unknown): string | undefined => {
  const direct = string(value);
  if (direct !== undefined) return direct;
  const expanded = record(value);
  return expanded === undefined ? undefined : string(expanded['id']);
};

const malformed = (eventType: string, reason: string): never => {
  throw new MalformedStripeEvent({ eventType, reason });
};

const checkoutEvent = (
  type: string,
  object: Record<string, unknown>,
  at: number,
): OrderEvent => {
  switch (type) {
    case 'checkout.session.completed': {
      const paymentStatus = object['payment_status'];
      if (
        paymentStatus !== 'paid' &&
        paymentStatus !== 'unpaid' &&
        paymentStatus !== 'no_payment_required'
      ) {
        return malformed(type, 'missing or unknown payment_status');
      }
      const amount = object['amount_total'];
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
        return malformed(type, 'amount_total must be non-negative integer cents');
      }
      const intent = paymentIntentId(object['payment_intent']);
      return {
        _tag: 'CheckoutCompleted',
        at,
        paymentStatus,
        amountTotal: Cents.make(amount),
        ...(intent === undefined ? {} : { paymentIntentId: intent }),
      };
    }
    case 'checkout.session.async_payment_succeeded': {
      const amount = object['amount_total'];
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
        return malformed(type, 'amount_total must be non-negative integer cents');
      }
      const intent = paymentIntentId(object['payment_intent']);
      return {
        _tag: 'AsyncPaymentSucceeded',
        at,
        amountTotal: Cents.make(amount),
        ...(intent === undefined ? {} : { paymentIntentId: intent }),
      };
    }
    case 'checkout.session.async_payment_failed':
      return { _tag: 'AsyncPaymentFailed' };
    case 'checkout.session.expired':
      return { _tag: 'CheckoutExpired', at };
    default:
      return malformed(type, 'unsupported Checkout event');
  }
};

const refundEvent = (
  type: string,
  object: Record<string, unknown>,
  at: number,
): OrderEvent => {
  const status = object['status'];
  if (status === 'succeeded') return { _tag: 'RefundSucceeded', at };
  if (type === 'refund.failed' || status === 'failed' || status === 'canceled') {
    return {
      _tag: 'RefundFailed',
      at,
      detail:
        string(object['failure_reason']) ??
        `Stripe refund entered ${String(status)} status`,
    };
  }
  return malformed(type, `refund status ${String(status)} is not terminal`);
};

const SUPPORTED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'refund.updated',
  'refund.failed',
]);

/** Normalize a verified Stripe envelope into the closed Order event vocabulary. */
export const routeStripeEvent = (
  envelope: StripeEvent,
  receivedAt: number,
): StripeEventRoute => {
  const eventId = string(envelope.id) ?? malformed('', 'missing event id');
  const type = string(envelope.type) ?? malformed('', 'missing event type');
  if (!SUPPORTED.has(type)) return { _tag: 'Ignored', eventId, type };

  const data = record(envelope.data) ?? malformed(type, 'missing data object');
  const object = record(data['object']) ?? malformed(type, 'missing data.object');
  const orderId = metadataOrderId(object) ??
    malformed(type, 'missing metadata.orderId');
  const at =
    typeof envelope.created === 'number' && Number.isFinite(envelope.created)
      ? envelope.created * 1_000
      : receivedAt;
  const event = type.startsWith('checkout.session.')
    ? checkoutEvent(type, object, at)
    : refundEvent(type, object, at);

  return {
    _tag: 'Routed',
    value: {
      orderId,
      receipt: { id: StripeEventId.make(eventId), type },
      event,
    },
  };
};
