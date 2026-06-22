export * as OrderActor from './order.actor';

import { Schema } from 'effect';

import { IsoDate, ListItemId } from '../content/schema';
import { BillingMode } from '../forms/party';
import { Cents, CurrencyCode } from '../forms/pricing';

import { Actor } from 'effect-encore';

/**
 * G4 — the durable **Order entity**: definition + state machine ONLY (no Stripe
 * calls, no bucket writes, no runner wiring — those land in G6/G7).
 *
 * The Order WRAPS the registrar freeze (it does NOT replace it). The bucket
 * `RegistrationOrder` (`app/lib/forms/order.ts`) is the durable source of truth;
 * this actor's in-process `OrderState` is a derived cache (Architecture Decision
 * 1). Every op handler (G6/G7) writes the bucket transition (`Submissions`
 * `flipStatus`, the authority) AND mirrors it into `OrderState` atomically within
 * the handler.
 *
 * ## The op surface (state machine `pending | paid | cancelled | refunded | expired`)
 *
 *   - `arm`     — the durable lifecycle ANCHOR. The registration action mints the
 *                 frozen order + Checkout session synchronously (the freeze stays
 *                 at the action boundary), then `send`s `arm` to record the entity
 *                 into existence at `pending`. Fire-and-forget; never re-creates
 *                 the session.
 *   - `settle`  — the post-payment continuation the Stripe webhook resolves on
 *                 `checkout.session.completed` (`pending → paid`). On the
 *                 async-payment-failed path the webhook resolves `settle` to a
 *                 Failure → bucket `failed` (no regression, Decision 7).
 *   - `cancel`  — operator/abandon (`pending → cancelled`). Distinct from `failed`
 *                 (which is Stripe async-payment-failed).
 *   - `refund`  — genuinely new (`paid → refunded`); issues a Stripe refund (G7).
 *   - `expire`  — deadline lapse (`pending → expired`).
 *
 * ## The `id` rule (Architecture Decision 4 — the webhook ExecId reconstruction)
 *
 * Every op's `id` is a PURE STRING fn of `orderId` alone: `id: (p) => p.orderId`.
 * When `id` returns a string, `resolveId` sets `entityId === primaryKey ===
 * orderId` and `id` IGNORES every other payload field. So the webhook — which
 * holds only `metadata.orderId` — resolves the op's ExecId by calling the op's
 * own method with a payload carrying only `{ orderId }`
 * (`Order.settle.waitFor({ orderId })` / `.peek({ orderId })`), WITHOUT
 * reconstructing the full payload, and WITHOUT `entityIdCodec`/`makeExecId`
 * string-surgery. The G3 probe (`runner.test.ts`) already proves this property
 * end-to-end; the round-trip assertion against the REAL ops lands with the
 * handlers (G6+).
 */

/**
 * The frozen order linkage the registration action `send`s into `arm` — every
 * field that drives the durable lifecycle. The brands are REUSED from the
 * registrar domain (`derive-dont-sync`, never redeclared): `Cents` /
 * `CurrencyCode` / `BillingMode` / `ListItemId` / `IsoDate`. This payload
 * mirrors the bucket `RegistrationOrder` (`app/lib/forms/order.ts`) — the actor
 * does not invent a parallel shape, it carries the same frozen receipt linkage.
 */
export const ArmPayload = {
  orderId: Schema.String,
  mode: BillingMode,
  amount: Cents,
  currency: CurrencyCode,
  receiptEmail: Schema.String,
  sessionId: Schema.String,
  registrantIds: Schema.Array(ListItemId),
  deadline: Schema.optionalKey(IsoDate),
} as const;

/**
 * The webhook (`checkout.session.completed`) resolves `settle` holding only
 * `metadata.orderId`, so `orderId` is the ONLY required field. The Stripe
 * session fields the webhook also carries (`sessionId`, the resolved
 * `paymentIntentId` for a later refund, G7) ride along as `optionalKey` — `id`
 * ignores them, so they never perturb the ExecId, but the handler can read them
 * when present.
 */
export const SettlePayload = {
  orderId: Schema.String,
  sessionId: Schema.optionalKey(Schema.String),
  paymentIntentId: Schema.optionalKey(Schema.String),
} as const;

/** `cancel` / `refund` / `expire` are keyed on `orderId` alone. */
export const OrderIdPayload = {
  orderId: Schema.String,
} as const;

/**
 * The persisted actor State — a DERIVED in-process cache of the bucket order's
 * lifecycle (Decision 1). It carries the FIVE actor-visible states; it does NOT
 * carry `failed` — `failed` is a bucket-only terminal from
 * `checkout.session.async_payment_failed`, which the actor maps to a Failure
 * reply (G6), never an `OrderState` value. `sessionId` mirrors the bucket order;
 * `paidAt` is set the instant `settle` first succeeds and never re-stamped
 * (the byte-identical idempotency contract, `order.ts:62-71`).
 */
export const OrderStatus = Schema.Literals([
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'expired',
]);
export type OrderStatus = typeof OrderStatus.Type;

export const OrderState = Schema.Struct({
  status: OrderStatus,
  sessionId: Schema.String,
  paidAt: Schema.optionalKey(IsoDate),
});
export type OrderState = typeof OrderState.Type;

/**
 * The Order durable entity. Definition only — handler bodies (the bucket
 * transitions + Stripe calls) land in G6/G7. Every op is `persisted: true` (the
 * durable SQL mailbox is the coordination seam between the action sender, the
 * runner, and the webhook) and keyed `id: (p) => p.orderId` (Decision 4).
 */
export const Order = Actor.fromEntity(
  'Order',
  {
    arm: {
      payload: ArmPayload,
      success: Schema.Void,
      persisted: true,
      id: (p: { readonly orderId: string }) => p.orderId,
    },
    settle: {
      payload: SettlePayload,
      success: Schema.Void,
      persisted: true,
      id: (p: { readonly orderId: string }) => p.orderId,
    },
    cancel: {
      payload: OrderIdPayload,
      success: Schema.Void,
      persisted: true,
      id: (p: { readonly orderId: string }) => p.orderId,
    },
    refund: {
      payload: OrderIdPayload,
      success: Schema.Void,
      persisted: true,
      id: (p: { readonly orderId: string }) => p.orderId,
    },
    expire: {
      payload: OrderIdPayload,
      success: Schema.Void,
      persisted: true,
      id: (p: { readonly orderId: string }) => p.orderId,
    },
  },
  { state: { schema: OrderState } },
);

/**
 * The full bucket-status set the transition table reconciles over. It is the
 * UNION of the actor's five visible states PLUS `failed` (bucket-only,
 * `async_payment_failed`) — because legality is a property of the bucket
 * `RegistrationOrder.status` lifecycle, not just the actor cache. Widened in G5
 * to this same closed set on the bucket schema (Decision 5).
 */
export type BucketStatus =
  | OrderStatus
  | 'failed';

/**
 * The pure transition predicate (Decision 5 / G4 scope): which `status → status`
 * flip is legal. The runtime handlers (G6/G7) consult this so an out-of-order or
 * replayed op is a typed no-op rather than a corrupt downgrade — the same
 * never-downgrade-a-terminal-state discipline `flipStatus` enforces at the
 * bucket boundary (`submissions.server.ts`).
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
const LEGAL_TRANSITIONS: Readonly<Record<BucketStatus, ReadonlySet<BucketStatus>>> = {
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
