export * as Payment from './payment.server';

import {
  Cause,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  Credentials,
  DEFAULT_API_BASE_URL,
  Webhooks,
} from '@distilled.cloud/stripe';
import {
  GetCheckoutSessionsSession,
  PostCheckoutSessions,
  PostRefunds,
} from '@distilled.cloud/stripe/Operations';

import type { Cents, CurrencyCode } from './forms/pricing';
import { Env } from './env.server';

/**
 * The first-party payment boundary — a `Payment` `Context.Service` over the
 * distilled Stripe SDK (`@distilled.cloud/stripe`), mirroring the house service
 * pattern (`submissions.server.ts:68-94`, `sendgrid.server.ts:25-33`). It exposes
 * exactly two operations the registrar needs:
 *
 *   - `createCheckoutSession` — mint a Stripe **Checkout Session** (the hosted
 *     redirect flow) for one frozen amount and return its `{ sessionId, url }`.
 *     The registrar redirects the browser to that hosted `url`; the payment is
 *     actually confirmed ON Stripe (a card is collected + charged there), and the
 *     `checkout.session.completed` webhook (C8) reconciles the order. The single
 *     `price_data` line item carries the SERVER-frozen `amount`/`currency` (no
 *     client-supplied price), `mode: 'payment'`, `customer_email` = the frozen
 *     `receiptEmail` (the nominated group payer or per-registrant recipient,
 *     Decision 2b.6), `success_url`/`cancel_url` (absolute, lang-aware), and the
 *     `orderId` linkage on BOTH `client_reference_id` and `metadata` so the
 *     webhook reconciles by it. The `idempotencyKey` rides the request's
 *     `Idempotency-Key` HEADER (NOT the body), so a verbatim retry of the same
 *     checkout replays the first session rather than minting a second
 *     (Decision 2 / 2b: the key derives from the request fingerprint + mode).
 *   - `constructEvent` — verify a webhook's `Stripe-Signature` against the raw
 *     body (HMAC-SHA256, 300s tolerance) and parse it to a `StripeEvent`. The
 *     webhook route (C8) reconciles orders off the verified event.
 *
 * Why Checkout (hosted redirect) over a bare PaymentIntent: a created
 * PaymentIntent still needs a payment method + a client-side confirmation, so the
 * old `createIntent` path discarded the `clientSecret`, redirected to success, and
 * left the order pending with NO payment ever collected (the `--deep` BLOCKER).
 * A Checkout Session moves the card collection + charge onto Stripe's hosted page;
 * the order legitimately stays `pending` until the `checkout.session.completed`
 * webhook confirms it.
 *
 * Principles (`~/.brain/principles`):
 *
 *   - `small-interface-deep-implementation`: two operations, no leaked SDK types.
 *     `amount` is raw minor units (the `Cents` brand already guarantees an
 *     integer ≥0 — no dollar→cents helper); the hosted `url` is the only thing a
 *     caller needs back (plus the `sessionId` it freezes onto the order for the
 *     webhook to reconcile by).
 *   - `make-impossible-states-unrepresentable`: the registrar lands behind the
 *     `Env.stripe` `None`-gate (Stripe test mode). When stripe is unconfigured
 *     BOTH operations fail `PaymentDisabled` — there is no half-wired "configured
 *     but no key" path — mirroring `SendgridDisabled` (`sendgrid.server.ts:40-44`).
 *     The distilled transport (`FetchHttpClient`) + `Credentials` (a key off the
 *     gate) are supplied as LAYER dependencies, so each method captures them once
 *     via the yield-first operation handle and never re-provides mid-effect.
 *   - `derive-dont-sync`: the distilled `Operations`/`Webhooks`/`Credentials`
 *     types are the single source of the wire shapes; this module maps the SDK's
 *     failures down to one user-facing `PaymentError` (create) /
 *     `PaymentWebhookError` (verify) and never re-declares a request/response
 *     schema.
 */

