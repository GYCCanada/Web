export * as OrderActor from './order.actor';

import { Effect, Schema } from 'effect';

import { IsoDate, ListItemId } from '../content/schema';
import { BillingMode } from '../forms/party';
import { Cents, CurrencyCode } from '../forms/pricing';
import { Submissions } from '../forms/submissions.server';
import type { RegistrationOrder } from '../forms/order';
import { NotFound, StorageError } from '../storage.server';

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
  // `Schema.optional` (value `IsoDate | undefined`), NOT `optionalKey`: encore's
  // payload-input mapped type re-requires every key (it does not honor a Type
  // that omits the key), so an `optionalKey` field would be UNPASSABLE — the
  // input would demand a non-`undefined` `IsoDate`. `Schema.optional` keeps the
  // key present in the input type while letting the action pass `undefined` for
  // a deadline-less order.
  deadline: Schema.optional(IsoDate),
} as const;

/**
 * The webhook (`checkout.session.completed`) resolves `settle` holding only
 * `metadata.orderId`, so `orderId` is the ONLY required field. The Stripe
 * session fields the webhook also carries (`sessionId`, the resolved
 * `paymentIntentId` for a later refund, G7) ride along as `Schema.optional` —
 * `id` ignores them, so they never perturb the ExecId, but the handler can read
 * them when present.
 *
 * These are `Schema.optional` (value `T | undefined`), NOT `optionalKey`:
 * encore's payload-input mapped type re-requires every key, so an `optionalKey`
 * field would demand a non-`undefined` value — `Schema.optional` lets a sender
 * (the webhook, G8) pass `undefined` for the fields it lacks while still
 * deriving the same `orderId`-keyed ExecId (Decision 4 — `id` ignores them).
 */
