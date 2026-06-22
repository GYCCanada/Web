export * as Order from './runner.server';

import { Layer } from 'effect';
import {
  MessageStorage,
  RunnerHealth,
  Runners,
  RunnerStorage,
  Sharding,
} from 'effect/unstable/cluster';
import {
  ActorAddressResolver,
  ActorAddressResolverLayer,
  ClientLayer,
  Client,
} from 'effect-encore';

import { ShardingConfigLive } from './storage.server';

export { MessageStorageLive, ShardingConfigLive, layerTest } from './storage.server';

/**
 * The single-process in-process Sharding **runner** — the consumer side of the
 * durable Order lifecycle. It registers the entity handlers (`Actor.toLayer`,
 * wired in G6) and consumes the SQL-backed mailbox, running the `process` /
 * `settle` / `cancel` / `refund` / `expire` handlers and writing their durable
 * replies into `cluster_replies`.
 *
 * ## Where this lives (the load-bearing topology)
 *
 * This cluster stack belongs in the **long-lived `ServerLive` graph**
 * (`server.ts`, `Layer.launch`-ed) — NOT the request-handler `makeAppLayer`
 * graph (consumed once into the `AppRuntime` singleton, never `Layer.launch`-ed).
 * The runner's mailbox-poll fiber and the deadline-sweep fiber are
 * process-lifetime fibers; they need the launch-time supervisor `ServerLive`
 * provides. The request side (registration action + Stripe webhook) is a
 * SENDER into the SAME shared DB (see `senderLayer`).
 *
 * ## Composition
 *
 * Verified against `effect-encore/test/send-and-await.test.ts`'s
 * `FastTerminationCluster`:
 *
 *   Sharding.layer
 *     ⊕ Runners.layerNoop          // single-node: no remote runners
 *     ⊕ <MessageStorage>           // SQL in prod, in-memory in single-graph tests
 *     ⊕ RunnerStorage.layerMemory
 *     ⊕ RunnerHealth.layerNoop
 *     ⊕ ShardingConfig.layer({...})
 *
 * The `MessageStorage` is a PARAMETER: production wires `Order.MessageStorageLive`
 * (G2, over the shared sqlite FILE), tests wire `Order.layerTest` (`:memory:`).
 *
 * ## Shard-parity invariant
 *
 * The runner's `ShardingConfig` MUST be the same `Order.ShardingConfigLive` the
 * SENDER uses — `ActorAddressResolver.fromConfig` routes an entity to a shard
 * computed from the shard count, so a divergent count makes the sender write a
 * shard the runner never polls. Both `runnerLayer` and `senderLayer` build from
 * the one `ShardingConfigLive` export, keeping the two runtimes byte-identical.
 */
export const runnerLayer = <R, E, RIn>(
  messageStorage: Layer.Layer<R | MessageStorage.MessageStorage, E, RIn>,
): Layer.Layer<Sharding.Sharding | R | MessageStorage.MessageStorage, E, RIn> =>
  Sharding.layer.pipe(
    Layer.provideMerge(Runners.layerNoop),
    Layer.provideMerge(messageStorage),
    Layer.provide([RunnerStorage.layerMemory, RunnerHealth.layerNoop]),
    Layer.provide(ShardingConfigLive),
  );

/**
 * The **sender** seam — the request/webhook side. In encore 0.14.0 the sender
 * host is the deep `Client` transport (`ClientLayer.fromConfig`) plus the
 * `ActorAddressResolver` the `peek`/`waitFor` loop reads directly, both over the
 * SAME `MessageStorage` + `ShardingConfig` the runner uses. This is what makes
 * the per-op `send` / `peek` / `waitFor` / `sendAndAwait` methods resolvable
 * from a host that does NOT run the handlers (the `AppRuntime` request graph).
 *
 * It provides `Client | ActorAddressResolver` (+ the mailbox/snowflake the
 * transport carries) and requires the SAME shared-DB `MessageStorage` — so a
 * `send` from a route lands in the rows the `ServerLive` runner polls, and a
 * `peek` from the webhook observes the reply the runner wrote, with ZERO bespoke
 * adapter. The `MessageStorage` is a parameter for the identical reason as the
 * runner: prod wires `Order.MessageStorageLive` (shared FILE), tests wire
 * `Order.layerTest`.
 */
export const senderLayer = <R, E, RIn>(
  messageStorage: Layer.Layer<R | MessageStorage.MessageStorage, E, RIn>,
): Layer.Layer<
  Client | ActorAddressResolver | R | MessageStorage.MessageStorage,
  E,
  RIn
> =>
  Layer.mergeAll(
    ClientLayer.fromConfig,
    ActorAddressResolverLayer.fromConfig,
  ).pipe(
    // `provideMerge` (not `provide`) so the storage's `MessageStorage` tag stays
    // in the output: the per-op `send` / `peek` / `waitFor` / `sendAndAwait`
    // methods require `Client | MessageStorage | ActorAddressResolver`, and the
    // first two come from here while the resolver wraps the shard config.
    Layer.provideMerge(Layer.mergeAll(messageStorage, ShardingConfigLive)),
  );
