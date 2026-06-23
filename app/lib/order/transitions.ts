import { Schema } from 'effect';

/**
 * The PURE Order lifecycle transition table — the SINGLE source of truth for
 * which `status → status` flip is legal (Decision 5 / G4). Lifted into its own
 * dependency-free module so BOTH the durable entity (`order.actor.ts`, which
 * consults it in the `settle` paid guard) AND the bucket authority
 * (`submissions.server.ts`, whose `markOrder*` `flipStatus` guards enforce it)
 * read the SAME predicate without a circular import — `order.actor.ts` imports
 * `Submissions`, so `submissions.server.ts` cannot import back from
 * `order.actor.ts`. This module depends on nothing but `effect`'s `Schema`, so
 * both sides import it freely and there is no second source of truth to drift.
 *
 * The five actor-visible lifecycle states. The persisted actor `OrderState`
 * carries exactly these; it does NOT carry `failed` (a bucket-only terminal from
 * `checkout.session.async_payment_failed`, mapped to a Failure reply, never an
 * `OrderState` value).
 */
export const OrderStatus = Schema.Literals([
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'expired',
]);
export type OrderStatus = typeof OrderStatus.Type;

/**
 * The full bucket-status set the transition table reconciles over: the UNION of
 * the actor's five visible states PLUS `failed` (bucket-only,
 * `async_payment_failed`). Legality is a property of the bucket
 * `RegistrationOrder.status` lifecycle, which carries this same closed 6-literal
 * set (`order.ts`).
 */
export type BucketStatus = OrderStatus | 'failed';

/**
 * The pure transition table: which `status → status` flips are legal.
 *
 * Legal:
 *   - `pending → { paid, cancelled, expired, failed }`
 *   - `paid    → refunded`
 *   - any `x → x` (idempotent re-flip to the same terminal is a no-op)
 * Everything else is illegal.
 *
 * Terminal states (`cancelled`, `refunded`, `expired`, `failed`) have no legal
 * onward transition except to themselves; `paid` may ONLY go to `refunded`.
 */
const LEGAL_TRANSITIONS: Readonly<
  Record<BucketStatus, ReadonlySet<BucketStatus>>
> = {
  pending: new Set<BucketStatus>(['paid', 'cancelled', 'expired', 'failed']),
  paid: new Set<BucketStatus>(['refunded']),
  cancelled: new Set<BucketStatus>(),
  refunded: new Set<BucketStatus>(),
  expired: new Set<BucketStatus>(),
  failed: new Set<BucketStatus>(),
};

/**
 * `true` iff `from → to` is a legal Order lifecycle transition. An identity flip
 * (`from === to`) is always legal (idempotent replay no-op); otherwise the
 * target must be in `from`'s legal target set.
 */
export const canTransition = (from: BucketStatus, to: BucketStatus): boolean =>
  from === to || LEGAL_TRANSITIONS[from].has(to);
