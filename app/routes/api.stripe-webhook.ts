import { Effect, Schema } from 'effect';

import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction } from '~/lib/effect/route';
import { Submissions } from '~/lib/forms/submissions.server';
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
 *   3. Narrow on `event.type`: only `payment_intent.succeeded` /
 *      `payment_intent.payment_failed` are reconciled; every OTHER type is a
 *      benign **200 ignore** (Stripe sends many event kinds to one endpoint —
 *      acking them keeps the endpoint healthy without acting).
 *   4. Decode the intent object (`event.data.object`) for its `id`, `amount`
 *      (minor units), and `metadata.orderId`. A malformed payload ⇒ **400**.
 *   5. **Verify the charged `amount` against the order's FROZEN `amount`** BEFORE
 *      marking paid: a mismatch means the charge does not match what the order
 *      recorded (tampering or an upstream bug) ⇒ the order STAYS pending, **400**.
 *      Only an exact match flips the order to `paid`.
 *   6. Mark the order `paid` / `failed` (idempotent — replaying the same event is
 *      a no-op, mirroring the `c8c4abd` idempotency fix) and return **200**.
 *
 * The route returns plain `Response`s (Stripe reads the STATUS, not an HTML error
 * page): the verify/lookup failures are mapped to their codes via `catchTags` so
 * the route never throws into the app's HTML error pipeline.
 */

/**
 * The slice of a Stripe PaymentIntent the reconcile needs: its `id`, the charged
 * `amount` (minor units, decoded through the `Cents` brand so a negative/non-int
 * fails the decode), and the `metadata` we tagged the intent with at create-intent
 * (`{ orderId, mode }`). We decode ONLY these fields off the open event object —
 * `derive-dont-sync` keeps the wire shape narrow to exactly what is reconciled.
 */
const WebhookIntent = Schema.Struct({
  id: Schema.String,
  amount: Cents,
  metadata: Schema.Struct({ orderId: Schema.String }),
});
const decodeWebhookIntent = Schema.decodeUnknownEffect(WebhookIntent);

/** A bare status response — Stripe acts on the code, not the body. */
const status = (code: number): Response => new Response(null, { status: code });

export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const payment = yield* Payment.Service;
  const submissions = yield* Submissions.Service;

  return yield* Effect.gen(function* () {
    // (1) RAW body, read BEFORE any parse — the HMAC is over these exact bytes.
    const raw = yield* Effect.promise(() => request.text());
    const signature = request.headers.get('stripe-signature');

    // (2) Verify + parse (failures mapped to codes by the `catchTags` below).
    const event = yield* payment.constructEvent(raw, signature);

    // (3) Narrow on the event type. Only the two payment-intent outcomes
    // reconcile; everything else is a benign 200 ack.
    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed'
    ) {
      return status(200);
    }

    // (4) Decode the intent object. A malformed payload ⇒ 400.
    const data = event.data;
    const intentObject =
      typeof data === 'object' && data !== null && 'object' in data
        ? (data as { readonly object: unknown }).object
        : undefined;
    const intent = yield* decodeWebhookIntent(intentObject).pipe(Effect.option);
    if (intent._tag === 'None') return status(400);
    const { amount, metadata } = intent.value;
    const { orderId } = metadata;

    if (event.type === 'payment_intent.payment_failed') {
      // A failed intent never amount-checks (there is nothing to reconcile
      // against a frozen amount); flip the order to `failed`. A `NotFound` (an
      // event for an order that has not landed) ⇒ 400 via the `catchTags`.
      yield* submissions.markOrderFailed('registration', orderId);
      return status(200);
    }

    // (5) Re-read the order and verify the CHARGED amount against its FROZEN
    // amount BEFORE marking paid. A mismatch ⇒ the order stays pending, 400.
    const order = yield* submissions.getOrder('registration', orderId);
    if (order.amount !== amount) return status(400);

    // (6) Amounts match ⇒ flip to paid (idempotent on replay) and ack 200.
    yield* submissions.markOrderPaid('registration', orderId);
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