export const SettlePayload = {
  orderId: Schema.String,
  // The settlement outcome the webhook resolves `settle` with: a
  // `checkout.session.completed` carries `'paid'` (⇒ `markOrderPaid` + State
  // `paid`), a `checkout.session.async_payment_failed` carries `'failed'` (⇒
  // `markOrderFailed` + the op resolves to a `SettleFailed` Failure reply,
  // preserving the existing webhook `failed` behavior, Decision 7). `id`
  // ignores it (it is a pure fn of `orderId`), so a webhook holding only
  // `metadata.orderId` still resolves the same ExecId; an absent/`undefined`
  // outcome defaults to `'paid'` (the common completed-session path).
  outcome: Schema.optional(Schema.Literals(['paid', 'failed'])),
  sessionId: Schema.optional(Schema.String),
  paymentIntentId: Schema.optional(Schema.String),
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
 * The persisted Failure reply the `settle` op resolves to on the
 * async-payment-failed path (Decision 7): the bucket has already flipped
 * `failed` (`Submissions.markOrderFailed`) and the durable reply is a Failure,
 * so a sender (the webhook, G8) observing it knows the order settled to
 * `failed`. Carries the `orderId` so the Failure is self-describing.
 */
export class SettleFailed extends Schema.TaggedErrorClass<SettleFailed>()(
  'Order.SettleFailed',
  { orderId: Schema.String },
) {}

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
      // The async-payment-failed path resolves `settle` to a Failure reply
      // (Decision 7) — a persisted, durable Failure the webhook/sender observes
      // while the bucket has already flipped `failed`.
      error: SettleFailed,
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

/**
 * The bucket form every Order entity reconciles. The Order lifecycle is the
 * registration-payment lifecycle, and the registration order bucket
 * (`submissions/registration/orders/<orderId>.json`) is keyed by `'registration'`
 * — the same form id the Stripe webhook and the registration action use
 * (`api.stripe-webhook.ts`, `registration-action.ts`). One form, one durable
 * source of truth.
 */
const ORDER_FORM = 'registration';

/**
 * Project a bucket `RegistrationOrder` onto the actor's derived `OrderState`
 * cache (Decision 1: bucket = authority, State = mirror). The bucket carries a
 * `failed` terminal the actor State cannot (it is a Failure REPLY, never a
 * State value); a `failed` bucket order therefore mirrors as the pre-failure
 * actor-visible `pending` (the entity exists, awaiting/awaited settlement —
 * its terminal `failed` outcome lives on the durable reply, not the State).
 * Every other bucket status is an actor-visible state and passes through.
 */
const orderStateFromBucket = (order: RegistrationOrder): OrderState => ({
  status: order.status === 'failed' ? 'pending' : order.status,
  sessionId: order.sessionId,
  ...(order.paidAt === undefined ? {} : { paidAt: order.paidAt }),
});

/**
 * G6 — the `arm` + `settle` handler layer. This is the runner-side bytecode the
 * `ServerLive` Sharding runner registers (`runner.server.ts`); the request side
 * (registration action + webhook) only `send`s/`waitFor`s against it.
 *
 * ## State model (Decision 1 — the bucket IS the authority)
 *
 * Every handler reads/writes the durable bucket order through `Submissions`
 * (the `flipStatus` discipline, `submissions.server.ts`). The actor's
 * `OrderState` is a DERIVED VIEW (`readState`) projected from that bucket on
 * read — NOT a separately-stored cache that could drift, and NOT encore's
 * registered per-entity `State` (whose `registerState`/`getState` protocol is
 * only wired through the `toTestLayer` activation path, not the production
 * Sharding `toLayer` runner this lifecycle uses). A process restart between
 * `arm` and `settle` therefore loses nothing — the bucket order is the durable
 * record, and the view is recomputed from it.
 *
 * ## `arm` — the durable lifecycle anchor
 *
 * `arm` does NOT create a session (the action already did, synchronously). It
 * read-backs the frozen bucket order — re-asserting the entity exists at the
 * bucket authority at `pending`. Idempotent: a duplicate `arm` for the same
 * `orderId` re-reads the same order (encore's primaryKey dedup also collapses a
 * verbatim re-`send`).
 *
 * ## `settle` — the post-payment continuation
 *
 * Success ⇒ `pending → paid`: `Submissions.markOrderPaid` (the byte-identical
 * `paidAt` freeze, the idempotency contract). The async-payment-failed path is
 * the webhook resolving `settle` with `outcome: 'failed'` (G8): the handler
 * flips the bucket to `failed` via `Submissions.markOrderFailed` and FAILS the
 * op with `SettleFailed`, so the persisted reply is a Failure — preserving the
 * existing webhook `failed` behavior with no regression (Decision 7).
 */
/**
 * The derived `OrderState` VIEW: the bucket order projected onto the actor's
 * lifecycle state (Decision 1 — the bucket is the authority; the "actor State"
 * is a derived view, computed FROM the bucket on read, never a separately-stored
 * cache that could drift). The webhook/sweep/admin reads consult this (G8/G9).
 * A genuinely-missing order surfaces as `NotFound`; a bucket fault as
 * `StorageError`.
 *
 * (encore's registered per-entity `State` protocol — `registerState` /
 * `getState` — is only wired through the `toTestLayer` activation path today,
 * NOT the production Sharding `toLayer` runner this lifecycle uses; deriving the
 * view from the bucket authority is both the supported path AND the
 * divergence-free one Decision 1 calls for.)
 */
export const readState = (
  orderId: string,
): Effect.Effect<OrderState, StorageError | NotFound, Submissions.Service> =>
  Submissions.Service.pipe(
    Effect.flatMap((submissions) => submissions.getOrder(ORDER_FORM, orderId)),
    Effect.map(orderStateFromBucket),
  );

export const handlers = Actor.toLayer(
  Order,
  Effect.gen(function* () {
    const submissions = yield* Submissions.Service;
    const address = yield* Actor.CurrentAddress;
    const orderId = address.entityId;

    // A bucket fault (an unreachable bucket, or a stored order that fails to
    // decode — impossible barring corruption, since orders are written from the
    // same schema) is a real DEFECT, not a domain outcome: die, exactly as the
    // bucket-authority layer treats a decode failure (`submissions.server.ts`).
    // This keeps the ops' typed failure channel to `SettleFailed` ALONE — the
    // only durable Failure the lifecycle models (the async-payment-failed
    // settlement). A genuinely-missing bucket order surfaces as `NotFound`,
    // likewise a defect here (there is nothing to anchor/settle/transition).
    const dieOnBucketFault = <A, R>(
      effect: Effect.Effect<A, StorageError | NotFound, R>,
    ): Effect.Effect<A, never, R> => effect.pipe(Effect.orDie);

    return Order.of({
      // `arm`: re-assert the bucket order exists (the bucket is the authority;
      // `arm` does NOT re-create the session). Idempotent — a duplicate `arm`
      // re-reads the same order (encore's primaryKey dedup also collapses a
      // verbatim re-`send`). A vanished bucket order is a defect (nothing to
      // anchor).
      arm: () =>
        dieOnBucketFault(
          submissions.getOrder(ORDER_FORM, orderId).pipe(Effect.asVoid),
        ),
      // `settle`: the settlement continuation. `outcome === 'paid'` (the absent
      // default, the common `checkout.session.completed` path) flips the bucket
      // to `paid` (idempotent `paidAt` freeze, read back FROM the bucket — never
      // the clock). `outcome === 'failed'` (the `async_payment_failed` path)
      // flips the bucket to `failed` (`Submissions.markOrderFailed`, preserving
      // the existing webhook behavior — no regression, Decision 7) and FAILS the
      // op with `SettleFailed`, so the durable reply is a Failure.
      settle: ({ operation }) =>
        (operation.outcome ?? 'paid') === 'failed' ?
          dieOnBucketFault(
            submissions.markOrderFailed(ORDER_FORM, orderId).pipe(Effect.asVoid),
          ).pipe(Effect.flatMap(() => new SettleFailed({ orderId })))
        : dieOnBucketFault(
            submissions.markOrderPaid(ORDER_FORM, orderId).pipe(Effect.asVoid),
          ),
      // `cancel` (`pending → cancelled`) / `expire` (`pending → expired`): the
      // operator-abandon and deadline-lapse terminals. Each is a pure bucket
      // flip; the `Submissions` helpers (G5) carry the never-downgrade-a-terminal
      // guard (only a `pending` order transitions), so a flip against a settled
      // order is a byte-identical no-op. G7 wires the SENDERS (the action/sweep)
      // that reach these; the bucket transition that IS the authority is here now.
      cancel: () =>
        dieOnBucketFault(
          submissions.markOrderCancelled(ORDER_FORM, orderId).pipe(Effect.asVoid),
        ),
      expire: () =>
        dieOnBucketFault(
          submissions.markOrderExpired(ORDER_FORM, orderId).pipe(Effect.asVoid),
        ),
      // `refund` (`paid → refunded`): the bucket transition (the authority) is
      // wired now; the additive Stripe refund call (`Payment.createRefund`) + the
      // `RefundNotAllowed` guard land in G7 BEFORE this flip. `markOrderRefunded`
      // (G5) already refuses to refund a non-`paid` order, so the flip alone is
      // safe — G7 only adds the money side and the typed pre-guard.
      refund: () =>
        dieOnBucketFault(
          submissions.markOrderRefunded(ORDER_FORM, orderId).pipe(Effect.asVoid),
        ),
    });
  }),
);
