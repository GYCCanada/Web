import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';

import { Content } from '../content.server';
import { defaultRegistrationForm } from '../content/pages/defaults';
import { orderKey, submissionKey } from '../content/pages/registry';
import { IsoDate, newListItemId, type ListItemId } from '../content/schema';
import { RegistrationOrder } from '../forms/order';
import { Payment } from '../payment.server';
import { Cents, CurrencyCode } from '../forms/pricing';
import { submissionSchema } from '../forms/submission';
import { Submissions } from '../forms/submissions.server';
import { layerTest as storageLayerTest } from '../storage.test-helper';
import { isTerminal } from 'effect-encore';

import { Order } from './runner.server';
import { OrderActor } from './order.actor';
import { OrderSweep } from './sweep.server';

/**
 * G9 — the deadline SWEEP, driven END-TO-END through the SQL-backed in-process
 * runner (`Order.fullRunnerLayer` over `Order.layerTest`) against the REAL
 * bucket-authority `Submissions`. The sweep lists the form's orders, filters to
 * the pending-AND-past-deadline ones, and `send`s `Order.expire` to each — the
 * runner consumes each send and flips the bucket `pending → expired`.
 *
 * The load-bearing assertion: a PAST-deadline PENDING order is swept to
 * `expired`, while a FUTURE-deadline pending order AND a PAST-deadline PAID
 * order are BOTH left untouched (the filter pre-screens; the `markOrderExpired`
 * never-downgrade guard is the second line). A second sweep is a no-op.
 *
 * Deadlines are anchored to real far-past / far-future calendar dates so the
 * LIVE clock (`scopedLive`) decides "due" deterministically without a TestClock.
 */

const REGISTRANT_IDS: readonly ListItemId[] = [newListItemId(), newListItemId()];

const encodeOrder = Schema.encodeSync(Schema.fromJsonString(RegistrationOrder));

/** A far-past deadline (always strictly before today) and a far-future one. */
const PAST_DEADLINE = IsoDate.make('2020-01-01');
const FUTURE_DEADLINE = IsoDate.make('2999-01-01');

interface OrderSpec {
  readonly orderId: string;
  readonly status: RegistrationOrder['status'];
  readonly deadline?: IsoDate;
}

/** Build a `RegistrationOrder` at a given status + optional deadline. */
const makeOrder = (spec: OrderSpec): RegistrationOrder => ({
  orderId: spec.orderId,
  mode: 'group',
  sessionId: `cs_${spec.orderId}`,
  amount: Cents.make(15000),
  currency: CurrencyCode.make('cad'),
  receiptEmail: 'leader@example.com',
  status: spec.status,
  registrantIds: [...REGISTRANT_IDS],
  ...(spec.deadline === undefined ? {} : { deadline: spec.deadline }),
  ...(spec.status === 'paid' ? { paidAt: IsoDate.make('2026-06-20') } : {}),
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

/** Seed each order under its `orderKey` ALONGSIDE the registrants it names. */
const seed = (
  orders: readonly RegistrationOrder[],
): Parameters<typeof storageLayerTest>[0] => {
  const objects: Parameters<typeof storageLayerTest>[0] = {};
  for (const order of orders) {
    objects[orderKey('registration', order.orderId)] = {
      body: encodeOrder(order),
      contentType: 'application/json',
    };
  }
  // One shared set of registrant submissions (every order names the same ids;
  // the flip re-stamps them idempotently).
  for (const id of REGISTRANT_IDS) {
    objects[submissionKey('registration', id)] = {
      body: registrantSubmissionJson(id),
      contentType: 'application/json',
    };
  }
  return objects;
};

/** Read the on-bucket order status (the durable authority). */
const bucketStatus = (orderId: string) =>
  Effect.gen(function* () {
    const submissions = yield* Submissions.Service;
    return (yield* submissions.getOrder('registration', orderId)).status;
  });

/** Await the runner consuming the sweep's fire-and-forget `expire` send. */
const awaitExpire = (orderId: string) =>
  Order.Entity.expire
    .waitFor({ orderId }, { filter: (result) => isTerminal(result) })
    .pipe(Effect.timeout('5 seconds'), Effect.asVoid);

/** The full G9 stack over ONE Map-backed bucket: SQL runner + bucket authority. */
const provideStack = (orders: readonly RegistrationOrder[]) => {
  const storage = storageLayerTest(seed(orders));
  const submissions = Layer.provideMerge(
    Submissions.layer,
    Layer.provideMerge(Content.layer, storage),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Order.fullRunnerLayer(Order.layerTest)),
      Effect.provide(submissions),
      Effect.provide(Payment.testLayer()),
    );
};

describe('Order deadline sweep (G9, SQL-backed runner over the bucket authority)', () => {
  it.scopedLive(
    'sweeps ONLY the past-deadline PENDING order; future-deadline + paid are untouched; second sweep is a no-op',
    () => {
      const pastPending = makeOrder({
        orderId: 'ord-past-pending',
        status: 'pending',
        deadline: PAST_DEADLINE,
      });
      const futurePending = makeOrder({
        orderId: 'ord-future-pending',
        status: 'pending',
        deadline: FUTURE_DEADLINE,
      });
      const pastPaid = makeOrder({
        orderId: 'ord-past-paid',
        status: 'paid',
        deadline: PAST_DEADLINE,
      });
      const orders = [pastPending, futurePending, pastPaid];

      return Effect.gen(function* () {
        // (1) One sweep pass: it dispatches `expire` ONLY for the past-deadline
        // pending order — the filter screens out the future-deadline pending one
        // AND the past-deadline PAID one.
        const dispatched = yield* OrderSweep.runOnce;
        expect(dispatched).toEqual([pastPending.orderId]);

        // Await the runner consuming the fire-and-forget send.
        yield* awaitExpire(pastPending.orderId);

        // (2) The past-deadline pending order flipped to `expired` (bucket + the
        // derived State); the other two are untouched.
        expect(yield* bucketStatus(pastPending.orderId)).toBe('expired');
        expect(
          (yield* OrderActor.readState(pastPending.orderId)).status,
        ).toBe('expired');
        expect(yield* bucketStatus(futurePending.orderId)).toBe('pending');
        expect(yield* bucketStatus(pastPaid.orderId)).toBe('paid');

        // (3) A SECOND sweep dispatches NOTHING (the only past-deadline order is
        // now `expired`, no longer `pending`) — idempotent.
        const second = yield* OrderSweep.runOnce;
        expect(second).toEqual([]);
        expect(yield* bucketStatus(pastPending.orderId)).toBe('expired');
      }).pipe(provideStack(orders));
    },
  );

  it.scopedLive(
    'a deadline-less pending order is NEVER swept (no registrationDeadline configured)',
    () => {
      const noDeadline = makeOrder({
        orderId: 'ord-no-deadline',
        status: 'pending',
      });
      return Effect.gen(function* () {
        const dispatched = yield* OrderSweep.runOnce;
        expect(dispatched).toEqual([]);
        expect(yield* bucketStatus(noDeadline.orderId)).toBe('pending');
      }).pipe(provideStack([noDeadline]));
    },
  );
});
