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
 *      a no-op, mirroring the `c8c4abd` idempotency fix) and return **200**.
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

    // (6) Paid + amounts match ⇒ flip to paid (idempotent on replay) and ack 200.
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
