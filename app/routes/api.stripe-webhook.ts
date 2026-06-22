import { Effect, Option, Schema } from 'effect';

import { Env } from '~/lib/env.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction } from '~/lib/effect/route';
import { Submissions } from '~/lib/forms/submissions.server';
import { Order } from '~/lib/order/runner.server';
import { isTerminal } from 'effect-encore';
import { Payment } from '~/lib/payment.server';
import { Cents } from '~/lib/forms/pricing';

/**
 * The Stripe webhook endpoint (registrar plan C8) — a top-level, NON-localized
 * POST route (`/api/stripe/webhook`, a sibling of `admin/login`, OUTSIDE the
 * `:lang?` tree and OUTSIDE the `/admin` guard layout) that reconciles the frozen
 * `RegistrationOrder` records against Stripe's verified events.
 *
 * The flow (Decision 7 / 2b.6, the verified-amount guard):
 *
 *   1. Read the RAW body with `request.text()` **before any parse** — the HMAC is
 *      over the exact bytes Stripe signed, so a reserialized JSON would never
 *      verify. RR7 does not parse a POST body unless a loader/action asks for it,
 *      and this is a top-level route with no middleware in front, so the raw bytes
 *      arrive intact (Risk 2: raw-body webhook in RR7).
 *   2. `Payment.constructEvent(raw, signature)` verifies the `Stripe-Signature`
 *      (HMAC-SHA256, 300s tolerance — WebCrypto, no network) and parses the event.
 *      A forged/missing/expired signature ⇒ `PaymentWebhookError` ⇒ **400** so
 *      Stripe retries. `Env.stripe` `None` (unconfigured on-site path) ⇒
 *      `PaymentDisabled` ⇒ **503** (the endpoint is inert until the gate flips).
 *   3. Narrow on `event.type`: only `checkout.session.completed` /
 *      `checkout.session.async_payment_failed` are reconciled — the registrar
 *      hands the visitor off to a HOSTED Stripe Checkout Session (the on-site path
 *      redirects to `session.url`), so the SESSION's completion is the payment's
 *      source of truth, NOT a bare PaymentIntent. Every OTHER type is a benign
 *      **200 ignore** (Stripe sends many event kinds to one endpoint — acking them
 *      keeps the endpoint healthy without acting).
 *   4. Decode the session object (`event.data.object`) for its `id`, `amount_total`
 *      (minor units), `payment_status`, and `metadata.orderId`. A malformed payload
 *      ⇒ **400**.
 *   5. On a completed session, require `payment_status === 'paid'` (the visitor
 *      actually paid; a `no_payment_required` / `unpaid` completion is not a
 *      settlement) AND **verify the charged `amount_total` against the order's
 *      FROZEN `amount`** BEFORE marking paid: a mismatch means the charge does not
 *      match what the order recorded (tampering or an upstream bug) ⇒ the order
 *      STAYS pending, **400**. Only a paid completion with an exact amount match
 *      flips the order to `paid`.
 *   6. Mark the order `paid` / `failed` (idempotent — replaying the same event is
 *      a no-op, mirroring the `c8c4abd` idempotency fix). The bucket flip is the
 *      RECEIPT AUTHORITY and STAYS exactly as before.
 *   7. (order-workflow G8) ADDITIONALLY drive the durable Order `settle` op
 *      through the SAME SQL MessageStorage the `ServerLive` runner consumes, so
 *      the durable lifecycle advances `pending → paid` (a `completed` paid event)
 *      / resolves to a `SettleFailed` Failure (an `async_payment_failed` event).
 *      The webhook holds only `metadata.orderId`, and `settle`'s `id` is a pure fn
 *      of `orderId` (G4 / Decision 4), so it resolves the op WITHOUT
 *      reconstructing the full payload — `send` then `waitFor({ orderId })`. This
 *      is GATED on `Env.database` Some: a DB-less deploy has no runner and
 *      degrades to the bucket-only flip (backward compatible). The settle-drive is
 *      COMPLEMENTARY to the bucket authority, never a gate on it — a settle infra
 *      fault is logged + swallowed (the bucket order is already durably paid/failed
 *      and the runner reconciles the durable lifecycle off the persisted `send`),
 *      so it never changes the 200/400/503 the bucket flip earned (Decision 1/7).
 *      Idempotent: a replayed event re-resolves an already-terminal ExecId to a
 *      no-op (encore dedup), `paidAt` byte-identical.
 *
 * The route returns plain `Response`s (Stripe reads the STATUS, not an HTML error
 * page): the verify/lookup failures are mapped to their codes via `catchTags` so
 * the route never throws into the app's HTML error pipeline.
 */

