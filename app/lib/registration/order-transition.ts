import { Schema } from 'effect';

import type { Cents } from '../forms/pricing';

export const OrderStatus = Schema.Literals([
  'preparing_checkout',
  'awaiting_payment',
  'awaiting_async',
  'confirmed',
  'failed',
  'expired',
  'refund_pending',
  'refunded',
  'refund_failed',
]);
export type OrderStatus = typeof OrderStatus.Type;

export type OrderState = {
  readonly status: OrderStatus;
  readonly amount: Cents;
  readonly stripeCheckoutSessionId?: string;
  readonly stripeCheckoutUrl?: string;
  readonly stripePaymentIntentId?: string;
  readonly confirmedAt?: number;
  readonly expiredAt?: number;
  readonly refundStartedAt?: number;
  readonly refundedAt?: number;
};

export type OrderEvent =
  | {
      readonly _tag: 'CheckoutCreated';
      readonly sessionId: string;
      readonly checkoutUrl: string;
    }
  | { readonly _tag: 'CheckoutCreationFailed' }
  | {
      readonly _tag: 'CheckoutCompleted';
      readonly at: number;
      readonly paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
      readonly amountTotal: Cents;
      readonly paymentIntentId?: string;
    }
  | {
      readonly _tag: 'AsyncPaymentSucceeded';
      readonly at: number;
      readonly amountTotal: Cents;
      readonly paymentIntentId?: string;
    }
  | { readonly _tag: 'AsyncPaymentFailed' }
  | { readonly _tag: 'CheckoutExpired'; readonly at: number }
  | { readonly _tag: 'LocalExpired'; readonly at: number }
  | { readonly _tag: 'RefundRequested'; readonly at: number }
  | { readonly _tag: 'RefundSucceeded'; readonly at: number }
  | {
      readonly _tag: 'RefundFailed';
      readonly at: number;
      readonly detail: string;
    };

export type Review = {
  readonly reason: 'late_payment' | 'refund_failed' | 'amount_mismatch';
  readonly detail: string;
};

export type Transition = {
  readonly state: OrderState;
  readonly changed: boolean;
  readonly registrants: 'unchanged' | 'confirm' | 'cancel';
  readonly review?: Review;
};

const unchanged = (state: OrderState, review?: Review): Transition => ({
  state,
  changed: false,
  registrants: 'unchanged',
  ...(review === undefined ? {} : { review }),
});

const changed = (
  state: OrderState,
  registrants: Transition['registrants'] = 'unchanged',
  review?: Review,
): Transition => ({
  state,
  changed: true,
  registrants,
  ...(review === undefined ? {} : { review }),
});

const cannotReceivePayment = (status: OrderStatus): boolean =>
  status === 'refund_pending' ||
  status === 'refunded' ||
  status === 'refund_failed';

const settle = (
  state: OrderState,
  event: Extract<
    OrderEvent,
    { readonly _tag: 'CheckoutCompleted' | 'AsyncPaymentSucceeded' }
  >,
): Transition => {
  if (event.amountTotal !== state.amount) {
    return unchanged(state, {
      reason: 'amount_mismatch',
      detail: `Expected ${state.amount} cad cents but Stripe reported ${event.amountTotal}`,
    });
  }
  if (state.status === 'confirmed' || cannotReceivePayment(state.status)) {
    return unchanged(state);
  }

  const review: Review | undefined =
    state.status === 'expired'
      ? {
          reason: 'late_payment',
          detail: 'Stripe settled the Order after local expiry',
        }
      : undefined;
  return changed(
    {
      ...state,
      status: 'confirmed',
      confirmedAt: event.at,
      ...(event.paymentIntentId === undefined
        ? {}
        : { stripePaymentIntentId: event.paymentIntentId }),
    },
    'confirm',
    review,
  );
};

/**
 * The sole registration Order state machine. Callers persist this decision and
 * its registrant/review effects in one transaction; transports never invent
 * status transitions of their own.
 */
export const transitionOrder = (
  state: OrderState,
  event: OrderEvent,
): Transition => {
  switch (event._tag) {
    case 'CheckoutCreated':
      return state.status === 'preparing_checkout'
        ? changed({
            ...state,
            status: 'awaiting_payment',
            stripeCheckoutSessionId: event.sessionId,
            stripeCheckoutUrl: event.checkoutUrl,
          })
        : unchanged(state);
    case 'CheckoutCreationFailed':
      return state.status === 'preparing_checkout'
        ? changed({ ...state, status: 'failed' })
        : unchanged(state);
    case 'CheckoutCompleted':
      return event.paymentStatus === 'unpaid'
        ? state.status === 'awaiting_payment'
          ? changed({ ...state, status: 'awaiting_async' })
          : unchanged(state)
        : settle(state, event);
    case 'AsyncPaymentSucceeded':
      return settle(state, event);
    case 'AsyncPaymentFailed':
      return state.status === 'awaiting_async'
        ? changed({ ...state, status: 'failed' })
        : unchanged(state);
    case 'CheckoutExpired':
    case 'LocalExpired':
      return state.status === 'preparing_checkout' ||
        state.status === 'awaiting_payment' ||
        state.status === 'awaiting_async'
        ? changed({ ...state, status: 'expired', expiredAt: event.at })
        : unchanged(state);
    case 'RefundRequested':
      return state.status === 'confirmed'
        ? changed(
            {
              ...state,
              status: 'refund_pending',
              refundStartedAt: event.at,
            },
            'cancel',
          )
        : unchanged(state);
    case 'RefundSucceeded':
      return state.status === 'refund_pending' ||
        state.status === 'refund_failed'
        ? changed({ ...state, status: 'refunded', refundedAt: event.at })
        : unchanged(state);
    case 'RefundFailed':
      return state.status === 'refund_pending'
        ? changed(
            { ...state, status: 'refund_failed' },
            'unchanged',
            { reason: 'refund_failed', detail: event.detail },
          )
        : unchanged(state);
  }
};
