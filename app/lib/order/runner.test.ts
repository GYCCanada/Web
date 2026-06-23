import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql';

import { Actor, makeExecId, isSuccess, fromSqlClient } from 'effect-encore';
import { SqliteClient } from '@effect/sql-sqlite-bun';

import { Order } from './runner.server';

/**
 * G3 — CONFIDENCE probe. A throwaway entity proving the new DB dependency + the
 * SQL-backed in-process Sharding **runner** + the per-op send/await/ExecId
 * resolution all work inside GYC's effect/bun toolchain, BEFORE any Order
 * semantics exist. This establishes the production runner composition (which
 * encore only ships in its own tests) — exactly why it is front-loaded.
 *
 * The probe wires the FULL `Order.runnerLayer` over the REAL SQL `MessageStorage`
 * (`Order.layerTest`, `:memory:`) — NOT `TestRunner.layer` (which carries its own
 * memory storage). The point is to prove the REAL SQL mailbox path: the runner
 * consumes the SQL-backed mailbox, runs the handler, and writes the durable
 * reply into `cluster_replies`.
 */

const OrderProbe = Actor.fromEntity('OrderProbe', {
  Ping: {
    payload: { key: Schema.String, extra: Schema.String },
    success: Schema.String,
    persisted: true,
    // The Decision-4 id rule: a PURE STRING fn of ONE field (`key`), so
    // `resolveId` sets entityId === primaryKey === key and the ExecId ignores
    // every other payload field — the property the webhook relies on (it holds
    // only `metadata.orderId`).
    id: (p: { key: string }) => p.key,
  },
});

const probeHandlers = Actor.toLayer(OrderProbe, {
  Ping: ({ operation }) => Effect.succeed(`pong: ${operation.key}`),
});

/**
 * A runner over a SQL `MessageStorage` that ALSO leaks `SqlClient` into context
 * (via `provideMerge` of the SqliteClient) so the durability assertion can read
 * the very same `:memory:` DB the runner persisted into — `Order.layerTest`
 * consumes its SqliteClient internally, so a separate `SqlClient` build would be
 * a DISJOINT in-memory DB.
 */
const storageLeakingSql = fromSqlClient().pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
);

describe('Order runner (SQL-backed in-process Sharding runner)', () => {
  it.scopedLive(
    'sendAndAwait reaches Success, landing rows in cluster_messages/cluster_replies',
    () =>
      Effect.gen(function* () {
        const value = yield* OrderProbe.Ping.sendAndAwait(
          { key: 'alpha', extra: 'x' },
          { timeout: '5 seconds' },
        );
        expect(value).toBe('pong: alpha');

        // Durability proof: the runner persisted the request + reply through the
        // REAL SQL MessageStorage (not an in-memory shortcut).
        const sql = yield* SqlClient.SqlClient;
        const messages = yield* sql<{ readonly n: number }>`
          SELECT COUNT(*) AS n FROM cluster_messages
        `;
        const replies = yield* sql<{ readonly n: number }>`
          SELECT COUNT(*) AS n FROM cluster_replies
        `;
        expect(Number(messages[0]?.n ?? 0)).toBeGreaterThan(0);
        expect(Number(replies[0]?.n ?? 0)).toBeGreaterThan(0);
      }).pipe(
        Effect.provide(probeHandlers),
        Effect.provide(Order.runnerLayer(storageLeakingSql)),
      ),
  );

  it.scopedLive(
    'the webhook-shaped ExecId path: executionId ignores the rest of the payload, waitFor sees the terminal reply',
    () =>
      Effect.gen(function* () {
        const key = 'beta';

        // Decision 4: the action side and the webhook side carry DIFFERENT
        // non-key fields (the webhook reconstructs a payload from only
        // `metadata.orderId` + the Stripe session, so its `extra` differs from
        // the action's), yet both derive the SAME ExecId — because `id` is a
        // pure fn of `key` and ignores every other field. Both also equal the
        // manually formatted `entityId\x00tag\x00primaryKey` string.
        const actionSide = yield* OrderProbe.Ping.executionId({
          key,
          extra: 'action-payload',
        });
        const webhookSide = yield* OrderProbe.Ping.executionId({
          key,
          extra: 'webhook-payload',
        });
        const manual = makeExecId(`${key}\x00Ping\x00${key}`);
        expect(String(actionSide)).toBe(String(webhookSide));
        expect(String(actionSide)).toBe(String(manual));

        // Dispatch with the action-shaped payload ...
        yield* OrderProbe.Ping.send({ key, extra: 'action-payload' });

        // ... and resolve from the webhook-shaped payload (different `extra`),
        // through the SAME SQL MessageStorage, with no bespoke adapter — the
        // `{ key }`-derived ExecId lands on the runner's reply.
        const result = yield* OrderProbe.Ping.waitFor(
          { key, extra: 'webhook-payload' },
          { filter: (r) => isSuccess(r) },
        );
        expect(result._tag).toBe('Success');
        if (isSuccess(result)) {
          expect(result.value).toBe('pong: beta');
        }
      }).pipe(
        Effect.provide(probeHandlers),
        Effect.provide(Order.runnerLayer(Order.layerTest)),
      ),
  );
});
