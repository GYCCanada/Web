import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';

import { Content } from '../content.server';
import { defaultRegistrationForm } from '../content/pages/defaults';
import { orderKey, submissionKey } from '../content/pages/registry';
import { newListItemId, type ListItemId } from '../content/schema';
import { RegistrationOrder } from '../forms/order';
import { Payment } from '../payment.server';
import { Cents, CurrencyCode } from '../forms/pricing';
import { submissionSchema } from '../forms/submission';
import { Submissions } from '../forms/submissions.server';
import { layerTest as storageLayerTest } from '../storage.test-helper';

import { Order } from './runner.server';
import { OrderActor } from './order.actor';

/**
 * G9 — the durable-lifecycle CAPSTONE. End-to-end over the REAL
 * `Order.MessageStorageLive`-shaped SQL runner (`Order.layerTest`, SQLite
 * `:memory:`) + a network-free `Payment.testLayer`, exercising EVERY edge of the
 * Order state machine as one durable narrative against the bucket authority:
 *
 *   - `pending → paid`       (settle, the webhook-resolved continuation)
 *   - `pending → cancelled`  (cancel, operator/abandon)
 *   - `paid → refunded`      (refund, the Stripe-refund terminal)
 *   - `pending → expired`    (expire, the deadline sweep)
 *   - the ILLEGAL transitions, all rejected by the handlers' State guards:
 *       refund-while-pending, expire-while-paid, cancel-while-paid.
 *
 * And the THREE cross-cutting invariants:
 *
 *   1. the `settle` ExecId is STABLE across a replay, so `paidAt` is
 *      byte-identical (the idempotency contract, `order.ts` / `c8c4abd`);
 *   2. the FROZEN `amount` / `receiptEmail` are never re-derived by any op (read
 *      back from the bucket, compared to the create-time freeze);
 *   3. the actor State and the bucket `RegistrationOrder.status` NEVER diverge —
 *      every transition writes both within the one handler (Decision 1).
 */

const REGISTRANT_IDS: readonly ListItemId[] = [newListItemId(), newListItemId()];

const encodeOrder = Schema.encodeSync(Schema.fromJsonString(RegistrationOrder));

/** The FROZEN amount + receipt every order in this suite is minted with. */
const FROZEN_AMOUNT = Cents.make(15000);
const FROZEN_RECEIPT = 'leader@example.com';

/** A pending group order at `orderId`, frozen at $150, naming {@link REGISTRANT_IDS}. */
const pendingOrder = (orderId: string): RegistrationOrder => ({
  orderId,
  mode: 'group',
  sessionId: `cs_${orderId}`,
  amount: FROZEN_AMOUNT,
  currency: CurrencyCode.make('cad'),
  receiptEmail: FROZEN_RECEIPT,
  status: 'pending',
  registrantIds: [...REGISTRANT_IDS],
});

/** A minimal valid (`payment`-less) exhibitor registrant submission JSON. */
const registrantSubmissionJson = (id: ListItemId): string =>
  Schema.encodeSync(
    Schema.fromJsonString(submissionSchema(defaultRegistrationForm)),
  )(
    Schema.decodeUnknownSync(submissionSchema(defaultRegistrationForm))({
      id,
      form: 'registration',
      submittedAt: '2026-06-17',
      payload: {
        name: 'Ada Co',
        phone: '123-456-7890',
        type: 'exhibitor',
        synopsis: 'We sell books',
        website: 'https://example.com',
        company: 'Ada Books',
      },
    }),
  );

/** Seed one pending order under its `orderKey` ALONGSIDE the registrants it names. */
const seed = (
  order: RegistrationOrder,
): Parameters<typeof storageLayerTest>[0] => ({
  [orderKey('registration', order.orderId)]: {
    body: encodeOrder(order),
    contentType: 'application/json',
  },
  ...Object.fromEntries(
    order.registrantIds.map((id) => [
      submissionKey('registration', id),
      { body: registrantSubmissionJson(id), contentType: 'application/json' },
    ]),
  ),
});

/** Read the on-bucket order (the durable authority). */
const bucketOrder = (orderId: string) =>
  Effect.gen(function* () {
    const submissions = yield* Submissions.Service;
    return yield* submissions.getOrder('registration', orderId);
  });

