export * as Order from './runner.server';

import { Effect, Layer, Option } from 'effect';
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

import { Env } from '../env.server';
import {
  ShardingConfigLive,
  MessageStorageLive,
  layerTest,
} from './storage.server';
import { handlers as orderHandlers, Order as OrderActorEntity } from './order.actor';

export { MessageStorageLive, ShardingConfigLive, layerTest } from './storage.server';

/** Re-export the Order entity so senders (`runtime.ts`, the webhook) dispatch ops through one handle. */
export const Entity = OrderActorEntity;

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

/**
 * G6 — the FULLY-WIRED Order runner: the `arm` + `settle` (+ `cancel`/`refund`/
 * `expire`) handler layer (`order.actor.ts` `handlers`) registered onto the
 * single-process Sharding runner over a given `MessageStorage`. This is the
 * layer `server.ts` adds to the long-lived `ServerLive` graph (gated on
 * `Env.database` Some) so the runner's mailbox-poll fiber runs the handlers and
 * writes their durable replies — the consumer side of the two-runtime topology.
 *
 * The handlers require `Submissions.Service` (the bucket-authority writes); the
 * runner discharges `Sharding | MessageStorage`. So this leaves
 * `Submissions.Service` plus the storage's `RIn` (`Env.Service` in prod) open,
 * provided by `server.ts`. Production wires `Order.MessageStorageLive` (the
 * shared sqlite FILE); the lifecycle tests wire `Order.layerTest` (`:memory:`).
 */
export const fullRunnerLayer = <R, E, RIn>(
  messageStorage: Layer.Layer<R | MessageStorage.MessageStorage, E, RIn>,
) =>
  // `provideMerge` (not `provide`): keep the runner's client/storage/registry
  // services (`Client | MessageStorage | ActorClientService | ActorAddressResolver
  // | ActorStateRegistry`, which the handlers' `toLayer` output also carries) in
  // the result, so a same-graph driver (the G6 lifecycle test, which `send`s ops
  // and reads `getState` against this one runner) can resolve them. In prod this
  // layer is merged into `ServerLive` where those extra outputs are harmless.
  orderHandlers.pipe(Layer.provideMerge(runnerLayer(messageStorage)));

/** The services the request/webhook sender contributes to `AppRuntime`. */
export type SenderServices =
  | Client
  | ActorAddressResolver
  | MessageStorage.MessageStorage;

/**
 * G6 — the SENDER seam threaded into `makeAppLayer` (the `AppRuntime` request
 * graph), gated on `Env.database` Some exactly as `Storage`/`Payment` are
 * optional there. The senders that USE it (the registration action's `arm`
 * send, G7; the webhook's `settle` resolve, G8) are themselves `Env.database`-
 * gated, so the DB-less branch never dispatches — but the service TYPES must be
 * present unconditionally for `AppServices` to be stable, so the None branch
 * wires the sender over an inert in-memory `layerTest` storage (a "disabled"
 * instance no DB-less caller reaches, mirroring how `Storage.layerOptional`
 * always produces `Storage.Service`). The Some branch wires the real
 * `MessageStorageLive` — the SAME shared sqlite FILE the `ServerLive` runner
 * polls — and the SAME `ShardingConfigLive` (the cross-runtime shard-parity
 * invariant: a divergent shard count would route a `send` to a shard the runner
 * never polls).
 */
export const appSenderLayer: Layer.Layer<
  SenderServices,
  never,
  Env.Service
> = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* Env.Service;
    return Option.isNone(env.database) ?
        senderLayer(layerTest)
        // In this branch `Env.database` IS Some, so `MessageStorageLive`'s
        // `DatabaseUnconfigured` gate cannot fire — `orDie` reflects that
        // impossibility (a build failure here would be a real defect) and keeps
        // the sender's error channel `never`, so threading it into `makeAppLayer`
        // does not widen `AppRuntime`'s `ConfigError`-only build-error channel.
      : senderLayer(MessageStorageLive).pipe(Layer.orDie);
  }),
);