/**
 * A create-session failure. The distilled `PostCheckoutSessions` operation
 * declares an EMPTY typed-error channel (the SDK surfaces idempotency/invalid-
 * request failures at runtime via the request cause, not in the static type), so
 * we catch the whole `Cause` and collapse it here into ONE user-facing error: the
 * registrar action cannot meaningfully branch on the failure kind at the call site
 * (the amount is server-frozen, so a 4xx is an upstream bug, not a field the user
 * retries). `cause` carries the raw squashed SDK error for logging.
 */
export class PaymentError extends Schema.TaggedErrorClass<PaymentError>()(
  'Payment.Error',
  {
    message: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * A webhook signature/parse failure — a missing/malformed/expired
 * `Stripe-Signature`, an HMAC mismatch, or an unparseable body. The route maps
 * it to a 400 so Stripe retries (C8); distinct from `PaymentError` so the
 * webhook path never masquerades as a create-intent failure.
 */
export class PaymentWebhookError extends Schema.TaggedErrorClass<PaymentWebhookError>()(
  'Payment.WebhookError',
  {
    message: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {}

/** Stripe is unconfigured (`Env.stripe` is `None`) — both operations are inert. */
export class PaymentDisabled extends Schema.TaggedErrorClass<PaymentDisabled>()(
  'Payment.Disabled',
  {},
) {}

/**
 * The minted Checkout Session — the `sessionId` the order freezes (and the
 * webhook reconciles by) plus the hosted `url` the registrar redirects the
 * browser to so the visitor actually pays on Stripe.
 */
export interface CreatedSession {
  readonly sessionId: string;
  readonly url: string;
}

/**
 * The issued refund — the `refundId` Stripe minted and the `paymentIntentId` it
 * was issued against (resolved FROM the order's Checkout Session, since the
 * frozen `RegistrationOrder` stores only `sessionId`). The durable Order
 * `refund` op (G7) does not need the SDK's full refund object back; it freezes
 * the order `refunded` off its OWN authority (the bucket transition), so the
 * refund identifiers are all a caller needs for an audit trail.
 */
export interface CreatedRefund {
  readonly refundId: string;
  readonly paymentIntentId: string;
}

/** The verified, parsed webhook event (distilled's open `StripeEvent` shape). */
export type StripeEvent = Webhooks.StripeEvent;

export class Service extends Context.Service<
  Service,
  {
    /**
     * Create a Stripe Checkout Session (the hosted redirect flow) for one frozen
     * `amount` (minor units) in `currency`, charged via a single server-authored
     * `price_data` line item named `productName`. The receipt + customer is the
     * frozen `receiptEmail`; `metadata` (and `client_reference_id` = its
     * `orderId`) carry the order/fingerprint linkage the `checkout.session.completed`
     * webhook reconciles by. The visitor is redirected to the returned `url` to
     * pay; on completion Stripe returns them to `successUrl`, on cancel to
     * `cancelUrl` (both absolute, lang-aware). `idempotencyKey` is sent as the
     * `Idempotency-Key` HEADER, never the body — a verbatim retry replays the first
     * session. Fails `PaymentDisabled` when stripe is unconfigured; `PaymentError`
     * on any SDK/transport failure.
     */
    readonly createCheckoutSession: (params: {
      readonly amount: Cents;
      readonly currency: CurrencyCode;
      readonly receiptEmail: string;
      readonly productName: string;
      readonly successUrl: string;
      readonly cancelUrl: string;
      readonly metadata: Readonly<Record<string, string>>;
      readonly idempotencyKey: string;
    }) => Effect.Effect<CreatedSession, PaymentError | PaymentDisabled>;
    /**
     * Issue a refund for one frozen order against the Checkout Session it was
     * minted from. `PostRefunds` refunds a `payment_intent`/`charge`, but the
     * frozen `RegistrationOrder` stores only its `sessionId` (`order.ts`), so
     * this resolves the PaymentIntent FROM the session FIRST
     * (`GetCheckoutSessionsSession`) and then refunds `amount` (minor units —
     * the order's FROZEN total, never re-derived) against it. `idempotencyKey`
     * rides the `Idempotency-Key` HEADER (never the body), so a verbatim retry
     * of the durable `refund` op replays the first refund rather than issuing a
     * second. Fails `PaymentDisabled` when stripe is unconfigured; `PaymentError`
     * on any SDK/transport failure (including a session that carries no resolvable
     * PaymentIntent — an unpaid/expired session has nothing to refund).
     */
    readonly createRefund: (params: {
      readonly sessionId: string;
      readonly amount: Cents;
      readonly idempotencyKey: string;
    }) => Effect.Effect<CreatedRefund, PaymentError | PaymentDisabled>;
    /**
     * Verify `signature` against the RAW `rawBody` (HMAC-SHA256 over the exact
     * bytes Stripe sent — never reserialized JSON) and parse the event. Fails
     * `PaymentDisabled` when unconfigured; `PaymentWebhookError` on a bad
     * signature or unparseable payload.
     */
    readonly constructEvent: (
      rawBody: string,
      signature: string | null | undefined,
    ) => Effect.Effect<StripeEvent, PaymentWebhookError | PaymentDisabled>;
  }
>()('gycc/lib/payment.server/Service') {}

/**
 * The distilled `Credentials` derived from the `Env.stripe` gate. When stripe is
 * configured the key is the gated `STRIPE_API_KEY` over Stripe's default base
 * URL; when it is `None` the credential carries a blank key that is NEVER used
 * (the service's disabled branch fails `PaymentDisabled` before any operation
 * runs). Built as a layer so the operation handles capture it without a mid-
 * effect `Effect.provide`.
 */
const credentialsLayer = Layer.effect(
  Credentials,
  // The `Credentials` service value IS an `Effect<Config>`, so map the `Env`
  // effect to that inner effect (the layer value is the inner `Effect<Config>`).
  Effect.map(Env.Service, (env) =>
    Effect.succeed({
      apiKey: Option.isSome(env.stripe)
        ? env.stripe.value.apiKey
        : Redacted.make(''),
      apiBaseUrl: DEFAULT_API_BASE_URL,
    }),
  ),
);

/**
 * The `Payment` layer. Reads the stripe gate off `Env`: `None` ⇒ both operations
 * fail `PaymentDisabled` (the inert on-site path); `Some` ⇒ the captured
 * operation handle (over the `Credentials` + `FetchHttpClient` layer deps) runs
 * each call. The `PostCheckoutSessions` handle is captured once via the yield-first
 * form so the transport requirements are resolved at layer build, not per call.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;
    // Capture the requirement-free operation handle once (yield-first): the
    // `Credentials` + `HttpClient` deps are satisfied by this layer's context.
    const postCheckoutSessions = yield* PostCheckoutSessions;
    // The session-retrieve + refund handles, captured yield-first alongside
    // `postCheckoutSessions` so the `Credentials` + `HttpClient` deps resolve at
    // layer build, not per call (the same discipline as the create-session op).
    const getCheckoutSession = yield* GetCheckoutSessionsSession;
    const postRefunds = yield* PostRefunds;

    if (Option.isNone(env.stripe)) {
      return Service.of({
        createCheckoutSession: () => Effect.fail(new PaymentDisabled()),
        createRefund: () => Effect.fail(new PaymentDisabled()),
        constructEvent: () => Effect.fail(new PaymentDisabled()),
      });
    }

    const config = env.stripe.value;

    // The distilled operations declare an EMPTY typed-error channel (the SDK
    // surfaces idempotency/invalid-request failures at runtime via the request
    // cause, not in the static type), so every call catches the whole `Cause`
    // and collapses it into ONE user-facing `PaymentError` — a server-frozen
    // amount/order means any failure is an upstream/transport fault, not a user
    // field. `Cause.squash` recovers the raw SDK error for logging.
    const squashToPaymentError = (
      cause: Cause.Cause<never>,
    ): Effect.Effect<never, PaymentError> => {
      const squashed = Cause.squash(cause);
      const message =
        typeof squashed === 'object' &&
        squashed !== null &&
        'message' in squashed &&
        typeof (squashed as { readonly message?: unknown }).message === 'string'
          ? (squashed as { readonly message: string }).message
          : undefined;
      return Effect.fail(new PaymentError({ message, cause: squashed }));
    };

    const createCheckoutSession = Effect.fn('Payment.createCheckoutSession')(
      function* (params: {
        readonly amount: Cents;
        readonly currency: CurrencyCode;
        readonly receiptEmail: string;
        readonly productName: string;
        readonly successUrl: string;
        readonly cancelUrl: string;
        readonly metadata: Readonly<Record<string, string>>;
        readonly idempotencyKey: string;
      }) {
        const session = yield* postCheckoutSessions(
          {
            mode: 'payment',
            // The single server-frozen line item: an inline `price_data` carrying
            // the `Cents` amount + currency, so NOTHING about the price is
            // client-supplied. `quantity: 1` — the amount is the whole frozen
            // total (group sum or one registrant's price), already summed upstream.
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: params.currency,
                  unit_amount: params.amount,
                  product_data: { name: params.productName },
                },
              },
            ],
            // The frozen receipt recipient — also the customer Stripe emails the
            // receipt to. Set on BOTH the session (`customer_email`) and the
            // resulting PaymentIntent so the hosted page pre-fills it.
            customer_email: params.receiptEmail,
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
            // `client_reference_id` + `metadata.orderId` are the order linkage the
            // `checkout.session.completed` webhook reconciles by (the metadata
            // already carries `{ orderId, mode }`).
            client_reference_id: params.metadata['orderId'],
            metadata: { ...params.metadata },
          },
          { idempotencyKey: params.idempotencyKey },
        ).pipe(Effect.catchCause((cause) => squashToPaymentError(cause)));

        // A `mode: 'payment'` session ALWAYS carries a hosted `url` (the redirect
        // target); a `null` is an upstream Stripe contract violation, so it dies
        // rather than redirecting the visitor to nowhere.
        if (session.url === null) {
          return yield* Effect.die(
            new PaymentError({
              message: 'Stripe Checkout Session returned no url',
            }),
          );
        }

        return {
          sessionId: session.id,
          url: session.url,
        } satisfies CreatedSession;
      },
    );

    const createRefund = Effect.fn('Payment.createRefund')(function* (params: {
      readonly sessionId: string;
      readonly amount: Cents;
      readonly idempotencyKey: string;
    }) {
      // (1) Resolve the PaymentIntent FROM the session — `PostRefunds` cannot
      // take a `sessionId`, and the frozen order stores only that. A retrieve is
      // a GET (no idempotency key needed; it is naturally idempotent).
      const session = yield* getCheckoutSession({
        session: params.sessionId,
      }).pipe(Effect.catchCause((cause) => squashToPaymentError(cause)));

      // The session's `payment_intent` is typed `unknown` (it may be a bare id
      // string or — only when expanded, which we do NOT request — an object). For
      // a settled `mode: 'payment'` session it is the PaymentIntent id string; a
      // session with no resolvable PaymentIntent (unpaid/expired — nothing was
      // ever charged) has nothing to refund, a `PaymentError` (the `refund`
      // handler's `paid`-state guard already keeps this off the happy path, so
      // reaching it is an upstream inconsistency, not a user field).
      const paymentIntentId = session.payment_intent;
      if (typeof paymentIntentId !== 'string' || paymentIntentId === '') {
        return yield* new PaymentError({
          message: `Checkout Session ${params.sessionId} carries no PaymentIntent to refund`,
        });
      }

      // (2) Refund the FROZEN order amount (minor units) against the resolved
      // PaymentIntent. `idempotencyKey` rides the HEADER so a verbatim retry of
      // the durable `refund` op replays the first refund.
      const refund = yield* postRefunds(
        {
          payment_intent: paymentIntentId,
          amount: params.amount,
          reason: 'requested_by_customer',
        },
        { idempotencyKey: params.idempotencyKey },
      ).pipe(Effect.catchCause((cause) => squashToPaymentError(cause)));

      return {
        refundId: refund.id,
        paymentIntentId,
      } satisfies CreatedRefund;
    });

    const constructEvent = Effect.fn('Payment.constructEvent')(function* (
      rawBody: string,
      signature: string | null | undefined,
    ) {
      return yield* Webhooks.constructEvent({
        payload: rawBody,
        signature,
        secret: config.webhookSecret,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new PaymentWebhookError({ message: cause.message, cause }),
        ),
      );
    });

    return Service.of({ createCheckoutSession, createRefund, constructEvent });
  }),
).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(credentialsLayer),
);

/**
 * The self-contained `Payment` (the house `defaultLayer`), with its `Env`
 * dependency pre-provided. Consumers that wire `Payment` without separately
 * composing `Env` provide this directly.
 */
export const defaultLayer = layer.pipe(Layer.provide(Env.defaultLayer));

/** The argument record `createCheckoutSession` was last called with — what a test asserts. */
export interface CreateCheckoutSessionCall {
  readonly amount: Cents;
  readonly currency: CurrencyCode;
  readonly receiptEmail: string;
  readonly productName: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

/** The argument record `createRefund` was last called with — what a test asserts. */
export interface CreateRefundCall {
  readonly sessionId: string;
  readonly amount: Cents;
  readonly idempotencyKey: string;
}

/**
 * A network-free `Payment` test double (`Layer.succeed(Service, fake)`). The
 * registrar checkout tests (C7/C7.5) provide this to prove the create-session
 * wiring (amount/currency/receiptEmail/urls/metadata/idempotencyKey threading)
 * WITHOUT touching Stripe. `createCheckoutSession` records each call into `calls`
 * and returns a deterministic session whose id + hosted `url` derive from the
 * `idempotencyKey` (so a retry with the same key yields the same fake session —
 * the idempotency contract is observable in tests). `constructEvent` returns the
 * supplied `event`.
 *
 * Pass `calls` (a mutable array the test owns) to capture invocations, and
 * optionally `event` to fix what `constructEvent` returns.
 */
export const testLayer = (options?: {
  readonly calls?: Array<CreateCheckoutSessionCall>;
  readonly refundCalls?: Array<CreateRefundCall>;
  readonly event?: StripeEvent;
}): Layer.Layer<Service> =>
  Layer.succeed(
    Service,
    Service.of({
      createCheckoutSession: (params) =>
        Effect.sync(() => {
          options?.calls?.push({
            amount: params.amount,
            currency: params.currency,
            receiptEmail: params.receiptEmail,
            productName: params.productName,
            successUrl: params.successUrl,
            cancelUrl: params.cancelUrl,
            metadata: params.metadata,
            idempotencyKey: params.idempotencyKey,
          });
          return {
            sessionId: `cs_test_${params.idempotencyKey}`,
            url: `https://checkout.stripe.test/${params.idempotencyKey}`,
          };
        }),
      // The refund double records each call and returns a deterministic refund
      // whose id + resolved PaymentIntent derive from the session + idempotency
      // key (so a retry with the same key yields the same fake refund — the
      // idempotency contract is observable in tests, no network).
      createRefund: (params) =>
        Effect.sync(() => {
          options?.refundCalls?.push({
            sessionId: params.sessionId,
            amount: params.amount,
            idempotencyKey: params.idempotencyKey,
          });
          return {
            refundId: `re_test_${params.idempotencyKey}`,
            paymentIntentId: `pi_test_${params.sessionId}`,
          };
        }),
      constructEvent: () => Effect.succeed(options?.event ?? {}),
    }),
  );
