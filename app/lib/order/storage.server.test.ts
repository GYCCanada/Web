import { describe, expect, it } from 'effect-bun-test';
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Schema,
} from 'effect';
import { Snowflake } from 'effect/unstable/cluster';
import { SqlClient } from 'effect/unstable/sql';

import { fromSqlClient, EncoreMessageStorage } from 'effect-encore';
import { SqliteClient } from '@effect/sql-sqlite-bun';

import { Env } from '../env.server';
import { Order } from './storage.server';

/**
 * A single in-memory SQL graph that exposes BOTH `SqlClient` (so the test can
 * read `sqlite_master`) and encore's `MessageStorage` / `EncoreMessageStorage`
 * over the same DB. `Order.layerTest` deliberately consumes its SqliteClient
 * internally (the production shape), so for the table-inspection assertion we
 * compose an equivalent graph that keeps `SqlClient` in context.
 */
const sqliteMemory = SqliteClient.layer({ filename: ':memory:' });
const storageOverMemory = Layer.provideMerge(fromSqlClient(), sqliteMemory);

/**
 * G2 — proves encore's SQL `MessageStorage` adapter (`fromSqlClient`) boots and
 * round-trips inside GYC's effect/bun toolchain. This is the core version-skew
 * de-risk: the encore cluster storage is being stood up in GYC for the first
 * time, against the bumped `effect@beta.75` + `@effect/sql-sqlite-bun`. The
 * tables it creates (`cluster_messages` / `cluster_replies`) are the durable
 * seam the two-runtime topology (runner ↔ senders) coordinates through.
 */
describe('Order.layerTest (encore SQL MessageStorage over :memory:)', () => {
  it.effect('creates cluster_messages/cluster_replies tables on boot', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('cluster_messages', 'cluster_replies')
        ORDER BY name
      `;
      expect(rows.map((row) => row.name)).toEqual([
        'cluster_messages',
        'cluster_replies',
      ]);
    }).pipe(Effect.provide(storageOverMemory)));

  it.effect("round-trips encore's deleteEnvelope against the real tables", () =>
    Effect.gen(function* () {
      const storage = yield* EncoreMessageStorage;
      // deleteEnvelope wraps a two-statement transaction over both encore
      // tables; running it (a no-op on an absent request id) proves the encore
      // extension reaches the real SQL tables through GYC's toolchain without
      // failing — the durability-path smoke check.
      yield* storage.deleteEnvelope(Snowflake.Snowflake('1'));
    }).pipe(Effect.provide(Order.layerTest)));
});

const envFrom = (env: Record<string, string>) =>
  Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

describe('Order.SqlClientLive', () => {
  it.effect('fails with DatabaseUnconfigured when no DATABASE_URL is set', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        SqlClient.SqlClient.pipe(
          Effect.provide(
            Order.SqlClientLive.pipe(
              Layer.provide(envFrom({ NODE_ENV: 'development' })),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const unconfigured = exit.cause.reasons.some(
          (reason) =>
            reason._tag === 'Fail' &&
            Schema.is(Order.DatabaseUnconfigured)(reason.error),
        );
        expect(unconfigured).toBe(true);
      }
    }));

  it.effect('builds a SqlClient when DATABASE_URL is configured', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        SqlClient.SqlClient.pipe(
          Effect.provide(
            Order.SqlClientLive.pipe(
              Layer.provide(
                envFrom({
                  NODE_ENV: 'development',
                  DATABASE_URL: ':memory:',
                }),
              ),
            ),
          ),
        ),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }));
});