/**
 * The slice of a Stripe Checkout Session the reconcile needs: its `id`, the
 * charged `amount_total` (minor units, decoded through the `Cents` brand so a
 * negative/non-int fails the decode), the `payment_status` (the session only
 * settles an order when this is `'paid'`), and the `metadata` we tagged the
 * session with at create-session (`{ orderId, mode }`). We decode ONLY these
 * fields off the open event object — `derive-dont-sync` keeps the wire shape
 * narrow to exactly what is reconciled.
 */
const WebhookSession = Schema.Struct({
  id: Schema.String,
  amount_total: Cents,
  payment_status: Schema.Literals(['no_payment_required', 'paid', 'unpaid']),
  metadata: Schema.Struct({ orderId: Schema.String }),
});
const decodeWebhookSession = Schema.decodeUnknownEffect(WebhookSession);

/** A bare status response — Stripe acts on the code, not the body. */
const status = (code: number): Response => new Response(null, { status: code });

export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const payment = yield* Payment.Service;
  const submissions = yield* Submissions.Service;
  const env = yield* Env.Service;

  // (G8) Drive the durable Order `settle` op through the SAME SQL MessageStorage
  // the `ServerLive` runner consumes. The webhook holds only `metadata.orderId`,
  // and `settle`'s `id` is a pure fn of `orderId` (Decision 4), so the op
  // resolves WITHOUT reconstructing the full payload: `send` the settle, then
  // `waitFor` a terminal reply keyed off the `{ orderId }`-derived ExecId. This
  // is COMPLEMENTARY to the bucket flip (the receipt authority), so a settle
  // infra fault — or the durable Failure the `async_payment_failed` path
  // intentionally resolves to (`outcome: 'failed'` ⇒ a `SettleFailed` reply) — is
  // logged + swallowed: the bucket order is ALREADY durably paid/failed and the
  // runner reconciles the durable lifecycle off the persisted `send`, so the
  // settle-drive NEVER changes the 200/400/503 the bucket flip earned (its error
  // channel is collapsed to `never`). Gated on `Env.database` Some — a DB-less
  // deploy has no runner, so it skips the drive and degrades to the bucket-only
  // flip (backward compatible). `outcome` defaults to `'paid'` (the absent
  // `checkout.session.completed` path); the `async_payment_failed` path passes
  // `'failed'` so the durable reply mirrors the bucket `failed` flip (Decision 7).
  const settleOrder = (
    orderId: string,
    outcome: 'paid' | 'failed',
    sessionId: string,
  ): Effect.Effect<void, never, Order.SenderServices> =>
    Option.isNone(env.database) ?
      Effect.void
    : Order.Entity.settle.send({
        orderId,
        outcome,
        sessionId,
        paymentIntentId: undefined,
      }).pipe(
        // Wait for the op to reach a terminal reply (Success for `'paid'`, the
        // durable `SettleFailed` Failure for `'failed'`) so the webhook observes
        // the runner completed the continuation. A non-terminal/timeout is
        // tolerated — the durable `send` already landed and the runner reconciles
        // it; the bucket authority is unaffected either way.
        Effect.andThen(
          Order.Entity.settle.waitFor(
            { orderId, outcome, sessionId, paymentIntentId: undefined },
            { filter: (result) => isTerminal(result) },
          ),
        ),
        Effect.asVoid,
        // BOUND the wait: `waitFor` polls the persisted reply at 200ms FOREVER
        // until the filter is true (no built-in timeout). That termination
        // silently ASSUMES a live consumer — but in the single-instance topology
        // the runner/sweep fiber can defect while the HTTP server keeps serving
        // (a poll-fiber crash kills the consumer, not the web server). With a dead
        // runner the reply never goes terminal, so an unbounded `waitFor` would
        // hang the request fiber forever: Stripe times out and retries the
        // already-paid event indefinitely, and the 200/400/503 the bucket flip
        // earned is never returned. The bound injects a `TimeoutException` the
        // `catchCause` below swallows (error channel stays `never`), degrading a
        // non-replying runner to the swallow-and-200 path this drive already
        // claims — the durable `send` already landed; the runner reconciles it on
        // recovery; the bucket authority is unaffected.
        Effect.timeout('5 seconds'),
        Effect.catchCause((cause) =>
          Effect.logError(
            `Order.settle drive failed for ${orderId} (bucket order is the authority; runner reconciles the durable lifecycle)`,
            cause,
          ),
        ),
      );

  return yield* Effect.gen(function* () {
    // (1) RAW body, read BEFORE any parse — the HMAC is over these exact bytes.
    const raw = yield* Effect.promise(() => request.text());
    const signature = request.headers.get('stripe-signature');

    // (2) Verify + parse (failures mapped to codes by the `catchTags` below).
    const event = yield* payment.constructEvent(raw, signature);

    // (3) Narrow on the event type. Only the two checkout-session outcomes
    // reconcile; everything else is a benign 200 ack.
    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_failed'
    ) {
      return status(200);
    }

    // (4) Decode the session object. A malformed payload ⇒ 400.
    const data = event.data;
    const sessionObject =
      typeof data === 'object' && data !== null && 'object' in data
        ? (data as { readonly object: unknown }).object
        : undefined;
    const session = yield* decodeWebhookSession(sessionObject).pipe(
      Effect.option,
    );
    if (session._tag === 'None') return status(400);
    const { amount_total, payment_status, metadata } = session.value;
    const { orderId } = metadata;

    if (event.type === 'checkout.session.async_payment_failed') {
      // A failed async payment never amount-checks (there is nothing to reconcile
      // against a frozen amount); flip the order to `failed`. A `NotFound` (an
      // event for an order that has not landed) ⇒ 400 via the `catchTags`.
      yield* submissions.markOrderFailed('registration', orderId);
      // (G8) ADDITIONALLY resolve the durable `settle` to a Failure (`outcome:
      // 'failed'` ⇒ a `SettleFailed` reply) — preserving the bucket `failed`
      // flip with NO regression (Decision 7). Gated + swallowed (the bucket is
      // the authority).
      yield* settleOrder(orderId, 'failed', session.value.id);
      return status(200);
    }

    // (5) A completed session only settles an order when the visitor actually
    // PAID — a `no_payment_required` / `unpaid` completion is not a settlement, so
    // the order stays pending (200 ack; nothing to retry). Then re-read the order
    // and verify the CHARGED `amount_total` against its FROZEN amount BEFORE
    // marking paid. A mismatch ⇒ the order stays pending, 400.
    if (payment_status !== 'paid') return status(200);
    const order = yield* submissions.getOrder('registration', orderId);
    if (order.amount !== amount_total) return status(400);

    // (6) Paid + amounts match ⇒ flip to paid (idempotent on replay) — the
    // bucket RECEIPT AUTHORITY, unchanged.
    yield* submissions.markOrderPaid('registration', orderId);
    // (7, G8) ADDITIONALLY drive the durable Order `settle` (`outcome: 'paid'`)
    // so the durable lifecycle advances `pending → paid` and the runner mirrors
    // the bucket flip into actor State. Gated on `Env.database` Some + swallowed
    // (the bucket flip already earned the 200). Idempotent on replay (encore
    // dedup, `paidAt` byte-identical).
    yield* settleOrder(orderId, 'paid', session.value.id);
    return status(200);
  }).pipe(
    Effect.catchTags({
      // A bad/missing/expired signature or unparseable body ⇒ 400 so Stripe
      // retries; an order the event names that has not landed ⇒ 400 likewise.
      'Payment.WebhookError': () => Effect.succeed(status(400)),
      'Storage.NotFound': () => Effect.succeed(status(400)),
      // The on-site path is unconfigured (`Env.stripe` None) ⇒ the endpoint is
      // inert: 503, so Stripe backs off until the gate flips.
      'Payment.Disabled': () => Effect.succeed(status(503)),
    }),
  );
});
