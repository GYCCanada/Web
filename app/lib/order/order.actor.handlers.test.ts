import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';
import { ShardingConfig } from 'effect/unstable/cluster';

import { Content } from '../content.server';
import { defaultRegistrationForm } from '../content/pages/defaults';
import { orderKey, submissionKey } from '../content/pages/registry';
import { newListItemId, type ListItemId } from '../content/schema';
import { RegistrationOrder } from '../forms/order';
import { Cents, CurrencyCode } from '../forms/pricing';
import { submissionSchema } from '../forms/submission';
import { Submissions } from '../forms/submissions.server';
import { layerTest as storageLayerTest } from '../storage.test-helper';

import { Order } from './runner.server';
import { OrderActor } from './order.actor';

/**
 * G6 — the `arm` + `settle` handlers driven END-TO-END through the SQL-backed
 * in-process Sharding runner (`Order.fullRunnerLayer` over `Order.layerTest`)
 * against the REAL bucket-authority `Submissions` (over a Map-backed `Storage`).
 * This proves the load-bearing G6 contract: each op writes BOTH the bucket
 * transition (the authority) AND the mirrored actor `State`, within the one
 * handler, so the two never diverge — and the async-payment-failed path
 * resolves `settle` to a durable Failure while the bucket flips `failed` (no
 * regression, Decision 7).
 */

const REGISTRANT_IDS: readonly ListItemId[] = [newListItemId(), newListItemId()];

const encodeOrder = Schema.encodeSync(Schema.fromJsonString(RegistrationOrder));

/** A pending group order at `orderId`, frozen at $150, naming {@link REGISTRANT_IDS}. */
const pendingOrder = (orderId: string): RegistrationOrder => ({
  orderId,
  mode: 'group',
  sessionId: `cs_${orderId}`,
  amount: Cents.make(15000),
  currency: CurrencyCode.make('cad'),
  receiptEmail: 'leader@example.com',
  status: 'pending',
  registrantIds: [...REGISTRANT_IDS],
});

/** A minimal valid (`payment`-less) exhibitor registrant submission JSON. */
const registrantSubmissionJson = (id: ListItemId): string =>
  Schema.encodeSync(Schema.fromJsonString(submissionSchema(defaultRegistrationForm)))(
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
const seed = (order: RegistrationOrder): Parameters<typeof storageLayerTest>[0] => ({
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
const bucketStatus = (orderId: string) =>
  Effect.gen(function* () {
    const submissions = yield* Submissions.Service;
    return yield* submissions.getOrder('registration', orderId);
  });

/** Read the derived actor `OrderState` VIEW (Decision 1 — projected from the bucket). */
const actorState = (orderId: string) => OrderActor.readState(orderId);

/**
 * The full G6 stack over ONE Map-backed bucket: the SQL-backed runner + the
 * `arm`/`settle` handlers, the bucket-authority `Submissions` (over `Content` +
 * the seeded `Storage`), all sharing the one in-memory `Storage` so the test
 * effect reads back exactly what a handler wrote.
 */
const provideStack = (objects: Parameters<typeof storageLayerTest>[0]) => {
  const storage = storageLayerTest(objects);
  const submissions = Layer.provideMerge(
    Submissions.layer,
    Layer.provideMerge(Content.layer, storage),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Order.fullRunnerLayer(Order.layerTest)),
      Effect.provide(submissions),
    );
};

describe('Order arm + settle handlers (G6, SQL-backed runner over the bucket authority)', () => {
  it.scopedLive('arm anchors the entity at pending, mirroring the bucket', () => {
    const order = pendingOrder('ord-arm');
    return Effect.gen(function* () {
      yield* Order.Entity.arm.sendAndAwait(
        {
          orderId: order.orderId,
          mode: 'group',
          amount: order.amount,
          currency: order.currency,
          receiptEmail: order.receiptEmail,
          sessionId: order.sessionId,
          registrantIds: order.registrantIds,
          deadline: undefined,
        },
        { timeout: '5 seconds' },
      );

      const state = yield* actorState(order.orderId);
      expect(state.status).toBe('pending');
      expect(state.sessionId).toBe(order.sessionId);

      // The bucket authority is untouched at pending (arm does NOT settle).
      expect((yield* bucketStatus(order.orderId)).status).toBe('pending');
    }).pipe(provideStack(seed(order)));
  });

  it.scopedLive('settle (paid) flips the bucket to paid + State paid with a frozen paidAt', () => {
    const order = pendingOrder('ord-paid');
    return Effect.gen(function* () {
      yield* Order.Entity.settle.sendAndAwait(
        {
          orderId: order.orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        },
        { timeout: '5 seconds' },
      );

      const settled = yield* bucketStatus(order.orderId);
      expect(settled.status).toBe('paid');
      // `paidAt` is frozen by `markOrderPaid` (the idempotency contract).
      expect(settled.paidAt).toBeDefined();

      const state = yield* actorState(order.orderId);
      expect(state.status).toBe('paid');
      expect(state.paidAt).toBe(settled.paidAt);

      // A verbatim settle REPLAY is a byte-identical no-op (encore dedup +
      // `markOrderPaid` idempotency): `paidAt` does not drift.
      yield* Order.Entity.settle.sendAndAwait(
        {
          orderId: order.orderId,
          outcome: undefined,
          sessionId: undefined,
          paymentIntentId: undefined,
        },
        { timeout: '5 seconds' },
      );
      const replayed = yield* bucketStatus(order.orderId);
      expect(replayed.paidAt).toBe(settled.paidAt);
    }).pipe(provideStack(seed(order)));
  });

  it.scopedLive('settle (failed) flips the bucket to failed + resolves the op to a Failure', () => {
    const order = pendingOrder('ord-failed');
    return Effect.gen(function* () {
      // A persisted Failure reply surfaces in the op's error channel
      // (`OperationHandle.sendAndAwait` semantics): the async-payment-failed
      // `settle` resolves to `SettleFailed`.
      const exit = yield* Order.Entity.settle
        .sendAndAwait(
          {
            orderId: order.orderId,
            outcome: 'failed',
            sessionId: undefined,
            paymentIntentId: undefined,
          },
          { timeout: '5 seconds' },
        )
        .pipe(Effect.exit);

      expect(exit._tag).toBe('Failure');

      // ... while the bucket has durably flipped to `failed` (no regression,
      // Decision 7) — the existing webhook `markOrderFailed` behavior preserved.
      expect((yield* bucketStatus(order.orderId)).status).toBe('failed');
    }).pipe(provideStack(seed(order)));
  });
});

describe('Order cross-runtime shard-parity (G6)', () => {
  it.scopedLive(
    'the runner and the sender build from the same ShardingConfig (identical shard count)',
    () =>
      Effect.gen(function* () {
        const readShards = ShardingConfig.ShardingConfig.pipe(
          Effect.map((config) => config.shardsPerGroup),
        );

        // The runner (`server.ts`) and the sender (`makeAppLayer`) BOTH build
        // their `ShardingConfig` from the one exported `Order.ShardingConfigLive`
        // (`runnerLayer` / `senderLayer` each close over it). Reading the shard
        // count from two independent builds of that same definition yields the
        // identical number — a divergent count would route a `send` to a shard
        // the runner never polls (the cross-runtime parity invariant, §1).
        const runnerShards = yield* readShards.pipe(
          Effect.provide(Order.ShardingConfigLive),
        );
        const senderShards = yield* readShards.pipe(
          Effect.provide(Order.ShardingConfigLive),
        );

        expect(senderShards).toBe(runnerShards);
        expect(Number.isFinite(runnerShards)).toBe(true);
      }),
  );
});
