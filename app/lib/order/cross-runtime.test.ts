import { tmpdir } from 'node:os';

import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';

import { Actor, isSuccess, fromSqlClient } from 'effect-encore';
import { SqliteClient } from '@effect/sql-sqlite-bun';

import { Order } from './runner.server';

/**
 * G3 — the BLOCKER test (cross-review mustFix). The ONLY test that exercises the
 * REAL two-runtime topology: a RUNNER graph (the `ServerLive` analog — consumes
 * the mailbox, runs handlers, writes replies) and a SENDER graph (the
 * `AppRuntime` analog — the registration action / Stripe webhook side) built as
 * SEPARATE layer graphs with SEPARATE `SqlClient` builds.
 *
 * The two graphs coordinate the durable Order lifecycle ONLY through the shared
 * `cluster_messages` / `cluster_replies` rows — which means ONLY if both point
 * at the SAME sqlite FILE. The positive case proves a sender-graph `send` is
 * consumed by the runner-graph handler and a SECOND independent sender's `peek`
 * sees it terminal over the shared file.
 *
 * The negative control repeats the same orchestration with `':memory:'` on each
 * graph and proves the send is NOT observed cross-graph — the two-disjoint-DBs
 * failure mode the whole topology hinges on. It is kept permanently so a future
 * `':memory:'` regression (which would silently break the production
 * route → runner → webhook loop) is caught by the suite.
 */

const ProbeEntity = Actor.fromEntity('CrossRuntimeProbe', {
  Ping: {
    payload: { key: Schema.String },
    success: Schema.String,
    persisted: true,
    id: (p: { key: string }) => p.key,
  },
});

const probeHandlers = Actor.toLayer(ProbeEntity, {
  Ping: ({ operation }) => Effect.succeed(`pong: ${operation.key}`),
});

const storageOver = (filename: string) =>
  fromSqlClient().pipe(
    Layer.provide(SqliteClient.layer({ filename })),
  );

/** A long-lived runner ManagedRuntime over `filename` (the `ServerLive` analog). */
const acquireRunner = (filename: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        probeHandlers.pipe(
          Layer.provideMerge(Order.runnerLayer(storageOver(filename))),
        ),
      ),
    ),
    (rt) => Effect.promise(() => rt.dispose()),
  );

/** A sender ManagedRuntime over `filename` (the `AppRuntime` analog). */
const acquireSender = (filename: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(Order.senderLayer(storageOver(filename))),
    ),
    (rt) => Effect.promise(() => rt.dispose()),
  );

const tmpFile = (suffix: string) =>
  `${tmpdir()}/gyc-order-cross-runtime-${process.pid}-${Date.now()}-${suffix}.sqlite`;

describe('Order cross-runtime topology (the production seam)', () => {
  it.scopedLive(
    'a sender-graph send is consumed by the runner-graph handler over ONE shared sqlite FILE',
    () =>
      Effect.gen(function* () {
        const file = tmpFile('positive');

        // The runner graph (ServerLive analog) must be live BEFORE the send so
        // its mailbox-poll fiber is consuming the shared file.
        const runner = yield* acquireRunner(file);
        // Boot the runner graph (force the Sharding poll fiber to start).
        yield* Effect.promise(() => runner.runPromise(Effect.void));

        // Sender graph 1 (the registration-action analog): enqueue the op.
        const sender1 = yield* acquireSender(file);
        yield* Effect.promise(() =>
          sender1.runPromise(ProbeEntity.Ping.send({ key: 'shared' })),
        );

        // Sender graph 2 — a SEPARATE sender build (the webhook analog, distinct
        // SqlClient) over the SAME file — observes the reply the runner wrote.
        const sender2 = yield* acquireSender(file);
        const result = yield* Effect.promise(() =>
          sender2.runPromise(
            ProbeEntity.Ping.waitFor(
              { key: 'shared' },
              { filter: (r) => isSuccess(r) },
            ),
          ),
        );

        expect(result._tag).toBe('Success');
        if (isSuccess(result)) {
          expect(result.value).toBe('pong: shared');
        }
      }),
  );

  it.scopedLive(
    'NEGATIVE CONTROL: :memory: gives each graph a DISJOINT DB so the send is NOT observed cross-graph',
    () =>
      Effect.gen(function* () {
        // Each ManagedRuntime over ':memory:' builds its OWN in-memory DB — the
        // runner and the sender share NO rows, so the runner never sees the send
        // and the sender never sees a reply. This is exactly why production MUST
        // use a shared FILE.
        const runner = yield* acquireRunner(':memory:');
        yield* Effect.promise(() => runner.runPromise(Effect.void));

        const sender1 = yield* acquireSender(':memory:');
        yield* Effect.promise(() =>
          sender1.runPromise(ProbeEntity.Ping.send({ key: 'isolated' })),
        );

        const sender2 = yield* acquireSender(':memory:');
        const result = yield* Effect.promise(() =>
          sender2.runPromise(ProbeEntity.Ping.peek({ key: 'isolated' })),
        );

        // sender2's disjoint in-memory DB never saw the send → Pending, never
        // Success. Proves the seam: cross-runtime coordination REQUIRES the
        // shared file.
        expect(result._tag).toBe('Pending');
      }),
  );
});