/**
 * Assert invariants 2 + 3 for `orderId` at an expected status: the actor State
 * and the bucket status agree (never diverge), and the frozen amount/receipt are
 * intact (never re-derived). Returns the bucket order for further assertions.
 */
// The expected status is one of the FIVE actor-visible states (the derived
// `OrderState` view never carries the bucket-only `failed`); every transition in
// this suite lands on one of them, so both the bucket status AND the State agree.
const assertCoherent = (orderId: string, status: OrderActor.OrderStatus) =>
  Effect.gen(function* () {
    const order = yield* bucketOrder(orderId);
    const state = yield* OrderActor.readState(orderId);
    // Invariant 3: State ↔ bucket never diverge.
    expect(order.status).toBe(status);
    expect(state.status).toBe(status);
    // Invariant 2: the freeze is intact across every transition.
    expect(order.amount).toBe(FROZEN_AMOUNT);
    expect(order.receiptEmail).toBe(FROZEN_RECEIPT);
    return order;
  });

/** The full durable stack: SQL runner + the `arm`/.../`refund` handlers + bucket authority. */
const provideStack = (
  order: RegistrationOrder,
  paymentLayer: Layer.Layer<Payment.Service> = Payment.testLayer(),
) => {
  const storage = storageLayerTest(seed(order));
  const submissions = Layer.provideMerge(
    Submissions.layer,
    Layer.provideMerge(Content.layer, storage),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Order.fullRunnerLayer(Order.layerTest)),
      Effect.provide(submissions),
      Effect.provide(paymentLayer),
    );
};

const settlePaid = (orderId: string) =>
  Order.Entity.settle.sendAndAwait(
    { orderId, outcome: undefined, sessionId: undefined, paymentIntentId: undefined },
    { timeout: '5 seconds' },
  );

