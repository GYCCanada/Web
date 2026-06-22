export * as Order from './storage.server';

import { fromSqlClient } from 'effect-encore';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import { ShardingConfig } from 'effect/unstable/cluster';
import { SqlClient } from 'effect/unstable/sql';

import { SqliteClient } from '@effect/sql-sqlite-bun';

import { Env } from '../env.server';

/**
 * Durable Order workflow storage — encore's SQL `MessageStorage` stood up over
 * the optional `DATABASE_URL` sqlite database. This is the first time GYC backs
 * onto encore's cluster storage; everything here is gated on `Env.database`
 * Some, mirroring the bucket/stripe None-gates (`env.server.ts`).
 *
 * House pattern: a module-level `export const layer` set, mirroring
 * `storage.server.ts` (the bucket store) — `SqlClientLive` fails to *build* with
 * `Order.DatabaseUnconfigured` when no DB is configured (the analogue of
 * `Storage.StorageUnconfigured`), so callers that want the durable Order entity
 * require it, and DB-less deploys simply never compose it (the bucket-only
 * registration/webhook path is unaffected).
 *
 * ## The two-runtime topology (load-bearing)
 *
 * GYC has two independent runtime worlds that coordinate the Order lifecycle
 * ONLY through this storage's backing DB:
 *
 * - the long-lived `ServerLive` graph hosts the in-process Sharding **runner**
 *   (the consumer that runs handlers and writes replies);
 * - the `AppRuntime` request-handler graph hosts the **senders** (the
 *   registration action + Stripe webhook).
 *
 * These are SEPARATE layer graphs with SEPARATE `SqlClient` builds. They share
 * the durable `cluster_messages` / `cluster_replies` rows **only if both point
 * at the same sqlite FILE**. In production `DATABASE_URL` MUST therefore be a
 * FILE path on a persistent volume — `':memory:'` gives the two graphs two
 * disjoint in-memory DBs (a `send` from a route lands in a DB the runner never
 * polls), which silently breaks the route → runner → webhook loop. `':memory:'`
 * is for single-graph tests only (see `layerTest`).
 *
 * This is exactly the pattern the bucket `Storage` already uses: two separate
 * `Storage` builds coordinate fine because the bucket is external shared state.
 * Here the shared sqlite FILE is the seam.
 */

/**
 * Fail-to-build error when the durable Order storage is required but no
 * `DATABASE_URL` is configured — the analogue of `Storage.StorageUnconfigured`
 * (`storage.server.ts`). Callers that need the Order entity require
 * `SqlClient`; DB-less runtimes never compose this layer, so the error only
 * surfaces if something requires the durable path without a DB.
 */
export class DatabaseUnconfigured extends Schema.TaggedErrorClass<DatabaseUnconfigured>()(
  'Order.DatabaseUnconfigured',
  {},
) {}

/**
 * The single place the DB dependency is stood up: a `SqlClient` over the
 * `DATABASE_URL` sqlite database, gated on `Env.database` Some. With no DB
 * configured this fails to build with `Order.DatabaseUnconfigured` (mirroring
 * `Storage.layer`'s `StorageUnconfigured` gate). The filename is the redacted
 * connection string read straight off `Env` — a sqlite FILE path in
 * production, `':memory:'` in single-graph tests.
 *
 * If the deploy target ever flips from a Railway persistent-volume sqlite file
 * to Postgres, this is the ONE line that changes: swap `SqliteClient.layer` for
 * `@effect/sql-pg`'s `PgClient.layer`. The DB choice is localized here.
 */
export const SqlClientLive: Layer.Layer<
  SqlClient.SqlClient,
  DatabaseUnconfigured,
  Env.Service
> = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* Env.Service;

    if (Option.isNone(env.database)) {
      return yield* new DatabaseUnconfigured();
    }

    return SqliteClient.layer({
      filename: Redacted.value(env.database.value.url),
    });
  }),
);

/**
 * The shared `ShardingConfig` definition — ONE shard count both runtimes use.
 * The sender (in `AppRuntime`) and the runner (in `ServerLive`) MUST build from
 * the BYTE-IDENTICAL config: `ActorAddressResolverLayer.fromConfig` routes an
 * entity to a shard computed from the shard count, so a divergent count makes
 * the sender write a shard the runner never polls.
 *
 * `fromSqlClient` swallows its own `ShardingConfig.layerDefaults` internally and
 * does NOT re-export `ShardingConfig` (so the runner storage uses the defaults),
 * but the SENDER side cannot borrow the storage's config — it must be provided
 * this layer independently (G6). Exporting the one definition here is what keeps
 * both sides in lockstep. Defaults today (no overrides) — the seam exists so a
 * future non-default shard count stays single-sourced.
 */
export const ShardingConfigLive: Layer.Layer<ShardingConfig.ShardingConfig> =
  ShardingConfig.layer();

/**
 * encore's SQL `MessageStorage` (`fromSqlClient` — provides BOTH the upstream
 * `MessageStorage` tag and encore's `EncoreMessageStorage` extension) composed
 * onto `SqlClientLive`. This is the SINGLE place the DB dependency is stood up
 * for the durable Order entity; it backs the runner in `ServerLive`.
 *
 * encore's `SqlMessageStorage` owns the `cluster_messages` / `cluster_replies`
 * table creation (it runs its migrations at layer build), so there is no
 * hand-written DDL here.
 */
export const MessageStorageLive = fromSqlClient().pipe(
  Layer.provide(SqlClientLive),
);

/**
 * In-memory SQL `MessageStorage` for the entity tests (G3+): `fromSqlClient`
 * over a `':memory:'` SqliteClient. Valid ONLY for a single layer graph — the
 * cross-runtime test (G3) uses a shared FILE precisely because `':memory:'`
 * cannot exercise the two-graph seam.
 */
export const layerTest = fromSqlClient().pipe(
  Layer.provide(SqliteClient.layer({ filename: ':memory:' })),
);
