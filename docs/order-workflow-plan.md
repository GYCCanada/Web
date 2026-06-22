# GYC Order Workflow — durable Order actor for the registration-payment lifecycle

> Authoritative, commit-broken implementation plan synthesized from PLAN A (infra-first)
> + PLAN B (domain-first) + both adversarial cross-reviews. Every claim below is
> verified against the real tree on branch **`feat/registrar`** (the registrar PR #35
> base) and the **`effect-encore` HEAD (v0.12.8, `main`)** on disk at
> `/Users/cvr/Developer/personal/effect-encore`. This plan will be `--deep` reviewed
> then implemented commit-by-commit, so it is load-bearing: file:line citations are
> the receipts.

---

## 1. Overview

The registrar (PR #35, `feat/registrar`) already owns the **payment freeze discipline**:
a `Payment` service that mints a Stripe Checkout Session
(`app/lib/payment.server.ts:142` `createCheckoutSession`), a frozen `RegistrationOrder`
receipt stored as a bucket object (`app/lib/forms/order.ts:40`), a `Submissions` service
with `persistOrder` / `getOrder` / `markOrderPaid` / `markOrderFailed`
(`app/lib/forms/submissions.server.ts:283,143,382,434`), and a Stripe webhook that
reconciles `checkout.session.completed` / `async_payment_failed` against the frozen
amount (`app/routes/api.stripe-webhook.ts:88-125`).

This work adds a **durable encore Order ENTITY** that *orchestrates* that lifecycle — it
does **not** replace the freeze. The entity:

- backs onto **encore's SQL `MessageStorage`** stood up inside GYC for the first time
  (GYC has no MessageStorage today — only the bucket store at `app/lib/storage.server.ts`);
- exposes ops **`process` → `cancel` → `refund` → `expire`** over the state machine
  `pending | paid | cancelled | refunded | expired`;
- has its `process` op **suspend awaiting the Stripe webhook**, which resolves the op's
  ExecId through the *same* SQL MessageStorage reply mechanism — no bespoke bucket adapter;
- treats the **bucket `RegistrationOrder` as the durable source of truth** and the actor's
  in-process State as a derived cache (because encore's durable per-entity State backing is
  DEFERRED — `effect-encore/CONTEXT.md`, in-process `SubscriptionRef` today).

### The decisive architecture fact both source plans got partly wrong

Both source plans argued about whether GYC needs a Sharding "runner". The cross-reviews
flagged the contradiction but neither source plan resolved it correctly. The tree settles it:

- **PLAN A** wanted a runner but planned to add it to `makeAppLayer`
  (`app/lib/effect/runtime.ts:94-115`). That is the **request-handler layer graph** — the one
  every React Router loader/action runs against. It is **never `Layer.launch`-ed**, so it has
  no process-lifetime supervisor for the mailbox-poll fiber or the deadline sweep. A durable
  actor runner + sweep fiber **cannot** live there. (Note: `makeAppLayer` is NOT "rebuilt per
  request" — it is consumed ONCE into the module-level singleton `AppRuntime`,
  `runtime.ts:120` `const AppRuntime = ManagedRuntime.make(...)`. The disqualifier is the
  never-`Layer.launch`-ed request-handler role, not per-request rebuild.)
- **PLAN B** claimed "no runner — `Client.layer.fromConfig` is the dispatch seam." This is
  **false against the tree**: `ActorMailboxLayer.fromConfig` only *enqueues* to storage
  (`effect-encore/src/actor-mailbox.ts:88-120`, "the consumer's storage poll loop picks up
  the envelope"). With **no runner consuming the mailbox, the `process` handler never runs**
  — `createCheckoutSession` would never fire. Also `Client.layer`/`State<A>` are **not
  exported** by encore HEAD (`effect-encore/src/index.ts` exports `registerState` +
  read-only `ActorStateHandle` only — the #1/#2 reshape is unpublished).

**The correct model (verified):** GYC hosts a **single-process in-process Sharding runner**
in the **long-lived `ServerLive` layer** (`server.ts:263-269`, which IS `Layer.launch`-ed at
`:269`) that registers the Order handlers (`Actor.toLayer`) AND consumes the SQL-backed
mailbox. The runner belongs in the `Layer.launch`-ed graph because its mailbox-poll fiber and
the deadline sweep are **process-lifetime fibers** — they need the launch-time supervisor
`ServerLive` provides; the request-handler `makeAppLayer` graph never gets one. The exact
runner composition is proven in `effect-encore/test/send-and-await.test.ts:63-68`
(`FastTerminationCluster`):

```
Sharding.layer
  ⊕ Runners.layerNoop            // single-node: no remote runners
  ⊕ MessageStorage (SQL here)    // swap layerMemory → fromSqlClient
  ⊕ RunnerStorage.layerMemory
  ⊕ RunnerHealth.layerNoop
  ⊕ ShardingConfig.layer({...})
```

The request side (route handlers, the webhook) is a **sender** into that same SQL storage:
it uses the `OperationHandle` methods `send` / `peek` / `waitFor` / `sendAndAwait` (each a
per-op method on the entity's operation handle, `effect-encore/src/actor.ts:557-639`), wired
by `ActorSenderLayer.layer` which requires `MessageStorage | ShardingConfig`
(`src/actor-sender.ts:42-46`), NOT a local runner.

### The two-runtime topology — and why the shared seam is a DB FILE, not a layer instance

GYC has **two independent runtime worlds**, and naming them is load-bearing because the
central "webhook resolves the suspended op" invariant ONLY holds across them if they share
durable backing:

- **`ServerLive`** (`server.ts:263`, `Layer.launch`-ed at `:269`) — the long-lived process
  graph. **This hosts the runner + `Order.MessageStorageLive`** (the consumer side that runs
  handlers and writes replies) and the deadline-sweep fiber.
- **`AppRuntime`** (`runtime.ts:120`, the **module-level singleton** built ONCE at import via
  `ManagedRuntime.make(makeAppLayer(...))`, NOT per request) — the request-handler graph every
  React Router loader/action runs against via `makeRequestRuntime()` (`server.ts:135`,
  `runtime.ts:206-207`). **This hosts the SENDER side** (`ActorSenderLayer` threaded into
  `makeAppLayer`). The registration action and the Stripe webhook (`api.stripe-webhook.ts:72`
  `routeAction`) BOTH run here.

These are **separate layer graphs with separate `SqlClient` builds.** They do NOT share an
in-memory `MessageStorage` instance. They share durable state **only if both point at the
same sqlite FILE** — the rows in `cluster_messages` / `cluster_replies` are the coordination
point. This is **exactly the pattern `Storage` already uses today**: `server.ts:261`
(`StorageLive = Storage.defaultLayer`) and `makeAppLayer`'s `Storage.layerOptional`
(`runtime.ts:109`) are *two separate `Storage` builds* that coordinate fine because the bucket
is **external shared state** (`runtime.ts:55-62` documents the "one Storage instance the whole
app runtime shares … no second instance to coordinate" reasoning — the bucket IS the seam).

**The hard consequence (see Risk 2, promoted to a pre-G0 BLOCKER):** `':memory:'` gives the
two runtimes **two DISJOINT in-memory DBs** — a `send` from the `AppRuntime` sender lands in a
DB the `ServerLive` runner never polls, and the webhook's `peek` sees nothing. The
route→runner→webhook loop is **completely broken** under `':memory:'` in production. The only
viable sqlite path is a **shared FILE on a persistent volume** (or `@effect/sql-pg`). A single
in-memory layer graph in a test will pass while never exercising the real cross-runtime
sharing — see the dedicated **G3 cross-runtime test** that builds BOTH graphs over ONE shared
file DB.

Because both the runner (in `ServerLive`) and the senders (in `AppRuntime`) point at **one
SQL MessageStorage over one shared DB file**, a `send` from a route is consumed by the runner
fiber, and a `peek`/ExecId resolution from the webhook observes the reply the runner wrote.
This is the seam that makes "webhook resolves the suspended op" work with **zero bespoke
adapter**.

> **Cross-runtime `ShardingConfig` parity invariant.** `ActorSenderLayer.layer` uses
> `ActorAddressResolverLayer.fromConfig`, which carries the shard-parity invariant
> (`src/actor-address-resolver.ts`): the destination shard for an entity is computed from the
> `ShardingConfig` shard count. The sender's `ShardingConfig` (in `AppRuntime`) and the
> runner's `ShardingConfig` (in `ServerLive`) MUST be **byte-identical** (same shard count)
> or routing diverges and the runner polls a different shard than the sender wrote to. Both
> sides MUST be built from one shared `ShardingConfig.layer({...})` definition — see G6.

> Note on latency: `fromConfig` mailbox delivery is bounded by `entityMessagePollInterval`,
> not `notifyLocal` (`effect-encore/src/actor-mailbox.ts:30-33`). For an interactive
> `process` (the visitor waits for the Checkout URL), we do NOT block the request on the
> handler — see the **pre-suspend URL contract** in G6 (the action gets the URL synchronously,
> the suspend/resume is the post-payment continuation).

### Critical correction to the "process suspends, handler returns the URL" model

The cross-reviews assumed the `process` handler creates the Checkout session AND returns the
URL AND suspends — all in one op. Against the tree this is incoherent for an interactive
redirect, because the runner consumes the mailbox asynchronously (poll-interval latency) and
the request can't block on it. **Resolution (this plan's decision, see G5/G6):**

- The **action** (request fiber) calls `Payment.createCheckoutSession` + `Submissions.persistOrder`
  directly and synchronously (exactly as today, `registration-action.ts` checkout block) so it
  has the `{sessionId, url}` to redirect/mail immediately. The freeze stays at the action
  boundary.
- The action then **`send`s the Order `arm` op** (a durable, fire-and-forget op that records
  the entity into existence at `pending` with the frozen order linkage) — this is the durable
  lifecycle anchor. It does NOT re-create the session.
- The `process`/settlement continuation is driven by the **webhook resolving the op**, not by a
  blocking handler. The op the webhook resolves is the durable one whose ExecId is reconstructable
  from `metadata.orderId`.

This keeps the interactive redirect synchronous (no regression), makes the durable lifecycle a
true wrapper, and sidesteps the "handler must return the URL before suspending" foot-gun that
both cross-reviews flagged (PLAN B risk 6).

---

## 2. Architecture decisions this plan honors

1. **Bucket `RegistrationOrder` is the durable source of truth; actor State is a derived
   in-process cache.** encore's durable per-entity State backing is DEFERRED
   (`effect-encore/CONTEXT.md`; in-process `SubscriptionRef`). A process restart between
   `send` and webhook-resolve must NOT lose the lifecycle — it rebuilds from the bucket order +
   the durable SQL reply log. Every op writes the **bucket transition** (`flipStatus`,
   `submissions.server.ts:346`) as the authority; State mirrors it. (cross-review-A mustFix #1,
   cross-review-B strength #2.)

2. **Single-process in-process Sharding runner in the long-lived `ServerLive` layer**
   (`server.ts:263-269`, the `Layer.launch`-ed graph), NOT in the request-handler
   `makeAppLayer` graph (consumed once into the `AppRuntime` singleton, `runtime.ts:120`). The
   disqualifier for `makeAppLayer` is that it is **never `Layer.launch`-ed** — it has no
   process-lifetime supervisor for the runner's mailbox-poll fiber or the deadline sweep — NOT
   that it is "rebuilt per request" (it is a module-level singleton). The runner hosts
   `Actor.toLayer` handlers + the deadline-sweep fiber; the request side (in `AppRuntime`) is a
   sender into the **same shared DB**. Composition template: `send-and-await.test.ts:63-68`.
   The two graphs share durable state via a **shared sqlite FILE** (the `cluster_messages` /
   `cluster_replies` rows), never an in-memory instance — see the two-runtime topology in §1.
   (cross-review-A mustFix #2, cross-review-B mustFix #1.)

3. **Consume the encore HEAD as-published** — `effect-encore/src/index.ts` exports
   `fromSqlClient`, `fromSqlClientWithShardingConfig` (`:70-71`), `entityIdCodec` (`:76`),
   `makeExecId` + `PeekResult` (`:51-53`), `ActorSenderLayer` (`:82`), `ActorMailbox` +
   `ActorMailboxLayer` (`:80`). The `sendAndAwait` / `waitFor` / `peek` / `executionId`
   operations are **per-op METHODS on each operation's `OperationHandle`** (`src/actor.ts:586`,
   `:604`, `:607`, `:622`) — NOT standalone `Op.*` exports; you reach them as
   `Order.settle.sendAndAwait(...)`, `Order.settle.waitFor(...)`, etc. The index does **NOT**
   export `Client`/`State<A>` (the #1/#2 reshape is unpublished). **This plan does NOT depend
   on the unpublished reshape** — it uses the shipped sender + SQL-storage + per-op
   `sendAndAwait`/`waitFor` seams, which are sufficient. This removes the publish-ordering
   blocker both cross-reviews raised: **no new encore publish is strictly required** to start
   (confirm the version GYC pins; HEAD `0.12.8` already has the `sendAndAwait` method).

4. **ExecId resolvable from `metadata.orderId` alone — via the op's own `waitFor`/`peek`,
   NOT via `entityIdCodec`/`makeExecId` string-surgery.** The webhook only has
   `metadata.orderId` (`api.stripe-webhook.ts:105`). The mechanism (verified against
   `actor.ts:114-128,1380-1386`):
   - The op's `id` fn MUST be a **pure function of `orderId`** returning a **string**:
     `id: (p) => p.orderId`. When `id` returns a string, `resolveId` sets
     `entityId === primaryKey === orderId` (`actor.ts:124-125`), and the per-op `execId`
     closure produces `makeExecId(\`${orderId}\x00settle\x00${orderId}\`)`
     (`actor.ts:1383-1385`).
   - The webhook reconstructs by calling the op's own method with a payload that carries only
     `orderId`: **`Order.settle.waitFor({ orderId })`** (or `.peek({ orderId })`). This works
     because `id` ignores every other payload field — `resolveId` runs `id(payload)` and reads
     only `p.orderId`, so the rest of the `settle` payload is irrelevant to the execId
     (`actor.ts:1380-1382`). The webhook does NOT need to reconstruct the full payload.
   - **Do NOT** build the execId via `entityIdCodec` + `makeExecId`: `entityIdCodec`
     (`entity-id-codec.ts:38`) encodes an entityId TUPLE joined by `:`, not the
     `entityId\x00tag\x00primaryKey` execId format; `makeExecId` (`receipt.ts:14`) ONLY brands
     a string and joins nothing. Neither produces the execId format — that is the per-op
     `execId` closure alone (`actor.ts:1383-1385`). The fallback, if a raw string is ever
     needed, is to format `\`${orderId}\x00settle\x00${orderId}\`` directly and
     `makeExecId(...)`-brand it — but the supported path is `Order.settle.waitFor({ orderId })`.
   - **Round-trip assertion (G3/G8):** assert the action-side `Order.settle.executionId(fullPayload)`
     equals the webhook-side `Order.settle.executionId({ orderId })` (and equals the manually
     formatted string), proving the `id`-ignores-the-rest property holds.

   Terminal replay is a no-op (encore dedup — a terminal persisted reply returns immediately,
   `actor.ts:574-576`), preserving `paidAt` byte-identical (`order.ts:62-71`, idempotency
   contract `c8c4abd`). (Both cross-reviews mustFix.)

5. **Status-set reconciliation: actor State is the sole authority for the two NEW states
   (`cancelled`, `refunded`); the bucket schema is widened ONLY where a transition must be
   durable.** The bucket `RegistrationOrder.status` is today `['pending','paid','failed','expired']`
   (`order.ts:56`). The actor adds `cancelled` (≈ `failed`, operator/abandon) and `refunded`
   (genuinely new). **Decision:** widen the bucket literal to
   `['pending','paid','failed','expired','cancelled','refunded']` (superset, additive) with a
   read-boundary tolerance so legacy paid orders still decode — this is the published-doc
   backfill hazard from MEMORY (`cms-published-doc-backfill-hazard.md`): the widen is on a
   **closed `Schema.Literals`**, and any read that pattern-matches status must handle the two
   new arms. `failed` and `cancelled` stay **distinct** (`failed` = Stripe async-payment-failed;
   `cancelled` = operator/abandon). (cross-review-A mustFix #6, cross-review-B gap.)

6. **The Order WRAPS the freeze; the action keeps the synchronous URL handoff.** Move NOTHING
   that must be synchronous into an async handler. The action computes the frozen
   `amount`/`receiptEmail` under the shared `now` (Decision 6, `registration-action.ts:249-258`),
   calls `createCheckoutSession` + `persistOrder` synchronously, redirects (group) / mails
   (perRegistrant), and `send`s the durable Order op. (Resolves PLAN B risk 6 + cross-review-A
   mustFix #4 without breaking the redirect.)

7. **`async_payment_failed` is NOT regressed.** The webhook already flips to `failed`
   (`api.stripe-webhook.ts:107-112` `markOrderFailed`). The new actor-resolution path resolves
   the op to a Failure (→ State `failed`) ADDITIVELY, preserving the existing bucket flip.
   (Both cross-reviews mustFix.)

8. **Everything is gated `Env.database` Some**, mirroring the bucket/stripe None-gate
   (`env.server.ts:98-175`). DB-less deploys keep working exactly as today (bucket-only
   webhook flip, no Order entity). (PLAN A G2/G6/G8/G9, retained.)

---

## 3. Dependency / version facts (verified)

- GYC pins `effect@4.0.0-beta.60` + `@effect/platform-bun@4.0.0-beta.60` + `overrides.effect`
  (`package.json:38,28,73-75`).
- encore HEAD `package.json`: `effect@4.0.0-beta.75`, `@effect/sql-sqlite-bun@4.0.0-beta.75`,
  peerDep `effect >=4.0.0-beta.66`.
- `@effect/sql` ships **inside** `effect` under `effect/unstable/{sql,cluster}` (confirmed —
  encore imports `effect/unstable/cluster` and `effect/unstable/sql`; `send-and-await.test.ts:5`
  imports `MessageStorage, Runners, Sharding, ShardingConfig, RunnerStorage, RunnerHealth` from
  `effect/unstable/cluster`). So GYC adds only the **sqlite-bun driver**, NOT a separate
  `@effect/sql`/`@effect/cluster` dep. (cross-review-A correctly faults PLAN B G0 for adding
  `@effect/sql` separately.)
  - **Stale-peerDep caveat (G0 gate):** encore's `package.json` lists `@effect/cluster`,
    `@effect/rpc`, `@effect/sql`, `@effect/workflow` as peerDeps (with dev pins), but `src`
    actually imports them from `effect/unstable/*` (the versions bundled into `effect`). Those
    peerDeps are **stale/unused for the unstable paths** — GYC must NOT add them. `bun install`
    may surface an `EBADPEER`-style note for these unused peers; the G0 gate-green check should
    **tolerate/expect** those stale-peer notices and must still resolve the genuinely-required
    peer (`effect >=beta.66`, satisfied by beta.75).
- distilled refund operation is `PostRefunds` (`node_modules/@distilled.cloud/stripe/lib/operations/PostRefunds.*`),
  imported from `@distilled.cloud/stripe/Operations` like `PostCheckoutSessions`
  (`payment.server.ts:18`). **Caveat (G7 risk):** `PostRefunds` refunds a `payment_intent` or
  `charge`, but the bucket order stores only `sessionId` (`order.ts:50`) — the refund op must
  resolve the PaymentIntent from the session first (see G7).

---

## 4. Commits

> Branch: stack ON TOP of `feat/registrar` (current branch) as a child branch
> `feat/order-workflow`. Every commit: `bun run typecheck` (= `react-router typegen && tsgo
> --noEmit`) + `bun run lint` (oxlint) + `bun test` green. Each commit compiles and passes gate
> in isolation. High-blast-radius commits (G0, G6) are sub-committable per the global
> sub-commit guidance if the diff balloons.

---

### G0 — `build(deps): bump effect to beta.75 + add encore + sqlite-bun driver`

**Files:** `package.json`, `bun.lock`, plus any existing-app fallout files surfaced by the
post-bump typecheck.

**Scope:**
- Bump `effect` `4.0.0-beta.60 → 4.0.0-beta.75`, `@effect/platform-bun` `4.0.0-beta.60 →
  4.0.0-beta.75`, and the `overrides.effect` pin (`package.json:73-75`) — all in lockstep
  (these betas are co-released; the `overrides` pin makes the app's effect the single instance
  encore peers against).
- Add `effect-encore` at the published version that ships the per-op `sendAndAwait`/`waitFor`
  methods on `OperationHandle` (`actor.ts:586,622`) + `fromSqlClient` + `ActorSenderLayer` (HEAD
  is `0.12.8`; confirm the exact published tag — see Open Question 1).
- Add `@effect/sql-sqlite-bun@4.0.0-beta.75` (encore's tested SQL driver,
  `send-and-await`/`sql-storage` tests; the GYC MessageStorage backing).
- Add the DB env knob to `.env.example` (`DATABASE_URL` or `DATABASE_PATH` — a sqlite file path
  or `:memory:`).
- Run `bun install`; then `bun run typecheck` to surface beta.60→beta.75 API drift in existing
  files (Schema, Layer, Config, `effect/unstable/*` import paths). **Fix all fallout in THIS
  commit** so the bump is atomic and green (the No-Bail-Outs rule — no `any`, no commented-out
  code). Likely hot spots to check: `Schema.TaggedErrorClass` usages (`payment.server.ts:85,108`),
  `Config` gates (`env.server.ts`), `Layer.provideMerge` (`runtime.ts:109-114`),
  `ManagedRuntime.make` (`runtime.ts:120`).

**Gate green:** `bun install` resolves the **required** peer (encore's `effect >=beta.66` is
satisfied by beta.75); the only acceptable `EBADPEER` notices are encore's **stale/unused**
`@effect/cluster|rpc|sql|workflow` peerDeps (see §3 — encore imports those from
`effect/unstable/*`, so the peerDep is informational and does NOT require GYC to add the dep);
any OTHER `EBADPEER` is a real failure to fix. `bun run typecheck` passes on the existing suite
with the bumped effect; `bun run lint` clean; `bun test` green (no source logic changed beyond
drift fixes).

**Deps:** none EXCEPT the pre-G0 BLOCKER below (DB target / Open Question 2 must be resolved
first — it determines G2's adapter and the whole cross-runtime sharing story). encore must be
published — out-of-repo prerequisite; HEAD already has the required surface.

> **Pre-G0 BLOCKER — resolve Open Question 2 BEFORE this commit.** Because the runner
> (`ServerLive`) and the senders (`AppRuntime`) are two separate layer graphs that can ONLY
> share durable state through a backing DB, `':memory:'` is **impossible in production** (two
> disjoint in-memory DBs — see §1 two-runtime topology). The choice is **sqlite FILE on a
> persistent volume** vs **`@effect/sql-pg` + Railway Postgres**, and it gates the whole
> architecture (not just G2's adapter line). Decide first. If Railway can't mount a volume, the
> plan flips to `@effect/sql-pg`: add that dep here in G0 (with a connection-pool note),
> localized to `Order.SqlClientLive` (G2) but architecture-gating.

---

### G1 — `feat(order): optional Database (DATABASE_URL) env gate`

**Files:** `app/lib/env.server.ts`, `app/lib/env.server.test.ts` (if it asserts the `Service`
shape).

**Scope:**
- Add a `DatabaseConfig` `Config.Config<Option.Option<DatabaseConfig>>` following the EXACT
  blank-collapse None-gate the bucket/stripe configs use (`env.server.ts:98-175`): a
  `Config.withDefault('')` read trimmed, collapsing to `Option.none()` unless non-blank. Do
  NOT use `Config.option` (the documented rationale at `env.server.ts:131-140`: a present-but-
  empty env var is a successful empty parse, not missing data).
- Shape: `{ readonly url: Redacted.Redacted<string> }` (redacted so the connection string never
  logs, mirroring `bucket.accessKeyId`). For a sqlite file path the redaction is harmless; for a
  future Postgres URL it matters.
- Add `database: Option.Option<DatabaseConfig>` to the `Env.Service` shape — note the env
  service is a `Context.Service` class (`env.server.ts:177`, NOT `Effect.Service`) — and thread
  it through BOTH the production and dev branches of `layer` (`env.server.ts:207-219`), exactly
  as `stripe`/`bucket` are threaded. `defaultLayer` unchanged (`env.server.ts:223`).

**Decision:** Database is optional everywhere — the app boots without a DB; the Order entity is
gated off it and the rest (CMS, forms, the existing bucket-backed order persist + webhook) is
untouched.

**Gate green:** `bun run typecheck` (the `Env.Service` shape change propagates cleanly — no
consumer requires `database` yet); `bun test` green incl. the env config test; lint clean.

**Deps:** G0.

---

### G2 — `feat(order): SQL MessageStorage layer over DATABASE_URL (no entity yet)`

**Files:** NEW `app/lib/order/storage.server.ts`, NEW `app/lib/order/storage.server.test.ts`.

**Scope:**
- A house-pattern module (module-level `export const layer`, mirroring `storage.server.ts:137`
  / opencode convention) exposing:
  - `Order.SqlClientLive`: `Layer<SqlClient.SqlClient, never, Env.Service>` gated on
    `Env.database` Some. None ⇒ a `DatabaseUnconfigured` tagged-error fail-to-build (mirroring
    `StorageUnconfigured`, `storage.server.ts:71-74,161-168`). Uses `SqliteClient.layer({
    filename })` from `@effect/sql-sqlite-bun` keyed off `DATABASE_URL` — encore's tested
    adapter (`effect-encore/test/sql-storage.test.ts`; `send-and-await` uses memory, sqlite is
    the file analog). **In production `DATABASE_URL` MUST be a FILE path on a persistent volume,
    never `':memory:'`** — `':memory:'` gives `ServerLive` (runner) and `AppRuntime` (sender)
    two disjoint DBs and breaks the cross-runtime loop (§1 two-runtime topology / Risk 2,
    pre-G0 BLOCKER). `':memory:'` is for single-graph tests only. If the pre-G0 decision flips
    to Postgres, swap this for `@effect/sql-pg` (`PgClient.layer`) — localized here. NOT a
    network DB by default (Railway mounts a volume for the sqlite file).
  - `Order.MessageStorageLive` = encore's `fromSqlClient()`
    (`effect-encore/src/index.ts:70`, `src/storage.ts:142-145`, returns `Layer<MessageStorage |
    EncoreMessageStorage, never, SqlClient.SqlClient>` with `ShardingConfig.layerDefaults`
    already provided internally) composed onto `SqlClientLive`, yielding `Layer<MessageStorage |
    EncoreMessageStorage, never, Env.Service>`. **This is the SINGLE place the DB dependency is
    stood up** (it backs the runner in `ServerLive`).
  - `Order.ShardingConfigLive` = ONE shared `ShardingConfig.layer({...})` definition (the SAME
    shard count both runtimes use). Export it from this module so the runner (G6, `ServerLive`)
    AND the sender (G6, `AppRuntime`) build from the identical config — the cross-runtime
    shard-parity invariant (§1). NOTE: `fromSqlClient` swallows its own
    `ShardingConfig.layerDefaults` and does NOT re-export `ShardingConfig`
    (`src/storage.ts:145`), so the **sender side cannot borrow the storage's config** — it must
    be provided `Order.ShardingConfigLive` independently (G6). If a future need arises to make
    the runner storage use the shared (non-default) config too, swap `fromSqlClient` for
    `fromSqlClientWithShardingConfig` (`src/storage.ts:108`, leaves `ShardingConfig` open) and
    provide `Order.ShardingConfigLive`.
- NEW `app/lib/order/storage.test-helper.ts` (or inline in the test): `Order.layerTest` =
  `fromSqlClient().pipe(Layer.provide(SqliteClient.layer({ filename: ':memory:' })))` — the
  in-memory backing for the entity tests in G3+.
- NO hand-written DDL: encore's `SqlMessageStorage` owns `cluster_messages` / `cluster_replies`
  creation (`effect-encore/src/storage.ts:108-141`; table names prefixed `cluster`).

**Gate green:** `bun run typecheck` (composes encore's exported layers with no requirement leak
beyond `Env`); `storage.server.test.ts` boots `Order.layerTest` against `:memory:` and asserts
(a) `cluster_messages`/`cluster_replies` exist after boot, (b) a raw
`EncoreMessageStorage.deleteEnvelope` (or a `saveRequest`→`repliesFor`) round-trips — porting
`effect-encore/test/sql-storage.test.ts` into GYC's harness, **proving the encore SQL adapter
works inside GYC's effect/bun toolchain (the core version-skew de-risk)**; lint clean.

**Deps:** G1.

---

### G3 — `feat(order): in-process Sharding runner + durable probe entity round-trips end-to-end`

**Files:** NEW `app/lib/order/runner.server.ts`, NEW `app/lib/order/runner.test.ts`
(test-only probe), NEW `app/lib/order/cross-runtime.test.ts` (the two-graph shared-file test).

**Scope:**
- `app/lib/order/runner.server.ts`: a `Order.runnerLayer(messageStorage)` that composes the
  **single-process Sharding runner** over a given MessageStorage, per the verified template
  `effect-encore/test/send-and-await.test.ts:63-68`:
  `Sharding.layer ⊕ Runners.layerNoop ⊕ <MessageStorage> ⊕ RunnerStorage.layerMemory ⊕
  RunnerHealth.layerNoop ⊕ ShardingConfig.layer({...})`. Production wires
  `Order.MessageStorageLive` (G2) in; tests wire `Order.layerTest`. **The runner's
  `ShardingConfig` MUST be `Order.ShardingConfigLive` (G2)** — the same instance the sender
  uses — so the shard-parity invariant holds across runtimes (§1). Also re-export the
  `ActorSenderLayer` bundle (`effect-encore/src/actor-sender.ts:64`), provided
  `Order.MessageStorageLive` + `Order.ShardingConfigLive`, for the request/webhook sender side
  — both runner and sender over the SAME storage AND the SAME shard config.
- `app/lib/order/runner.test.ts` (throwaway probe — deleted/folded when G8 lands the real
  lifecycle test, OR kept as a permanent SQL-storage smoke test; lean keep-as-smoke): define a
  minimal `Actor.fromEntity('OrderProbe', { Ping: { payload, success, persisted: true, id } })`
  with `id: (p) => p.key` (a pure-fn-of-one-field id, mirroring Decision 4) + `Actor.toLayer`
  handler, wire the FULL runner over `Order.layerTest` SQL MessageStorage (NOT `TestRunner.layer`
  — the point is to prove the REAL SQL path), and assert:
  1. `Ping.sendAndAwait({...}, { timeout })` — the per-op METHOD (`actor.ts:586`), called as
     `OrderProbe.Ping.sendAndAwait` — reaches `Success` with the row landing in
     `cluster_messages`/`cluster_replies` — the durability proof that the runner consumes the
     SQL mailbox and writes the reply;
  2. **the webhook-shaped ExecId path (Decision 4):** assert
     `Ping.executionId({ key, extra: 'a' })` === `Ping.executionId({ key })` === the manually
     formatted `makeExecId(\`${key}\x00Ping\x00${key}\`)` — proving `id` ignores the rest of the
     payload — then `Ping.waitFor({ key })` (the orderId-only payload the webhook holds) observes
     the reply terminal through the SAME SQL MessageStorage with no bespoke adapter. Do NOT use
     `entityIdCodec`+`makeExecId` to build the execId — see Decision 4.
- **`app/lib/order/cross-runtime.test.ts` (the BLOCKER test — cross-review mustFix #1):** the
  ONLY test that exercises the real two-runtime topology. Build BOTH layer graphs over **ONE
  shared sqlite FILE** (`SqliteClient.layer({ filename: <tmpfile> })`, NOT `':memory:'`):
  - a **runner graph** = `Order.runnerLayer(Order.MessageStorageLive)` + the probe
    `Actor.toLayer` handler (the `ServerLive` analog);
  - a **sender graph** = `ActorSenderLayer.layer` provided `Order.MessageStorageLive` +
    `Order.ShardingConfigLive` over the SAME file (the `AppRuntime` analog), built as a
    SEPARATE `ManagedRuntime`/layer build (distinct `SqlClient`).
  Assert: a `Ping.send({ key })` from the **sender graph** is consumed by the **runner graph**'s
  handler, and a `Ping.peek({ key })` from a **second independent sender build** over the same
  file sees it terminal. Then assert the **negative control**: repeat with `':memory:'` on each
  graph and show the send is NOT observed cross-graph (the two-disjoint-DBs failure mode — kept
  as a guard so a future `':memory:'` regression is caught). This is the test the G8/G9
  single-graph `':memory:'` tests CANNOT provide — it proves the production seam.

**Deliverable: CONFIDENCE.** The new DB dependency + the SQL-backed in-process runner + the
sender/ExecId resolution + **the cross-runtime shared-file seam** all work in GYC before any
Order semantics exist. This commit ESTABLISHES the production runner composition (which encore
only ships in tests) — exactly why it is front-loaded (PLAN A G3/G4 de-risk, sharpened with the
now-verified runner wiring + the two-runtime topology).

**Gate green:** `bun test` runs the probe green — a persisted entity `sendAndAwait` reaches
Success backed by GYC's SQL MessageStorage, the ExecId round-trip holds
(`executionId({key,extra})===executionId({key})`), AND the **cross-runtime shared-file test**
proves a sender-graph `send` is consumed by the runner-graph handler and a second sender's
`peek` sees it terminal (with the `':memory:'` negative control failing as expected); typecheck
+ lint clean.

**Deps:** G2.

---

### G4 — `feat(order): Order entity schema + state machine (no Stripe calls)`

**Files:** NEW `app/lib/order/order.actor.ts` (definition + transition table only),
NEW `app/lib/order/order.actor.test.ts`.

**Scope:**
- `Actor.fromEntity('Order', {...})` (`effect-encore/src/actor.ts` `fromEntity`). Ops:
  - **`arm`** (the durable lifecycle anchor, `persisted: true`): payload = the frozen order
    linkage `{ orderId, mode, amount, currency, receiptEmail, sessionId, registrantIds,
    deadline? }`. `id: (p) => p.orderId` — returns the **string** `orderId`, so `resolveId`
    sets `entityId === primaryKey === orderId` (`actor.ts:124-125`) and `id` IGNORES every
    other payload field (Decision 4 — the webhook, which has only `metadata.orderId`,
    resolves the ExecId by calling the op with `{ orderId }`). Records the entity into
    existence at `pending`.
  - **`settle`** (`persisted: true`): the op the webhook resolves on
    `checkout.session.completed`. `id: (p) => p.orderId` (string, same pure-fn-of-`orderId`
    rule as `arm`) — so the webhook resolves it via `Order.settle.waitFor({ orderId })` /
    `.peek({ orderId })` (Decision 4). Its success drives `pending → paid`.
  - **`cancel`** / **`refund`** / **`expire`** (`persisted: true`): `id: (p) => p.orderId`
    (string), keyed on `orderId`.
- Persisted state schema `OrderState`: `{ status:
  Schema.Literals(['pending','paid','cancelled','refunded','expired']), sessionId, paidAt? }`
  (NOTE: the actor state literal need not carry `failed` — `failed` is a bucket-only terminal
  from `async_payment_failed`; the actor maps an async-failed settlement to a Failure reply,
  see G6). Reuse the brands `Cents`/`CurrencyCode`/`BillingMode`/`ListItemId`/`IsoDate`
  (`order.ts:1-6`, `pricing.ts`) — derive-don't-sync, do NOT redeclare.
- **No handler bodies that touch Stripe yet.** This commit ships the actor DEFINITION + a pure
  **transition-table predicate** (which `status → status` is legal: `pending→{paid,cancelled,
  expired,failed}`, `paid→refunded`; everything else illegal/no-op), unit-tested in isolation,
  WITHOUT a runtime.
- **State-vs-bucket contract:** document that every op handler (G6/G7) writes the **bucket
  transition** (the authority, via `Submissions` `flipStatus`, `submissions.server.ts:346`) AND
  the actor State atomically within the handler; the actor State is a derived cache (Decision 1).

**Gate green:** `bun run typecheck` (the Order actor compiles against bumped encore —
`Actor.fromEntity` types resolve); `order.actor.test.ts` unit-tests the transition table
(legal/illegal) + a schema round-trip (encode→JSON→decode) WITHOUT a runtime; lint clean.

**Deps:** G3.

---

### G5 — `feat(order): widen bucket order status + markOrderCancelled/Refunded/Expired transitions`

**Files:** `app/lib/forms/order.ts`, `app/lib/forms/submissions.server.ts`,
`app/lib/forms/order.test.ts`, `app/lib/forms/submissions.server.test.ts`. Plus any read site
that pattern-matches `RegistrationOrder.status` (grep `status` over `app/` admin/read paths —
the backfill-hazard sweep).

**Scope:**
- Widen `RegistrationOrder.status` literal from `['pending','paid','failed','expired']` to
  `['pending','paid','failed','expired','cancelled','refunded']` (`order.ts:56`) — additive
  superset (Decision 5). Closed `Schema.Literals`, so a present-but-unknown token still fails
  decode; legacy paid/failed/expired orders decode unchanged.
- Add `markOrderCancelled` / `markOrderRefunded` / `markOrderExpired` transition helpers to
  `Submissions`, each built on the existing `flipStatus` guard discipline
  (`submissions.server.ts:346-465`, the same never-downgrade-a-terminal-state guard as
  `markOrderPaid`/`markOrderFailed`). `markOrderExpired`/`markOrderCancelled`: only from
  `pending`. `markOrderRefunded`: only from `paid`. Mirror `markOrderPaid`'s idempotency (a
  re-flip to the same terminal is a no-op).
- **Backfill-hazard sweep (MEMORY `cms-published-doc-backfill-hazard.md`):** find every read
  that switches on `status` (admin order views, any receipt/summary read on BOTH public and
  `/admin` draft reads) and ensure the two new arms are handled, not dropped. Cite each touched
  read in the commit body.

**Gate green:** `bun run typecheck`; `order.test.ts` round-trips an order at each new status;
`submissions.server.test.ts` covers each new transition + its guard (illegal source rejected,
terminal re-flip is a no-op); lint + full suite green.

**Deps:** G4. (Independent of G3's runtime — can land in parallel conceptually, but ordered
after G4 so the actor's status set and the bucket's are reconciled in one reviewable arc.)

---

### G6 — `feat(order): arm + settle handlers — wire the Order runner into server.ts`

**Files:** `app/lib/order/order.actor.ts` (handler layer), `app/lib/order/runner.server.ts`
(register handlers), `server.ts`, `app/lib/order/order.actor.test.ts`.

**Scope:**
- **`arm` handler:** record the entity at `pending` and persist/refresh the actor State from the
  frozen linkage. Re-assert (read-back) the bucket order exists at `pending` via
  `Submissions.getOrder` (`submissions.server.ts:143`) — the bucket is the authority; `arm`
  does NOT re-create the session (the action already did, G7). Idempotent: a duplicate `arm`
  send for the same `orderId` dedups (encore primaryKey dedup, `actor.ts:574-576`).
- **`settle` handler:** the post-payment continuation. On success ⇒ `pending → paid`: call
  `Submissions.markOrderPaid` (`submissions.server.ts:382`, the byte-identical `paidAt` freeze,
  `order.ts:62-71`) AND set State `paid`. On the async-payment-failed path the webhook resolves
  `settle` to a Failure ⇒ the handler/continuation flips bucket `failed`
  (`Submissions.markOrderFailed`) — **preserving the existing webhook behavior, no regression**
  (Decision 7). Read the FROZEN amount/receiptEmail back from the bucket — NEVER re-derive
  (Decision 6 freeze discipline).
- **`server.ts` (the `ServerLive` / runner side):** add the Order runner
  (`Order.runnerLayer(Order.MessageStorageLive)` provided `Order.ShardingConfigLive` + the
  registered `Actor.toLayer` handler layer) to the **long-lived `ServerLive`** composition
  (`server.ts:263-269`, the `HttpRouter.serve` layer that is `Layer.launch`-ed at `:269`,
  giving the runner's poll fiber a process-lifetime supervisor) — NOT the request-handler
  `makeAppLayer` graph (consumed once into the `AppRuntime` singleton, `runtime.ts:120`, never
  `Layer.launch`-ed). Gate the whole Order runner on `Env.database` Some so a DB-less deploy is
  unaffected and `Layer.launch(ServerLive)` still exits non-zero on missing REQUIRED config (the
  `StartupCheck` contract, `server.ts:249-252`). (cross-review-A mustFix #2 / cross-review-B
  mustFix #1.)
- **`runtime.ts` (the `AppRuntime` / sender side):** thread the **sender**
  (`ActorSenderLayer.layer`, `src/actor-sender.ts:42-46`) into `makeAppLayer` so routes/webhook
  can `send`/`peek`/`waitFor` — gated `Env.database` Some, exactly as `Storage`/`Payment` are
  optional in `makeAppLayer` (`runtime.ts:103-114`). **`ActorSenderLayer.layer` requires
  `MessageStorage | ShardingConfig` and provides NEITHER** (`src/actor-sender.ts:42-46`); and
  `fromSqlClient` consumes its own `ShardingConfig.layerDefaults` internally and does NOT
  re-export it (`src/storage.ts:145`) — so the sender side MUST be provided BOTH
  `Order.MessageStorageLive` (its `SqlClient` build, over the SAME shared DB file as the runner)
  **AND `Order.ShardingConfigLive` explicitly** (the SAME shared shard config the runner uses).
  This is the sender-requirement-leak fix (cross-review mustFix).
  - **Cross-runtime shard-parity invariant (gate-green check):** the sender's `ShardingConfig`
    (in `AppRuntime`) and the runner's `ShardingConfig` (in `ServerLive`) MUST be the identical
    `Order.ShardingConfigLive` (same shard count) — `ActorAddressResolverLayer.fromConfig`
    routes by shard count (`src/actor-address-resolver.ts`), so a divergent count makes the
    sender write a shard the runner never polls. Both sides import the one `Order.ShardingConfigLive`.
  - Add the Order sender handle to `AppServices` (`runtime.ts:29-39`) and any new error to
    `AppError` (`runtime.ts:40-53`).

**Gate green:** `bun run typecheck` (`AppServices`/`makeAppLayer` + `ServerLive` extension
typecheck, the runner composes; the sender layer has NO unsatisfied `ShardingConfig`/`MessageStorage`
requirement; `bun run build` succeeds); a test asserts the sender's and runner's
`ShardingConfig` are the same instance/shard-count (shard-parity); `order.actor.test.ts` drives
`arm` then resolves `settle` to Success against `Order.layerTest` + a fake `Submissions` —
asserts the bucket order is marked paid with a frozen `paidAt` and State is `paid`; resolving
`settle` to Failure marks bucket `failed`; lint + existing tests green. DB-less build still
launches.

**Deps:** G5.

---

### G7 — `refactor(registration): action sends Order.arm; refund op + cancel/expire handlers`

**Files:** `app/lib/forms/registration-action.ts`, `app/lib/order/order.actor.ts`,
`app/lib/payment.server.ts`, `app/lib/forms/registration-action.test.ts`,
`app/lib/payment.server.test.ts`, `app/lib/order/order.actor.test.ts`.

> This is high-blast-radius; sub-commit (G7.1 action wiring / G7.2 refund op / G7.3
> cancel+expire) per the global sub-commit guidance if the diff balloons. Each sub-commit
> compiles + passes gate.

**Scope:**
- **`registration-action.ts` (G7.1):** after the existing synchronous `createCheckoutSession` +
  `persistOrder` (the checkout block, `registration-action.ts:249-340` group + perRegistrant
  arms — UNCHANGED, the freeze + redirect/mail stays), **`send` the Order `arm` op** for each
  minted order (group: ONE keyed `requestFingerprint`, `registration-action.ts:168`;
  perRegistrant: N keyed `<fingerprint>:<index>`, `:177`). The action keeps the
  `groupSessionUrl` redirect (`:242`) / perRegistrant mail fan-out — `arm` is durable
  fire-and-forget, it does NOT block the redirect. Idempotency STRENGTHENS: a verbatim retry
  re-`send`s `arm` with the same `orderId` ⇒ encore dedups (no second entity), complementing the
  existing bucket-overwrite idempotency (`registration-action.ts` persist). Gate the `arm` send
  on `Env.database` Some (DB-less ⇒ skip the send, the bucket path is unchanged).
- **`payment.server.ts` (G7.2):** add a third op `createRefund` (mirror `createCheckoutSession`
  structure, `payment.server.ts:211-306`): import `PostRefunds` from
  `@distilled.cloud/stripe/Operations`, yield-first captured op handle, `idempotencyKey` on the
  HEADER (`payment.server.ts:251`), fail `PaymentDisabled` when `Env.stripe` None
  (`:202-205`), squash the SDK `Cause` into one `PaymentError` (`:255-268`). **Caveat:**
  `PostRefunds` refunds a `payment_intent`/`charge`, not a session — so `createRefund` takes a
  `paymentIntentId` (or resolves it from `sessionId` via a session-retrieve op first; the
  simplest correct path is to persist the PaymentIntent id on the order at `settle` time from the
  webhook's session object — note as a sub-task). Extend `testLayer` (`payment.server.ts:345`) +
  a `CreateRefundCall` capture so refund wiring is network-free testable.
- **`refund` handler (G7.2):** guard current State `paid` (refunding a pending/cancelled order
  is a typed `RefundNotAllowed` domain error — make-impossible-states); yield
  `Payment.createRefund` against the FROZEN `RegistrationOrder.amount` read back via
  `Submissions.getOrder` (`submissions.server.ts:143` — never re-derive); set State `refunded` +
  `Submissions.markOrderRefunded` (G5).
- **`cancel` + `expire` handlers (G7.3):** `cancel` ⇒ `pending → cancelled`
  (`Submissions.markOrderCancelled` + State; no Stripe call needed beyond optionally expiring the
  Checkout session). `expire` ⇒ `pending → expired` (`Submissions.markOrderExpired` + State),
  reading the order's frozen `deadline` (`order.ts:61`). Each enforces the G4 transition table
  (illegal transitions are typed no-ops, the `flipStatus` never-downgrade discipline).
- **Webhook 200-ignore for `charge.refunded` (G7.2):** narrow `charge.refunded` to a 200-ignore
  in the webhook type-narrow (`api.stripe-webhook.ts:88-89`) so a Stripe-side refund doesn't
  400. (refund is operator-initiated, not Stripe-push — no new event handler needed.)

**Gate green:** `bun run typecheck`; the existing registration-action checkout test now also
asserts each minted order `send`s `arm` (group one, perRegistrant N, zero-amount none, verbatim
retry dedups to no second entity) over `Order.layerTest` + `Payment.testLayer`;
`order.actor.test.ts` drives a paid Order → `refund` (asserts `createRefund` called with the
frozen amount, State `refunded`, bucket `refunded`) and `refund`-while-pending →
`RefundNotAllowed`; `cancel`/`expire` legal+illegal transitions; `payment.server.test.ts` covers
`createRefund` disabled-gate + idempotency-key; lint + full suite green.

**Deps:** G6.

---

### G8 — `feat(order): webhook resolves the settle ExecId via SQL MessageStorage`

**Files:** `app/routes/api.stripe-webhook.ts`, `app/routes/api.stripe-webhook` test (extend the
existing `app/lib/forms/webhook.server.test.ts`).

**Scope:**
- Keep the verify → type-narrow → decode → `payment_status==='paid'` → amount-check spine
  UNCHANGED (`api.stripe-webhook.ts:78-122` — the verified-amount guard at `:122` is the freeze
  check and STAYS, returning 400 on mismatch with the order left pending).
- On a matched paid `checkout.session.completed`, **in addition to** the existing
  `submissions.markOrderPaid` flip (`:125`), drive the Order `settle` op through the SAME SQL
  MessageStorage. The webhook holds only `metadata.orderId` (`:105`), and `settle`'s `id` is a
  pure fn of `orderId` (G4), so the webhook resolves the op WITHOUT reconstructing the full
  payload: **`send` the `settle` op with `{ orderId, ...sessionFields }` then
  `Order.settle.waitFor({ orderId })`** (or `sendAndAwait({ orderId, ... }, { timeout })`) — the
  runner consumes the `settle` send, runs the `pending → paid` continuation + State `paid`, and
  writes the reply; `waitFor`/`peek` (keyed by the `{ orderId }`-derived ExecId,
  `actor.ts:1383-1385`) observe it terminal Success. **Do NOT build the ExecId via
  `entityIdCodec` + `makeExecId`** — `entityIdCodec` encodes the entityId TUPLE (`:`-joined) and
  `makeExecId` only brands a string; neither produces the `entityId\x00tag\x00primaryKey` execId
  format (Decision 4, `entity-id-codec.ts:38`, `receipt.ts:14`, `actor.ts:1383-1385`). The
  op-method path (`waitFor`/`peek`/`sendAndAwait` on `Order.settle`) IS the execId reconstruction
  — it runs the same per-op `execId` closure internally. The bucket `markOrderPaid` remains the
  receipt authority; the actor mirrors it.
- On `checkout.session.async_payment_failed` (`:107-112`): keep the existing
  `markOrderFailed`, AND resolve `settle` to a Failure (or `send` `Order.cancel`) → State/bucket
  `failed`. **No regression** (Decision 7, cross-review mustFix).
- Idempotency: a replayed `checkout.session.completed` re-resolving an already-terminal ExecId
  is a no-op (encore dedup, `actor.ts:574-576`), `paidAt` byte-identical (`order.ts:62-71`,
  `c8c4abd`).
- Gate the actor-resolution on `Env.database` Some — DB-less ⇒ the webhook degrades to the
  existing bucket-only flip (backward compatible). Map any new failure into the route's
  `catchTags` (`api.stripe-webhook.ts:128-136`) preserving the 200/400/503 contract Stripe reads.

**Gate green:** `bun run typecheck`; the webhook test drives the full loop against
`Order.layerTest` + the in-process runner: `arm` an order → forge a signed
`checkout.session.completed` with matching amount → assert the `settle` op resolves Success, the
Order State `paid`, the bucket order `paid` with a frozen `paidAt`, AND a verbatim REPLAY POST
is a 200 no-op leaving `paidAt` byte-identical; an amount-mismatch POST leaves the op unresolved
+ order pending + 400; the no-DB path still 200s on the bucket flip; an `async_payment_failed`
flips `failed` on both. **ExecId round-trip assertion (Decision 4):** assert the action-side
`Order.settle.executionId(armPayload)` === the webhook-side `Order.settle.executionId({ orderId })`
=== the manually formatted `makeExecId(\`${orderId}\x00settle\x00${orderId}\`)`, so the webhook's
`{ orderId }`-only resolution lands on the exact ExecId the runner replied to. Lint + full suite
green.

**Deps:** G7.

---

### G9 — `feat(order): deadline-sweep fiber + durable-lifecycle integration capstone`

**Files:** NEW `app/lib/order/sweep.server.ts`, `server.ts`, NEW
`app/lib/order/lifecycle.test.ts`, NEW `app/lib/order/sweep.server.test.ts`.

**Scope:**
- **Deadline sweep (`sweep.server.ts`):** an in-process scheduled Effect fiber (no external cron
  dep — self-contained, mirroring how the app stays self-wired) launched in `ServerLive`
  (`server.ts:263-269`, the long-lived layer — a sweep needs a process-lifetime fiber, NOT
  per-request). It lists pending orders past `deadline` (read the bucket orders under
  `submissions/registration/orders/*.json`, OR `listStateEntityIds` over the Order entity,
  `effect-encore/src/index.ts:5`) and `send`s `Order.expire` to each (`pending → expired` only;
  a `paid`/`refunded`/`cancelled` order is untouched — the `expire` handler's State guard,
  make-impossible-states). Idempotent: re-sweeping an already-expired/paid order is a no-op.
  Gate on `Env.database` Some. Also expose a manual `/admin`-guarded trigger route
  (`auth.server.ts` gate) and document the optional external cron hook without committing infra.
- **Late-payment-on-expired race:** a `checkout.session.completed` arriving AFTER `expire` →
  `expired` must NOT silently resurrect to `paid` — `expire → expired` is terminal for the op,
  so a late paid reply on an expired entity is rejected/logged. The product decision (honor vs
  auto-refund) is an Open Question; the code defaults to reject-and-log, surfacing it.
- **Lifecycle capstone (`lifecycle.test.ts`)** — PLAN B G7, the strongest single artifact in
  either source plan. End-to-end over the REAL `Order.MessageStorageLive` (SQLite `:memory:`) +
  the in-process runner + a network-free `Payment.testLayer`, exercising every edge as one
  durable narrative: `pending → paid` (arm → webhook resolve), `pending → cancelled` (cancel),
  `paid → refunded` (refund), `pending → expired` (sweep), AND the ILLEGAL transitions
  (refund-while-pending, expire-while-paid, cancel-while-paid) all rejected by State guards.
  Assert the cross-cutting invariants:
  1. the `settle` ExecId is stable across a webhook REPLAY so `paidAt` is byte-identical
     (`order.ts:62-71`, `c8c4abd`);
  2. the frozen amount/receiptEmail are never re-derived by any op (read back from the bucket,
     compare to the create-time freeze — `registration-action.ts:258`);
  3. the actor State and the bucket `RegistrationOrder.status` never diverge (every transition
     writes both within the handler).

**Gate green:** `bun run typecheck` && `bun run build` (`server.ts` composes the sweep fiber);
`sweep.server.test.ts` seeds two pending (one past-deadline, one future) + one paid past-deadline,
runs the sweep, asserts ONLY the past-deadline pending one → expired (State + bucket), the others
untouched, a second sweep is a no-op; `lifecycle.test.ts` covers all 5 states + 3 illegal-
transition rejections + the 3 invariants against the durable SQLite-backed Order; DB-less build
still launches; lint + full suite green.

**Deps:** G8.

---

## 5. Divergences from both source plans

| Topic | PLAN A | PLAN B | This plan (and why) |
|---|---|---|---|
| **Runner model** | Runner in the request-handler `makeAppLayer` graph (G6) then "must be long-lived" (G9) — self-contradictory | "No runner — `Client.layer.fromConfig`" (false: `Client` unexported; `fromConfig` mailbox doesn't run handlers) | **In-process Sharding runner in the long-lived `Layer.launch`-ed `ServerLive`** (`server.ts:263-269`); the request side (`AppRuntime` singleton, `runtime.ts:120`) is a sender. The two graphs share one sqlite FILE (`cluster_messages`/`cluster_replies` rows), NEVER `':memory:'`. Verified template `send-and-await.test.ts:63-68`. Resolves both cross-reviews' #1/#2 mustFix. |
| **encore publish dependency** | Assumes a new publish; flags it as prereq | Assumes the unpublished `Client`/`State<A>` reshape (BLOCKED) | **No dependency on the unpublished reshape** — uses shipped `fromSqlClient` + the per-op `sendAndAwait`/`waitFor`/`peek` methods + `ActorSenderLayer`. HEAD `0.12.8` already suffices. Removes the blocker. |
| **process op shape** | One `process` op creates session + suspends | One `process` op creates session + returns URL + suspends (incoherent for async runner) | **Split:** action creates session synchronously (keeps redirect), then `send`s a durable `arm` op; the webhook resolves a `settle` op. No "handler returns URL before suspend" foot-gun. |
| **registration-action integration** | Never touched (dual-write hazard, named but unfixed) | `Order.process` dispatch replaces inline checkout | **Action keeps the synchronous checkout** (no redirect regression) and ADDS an `arm` send. Wraps, not replaces. |
| **`@effect/sql` dep** | Correctly inside `effect/unstable` (no separate dep) | Adds `@effect/sql` separately (wrong vs tree) | **Inside `effect/unstable`** — only the sqlite-bun driver is added. |
| **Status set** | Actor superset, reconciliation deferred to G5 | Actor-only authority, bucket unchanged | **Widen the bucket** to the superset with a read-boundary backfill sweep; `failed` and `cancelled` stay distinct. |
| **`async_payment_failed`** | Unhandled (regression) | Resolves to Failure / cancel | **Preserved + additively resolves `settle` to Failure.** |
| **Capstone test** | Scattered per-commit gates | Single durable-lifecycle narrative (G7) | **Adopted as G9** — strongest artifact, all 5 states + 3 illegal transitions + 3 invariants. |

---

## 6. Risks

1. **Effect version skew (highest, front-loaded into G0).** beta.60 → beta.75 spans real
   Schema/Layer/Config API drift across the existing app (`payment.server.ts`,
   `runtime.ts`, `env.server.ts`, every Schema usage). G0 is its own commit; ALL fallout fixed
   there before anything depends on it. If it balloons, sub-commit by subsystem.
2. **DB backing — a PRE-G0 BLOCKER, not a "confirm before G2".** Because the runner
   (`ServerLive`) and the senders (`AppRuntime`) are TWO SEPARATE layer graphs that can ONLY
   coordinate through durable backing (§1 two-runtime topology), `':memory:'` is **impossible in
   production** — it gives the two graphs two disjoint in-memory DBs and the
   route→runner→webhook loop never closes. The choice is **sqlite FILE on a Railway persistent
   volume** vs **`@effect/sql-pg` + Railway Postgres**, and it gates the WHOLE architecture (G2's
   adapter AND the cross-runtime sharing story), so it MUST be resolved **before G0** (Open
   Question 2). A persistent volume is also required for durability: an ephemeral FS loses
   `cluster_messages`/`cluster_replies` between deploys, breaking in-flight (suspended `settle`)
   orders. If no volume is mountable, the plan flips to `@effect/sql-pg` + Railway Postgres (add
   the dep in G0, connection-pool note, localized to `Order.SqlClientLive` in G2). The G3
   cross-runtime test (shared FILE, with a `':memory:'` negative control) is the guard that
   proves the seam.
3. **Runner consumes mailbox at `entityMessagePollInterval` latency, not instantly**
   (`actor-mailbox.ts:30-33`). Fine for the durable lifecycle (the webhook resolve is async
   anyway), but the `arm`→entity-exists window is poll-bounded. The interactive redirect does NOT
   depend on it (the action has the URL synchronously). Tune `ShardingConfig` poll interval if a
   sweep/settle feels laggy.
4. **PaymentIntent vs sessionId for refund (G7).** `PostRefunds` refunds a
   `payment_intent`/`charge`, but the order stores only `sessionId` (`order.ts:50`). G7 must
   persist the PaymentIntent id (available on the webhook's session object at `settle` time) or
   add a session-retrieve op. Note as a G7 sub-task; do not stub.
5. **Dual source-of-truth coherence.** The actor State + the bucket `RegistrationOrder` both
   model the payment lifecycle. Mitigated by Decision 1 (bucket = authority, State = derived
   cache; every handler writes both within one handler; restart rebuilds from bucket + reply
   log) and asserted by G9 invariant 3. Still a coherence hazard if a handler writes one and not
   the other — the handler MUST write both atomically.
6. **Per-registrant cardinality fan-out.** `perRegistrant` mints N orders keyed
   `<fingerprint>:<index>` (`order.ts:18-21`, `registration-action.ts:177`). The Order entity's
   `id`-fn (one entity per `orderId`) handles this since each gets its own `orderId`, but the
   action `send`s N `arm` ops and the sweep handles N entities per request — G7/G9 must cover the
   N-per-request case, not just the group 1-per-request case.
7. **Late-payment-on-expired (G9).** A `checkout.session.completed` after `expire → expired` is a
   real money/support hazard. Code defaults to reject-and-log; the honor-vs-auto-refund policy is
   an Open Question to settle before launch.
8. **ExecId resolution (G8) hinges on the `id`-fn purity (Decision 4).** The webhook resolves the
   `settle` op by calling `Order.settle.waitFor({ orderId })` — which works ONLY because
   `id: (p) => p.orderId` ignores every other payload field (so the `{ orderId }`-only payload
   derives the same ExecId as the action-side full payload, `actor.ts:1380-1385`). If G4's
   `id`-fn derives the key from anything beyond `orderId` (e.g. a payload hash), the webhook
   (which has only `metadata.orderId`) lands on a DIFFERENT ExecId and never sees the reply. G4
   MUST make `id` a pure string fn of `orderId`; the G3/G8 round-trip test
   (`executionId({orderId,...}) === executionId({orderId})`) is the guard. Do NOT attempt to
   rebuild the ExecId via `entityIdCodec`/`makeExecId` (neither produces the execId format —
   Decision 4).

---

## 7. Open questions

1. **Exact encore version to pin in G0.** HEAD is `0.12.8` and already ships the per-op
   `sendAndAwait`/`waitFor`/`peek` methods (`actor.ts:586,604,607,622`) + `fromSqlClient` +
   `fromSqlClientWithShardingConfig` + `entityIdCodec` + `ActorSenderLayer`. Confirm `0.12.8` is
   published to the registry GYC pulls from (or publish it via the changeset flow first). This
   plan does NOT require the `Client`/`State<A>` reshape, so no further encore work blocks the
   start — confirm the publish state.
2. **DB target — RESOLVE BEFORE G0 (pre-G0 BLOCKER, Risk 2): sqlite FILE on a Railway persistent
   volume vs Railway Postgres + `@effect/sql-pg`?** Because the two runtimes share state only via
   durable backing, `':memory:'` is impossible in production; this choice settles G2's adapter,
   whether G0 adds `@effect/sql-pg`, and the whole cross-runtime sharing story. NOT deferrable to
   G2.
3. **Refund trigger surface (G7).** Operator action via `/admin` route (`auth.server.ts` gate),
   CLI, or Stripe-dashboard-initiated (`charge.refunded` → `Order.refund`)? The plan builds the
   op + a manual `/admin` entrypoint; the operator UX is unspecified.
4. **Late-payment-on-expired policy (G9).** Honor the payment (resurrect → paid + ship) or
   auto-refund via the G7 refund path? Product/money decision.
5. **Sweep trigger (G9).** In-process scheduled fiber (plan default, self-contained) vs external
   cron hitting the `/admin` route? Depends on whether Railway runs a single always-on instance
   (in-process fine) or scales/sleeps (needs external trigger). Single-process is also the
   runner assumption (Risk 3 / single-node) — if GYC ever scales to multiple web processes
   against one DB, the runner must move to a dedicated worker process (the
   `Client.layer.fromSharding` path) — flag the flip-trigger.
6. **Branch base.** This plan stacks `feat/order-workflow` ON TOP of `feat/registrar` (PR #35),
   which already has `Payment`/`RegistrationOrder`/webhook/`Submissions`. Confirm #35 lands first
   (or this stays a child branch) so G7's `payment.server.ts` `createRefund` addition doesn't
   conflict with an in-flight registrar change.