describe('Order durable lifecycle capstone (G9)', () => {
  it.scopedLive(
    'pending → paid (settle): ExecId stable across replay, paidAt byte-identical, State/bucket coherent',
    () => {
      const order = pendingOrder('ord-paid');
      return Effect.gen(function* () {
        // Invariant 1, part A: the action-side full payload and the
        // webhook-side `{ orderId }`-only payload derive the SAME ExecId (Decision
        // 4 — `id` ignores every field but `orderId`).
        const actionExecId = yield* Order.Entity.settle.executionId({
          orderId: order.orderId,
          outcome: 'paid',
          sessionId: order.sessionId,
          paymentIntentId: 'pi_x',
        });
        const webhookExecId = yield* Order.Entity.settle.executionId({
          orderId: order.orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        });
        expect(String(actionExecId)).toBe(String(webhookExecId));

        yield* Order.Entity.arm.sendAndAwait(
          {
            orderId: order.orderId,
            mode: order.mode,
            amount: order.amount,
            currency: order.currency,
            receiptEmail: order.receiptEmail,
            sessionId: order.sessionId,
            registrantIds: order.registrantIds,
            deadline: undefined,
          },
          { timeout: '5 seconds' },
        );
        yield* assertCoherent(order.orderId, 'pending');

        yield* settlePaid(order.orderId);
        const paid = yield* assertCoherent(order.orderId, 'paid');
        expect(paid.paidAt).toBeDefined();
        const firstPaidAt = paid.paidAt;

        // Invariant 1, part B: a verbatim REPLAY re-resolves the same ExecId to a
        // no-op (encore dedup + `markOrderPaid` idempotency) — `paidAt` does not
        // drift.
        yield* settlePaid(order.orderId);
        const replayed = yield* bucketOrder(order.orderId);
        expect(replayed.paidAt).toBe(firstPaidAt);
      }).pipe(provideStack(order));
    },
  );

  it.scopedLive('pending → cancelled (cancel): State/bucket coherent', () => {
    const order = pendingOrder('ord-cancelled');
    return Effect.gen(function* () {
      yield* Order.Entity.cancel.sendAndAwait(
        { orderId: order.orderId },
        { timeout: '5 seconds' },
      );
      yield* assertCoherent(order.orderId, 'cancelled');
    }).pipe(provideStack(order));
  });

  it.scopedLive(
    'paid → refunded (refund): Stripe refund against the FROZEN amount, State/bucket coherent',
    () => {
      const order = pendingOrder('ord-refunded');
      const refundCalls: Array<Payment.CreateRefundCall> = [];
      return Effect.gen(function* () {
        // Drive it to `paid` first (the only refundable source), then refund.
        yield* settlePaid(order.orderId);
        yield* assertCoherent(order.orderId, 'paid');

        yield* Order.Entity.refund.sendAndAwait(
          { orderId: order.orderId },
          { timeout: '5 seconds' },
        );

        // The Stripe refund was issued ONCE, against the order's session + its
        // FROZEN amount (never re-derived), keyed deterministically.
        expect(refundCalls.length).toBe(1);
        expect(refundCalls[0]?.amount).toBe(FROZEN_AMOUNT);
        expect(refundCalls[0]?.sessionId).toBe(order.sessionId);
        expect(refundCalls[0]?.idempotencyKey).toBe(
          `registration:refund:${order.orderId}`,
        );

        yield* assertCoherent(order.orderId, 'refunded');
      }).pipe(provideStack(order, Payment.testLayer({ refundCalls })));
    },
  );

  it.scopedLive('pending → expired (expire): State/bucket coherent', () => {
    const order = pendingOrder('ord-expired');
    return Effect.gen(function* () {
      yield* Order.Entity.expire.sendAndAwait(
        { orderId: order.orderId },
        { timeout: '5 seconds' },
      );
      yield* assertCoherent(order.orderId, 'expired');
    }).pipe(provideStack(order));
  });

  it.scopedLive(
    'ILLEGAL: refund-while-pending is rejected (RefundNotAllowed), no Stripe call, order untouched',
    () => {
      const order = pendingOrder('ord-illegal-refund');
      const refundCalls: Array<Payment.CreateRefundCall> = [];
      return Effect.gen(function* () {
        const exit = yield* Order.Entity.refund
          .sendAndAwait({ orderId: order.orderId }, { timeout: '5 seconds' })
          .pipe(Effect.exit);
        expect(exit._tag).toBe('Failure');
        expect(refundCalls.length).toBe(0);
        // The order is left UNTOUCHED at pending (State + bucket coherent).
        yield* assertCoherent(order.orderId, 'pending');
      }).pipe(provideStack(order, Payment.testLayer({ refundCalls })));
    },
  );

  it.scopedLive(
    'ILLEGAL: expire-while-paid is a no-op (a settled order is never swept)',
    () => {
      const order = pendingOrder('ord-illegal-expire');
      return Effect.gen(function* () {
        yield* settlePaid(order.orderId);
        yield* assertCoherent(order.orderId, 'paid');

        // `expire` against a `paid` order — `markOrderExpired`'s never-downgrade
        // guard leaves it paid (the State guard, make-impossible-states).
        yield* Order.Entity.expire.sendAndAwait(
          { orderId: order.orderId },
          { timeout: '5 seconds' },
        );
        yield* assertCoherent(order.orderId, 'paid');
      }).pipe(provideStack(order));
    },
  );

  it.scopedLive(
    'ILLEGAL: cancel-while-paid is a no-op (the never-downgrade guard)',
    () => {
      const order = pendingOrder('ord-illegal-cancel');
      return Effect.gen(function* () {
        yield* settlePaid(order.orderId);
        yield* assertCoherent(order.orderId, 'paid');

        yield* Order.Entity.cancel.sendAndAwait(
          { orderId: order.orderId },
          { timeout: '5 seconds' },
        );
        yield* assertCoherent(order.orderId, 'paid');
      }).pipe(provideStack(order));
    },
  );

  it.scopedLive(
    'LATE-PAYMENT-ON-EXPIRED (Open Q4): a paid settle AFTER expire does NOT resurrect to paid',
    () => {
      const order = pendingOrder('ord-late-paid');
      return Effect.gen(function* () {
        // The deadline sweep expires the order first ...
        yield* Order.Entity.expire.sendAndAwait(
          { orderId: order.orderId },
          { timeout: '5 seconds' },
        );
        yield* assertCoherent(order.orderId, 'expired');

        // ... then a LATE `checkout.session.completed` resolves `settle` (paid).
        // The reject-and-log guard leaves the order TERMINAL at `expired` — it is
        // NOT silently resurrected to `paid` (the plan default; honor-vs-auto-
        // refund is a product decision, see flags). The op still resolves Success
        // (a no-op), so a sender's `waitFor` terminates cleanly.
        yield* settlePaid(order.orderId);
        yield* assertCoherent(order.orderId, 'expired');
      }).pipe(provideStack(order));
    },
  );
});
