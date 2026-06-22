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
import { PostPaymentIntents } from '@distilled.cloud/stripe/Operations';

import type { Cents, CurrencyCode } from './forms/pricing';
import { Env } from './env.server';

/**
 * The first-party payment boundary — a `Payment` `Context.Service` over the
 * distilled Stripe SDK (`@distilled.cloud/stripe`), mirroring the house service
 * pattern (`submissions.server.ts:68-94`, `sendgrid.server.ts:25-33`). It exposes
 * exactly two operations the registrar needs:
 *
 *   - `createIntent` — mint a Stripe PaymentIntent for one frozen amount and
 *     return its `{ intentId, clientSecret }`. The `idempotencyKey` rides the
 *     request's `Idempotency-Key` HEADER (NOT the body), so a verbatim retry of
 *     the same checkout replays the first intent rather than double-charging
 *     (Decision 2 / 2b: the key derives from the request fingerprint + chosen
 *     mode). `receiptEmail` threads to `PostPaymentIntents.receipt_email` — the
 *     frozen payer (group) or per-registrant (perRegistrant) receipt recipient
 *     (Decision 2b.6).
 *   - `constructEvent` — verify a webhook's `Stripe-Signature` against the raw
 *     body (HMAC-SHA256, 300s tolerance) and parse it to a `StripeEvent`. The
 *     webhook route (C8) reconciles orders off the verified event.
 *
 * Principles (`~/.brain/principles`):
 *
 *   - `small-interface-deep-implementation`: two operations, no leaked SDK types.
 *     `amount` is raw minor units (the `Cents` brand already guarantees an
 *     integer ≥0 — no dollar→cents helper); `clientSecret` is unwrapped from its
 *     `Redacted` exactly once, here at the boundary, so callers never coerce.
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
 * A create-intent failure. The distilled `PostPaymentIntents` operation declares
 * an EMPTY typed-error channel (the SDK surfaces card/idempotency/invalid-request
 * failures at runtime via the request cause, not in the static type), so we catch
 * the whole `Cause` and collapse it here into ONE user-facing error: the
 * registrar action cannot meaningfully branch on a declined card vs an
 * invalid-request at the call site (the amount is server-frozen, so a 4xx is an
 * upstream bug, not a field the user retries). `cause` carries the raw squashed
 * SDK error for logging.
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

/** The minted intent — exactly what a checkout needs to confirm client-side. */
export interface CreatedIntent {
  readonly intentId: string;
  readonly clientSecret: string;
}

/** The verified, parsed webhook event (distilled's open `StripeEvent` shape). */
export type StripeEvent = Webhooks.StripeEvent;

export class Service extends Context.Service<
  Service,
  {
    /**
     * Create a Stripe PaymentIntent for one frozen `amount` (minor units) in
     * `currency`, routing the receipt to `receiptEmail` and tagging the intent
     * with `metadata` (the order/fingerprint linkage the webhook reconciles by).
     * `idempotencyKey` is sent as the `Idempotency-Key` HEADER, never the body —
     * a verbatim retry replays the first intent. Fails `PaymentDisabled` when
     * stripe is unconfigured; `PaymentError` on any SDK/transport failure.
     */
    readonly createIntent: (
      amount: Cents,
      currency: CurrencyCode,
      receiptEmail: string,
      metadata: Readonly<Record<string, string>>,
      idempotencyKey: string,
    ) => Effect.Effect<CreatedIntent, PaymentError | PaymentDisabled>;
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
  Effect.map(Env.Service.asEffect(), (env) =>
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
 * each call. The `PostPaymentIntents` handle is captured once via the yield-first
 * form so the transport requirements are resolved at layer build, not per call.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;
    // Capture the requirement-free operation handle once (yield-first): the
    // `Credentials` + `HttpClient` deps are satisfied by this layer's context.
    const postPaymentIntents = yield* PostPaymentIntents;

    if (Option.isNone(env.stripe)) {
      return Service.of({
        createIntent: () => Effect.fail(new PaymentDisabled()),
        constructEvent: () => Effect.fail(new PaymentDisabled()),
      });
    }

    const config = env.stripe.value;

    const createIntent = Effect.fn('Payment.createIntent')(function* (
      amount: Cents,
      currency: CurrencyCode,
      receiptEmail: string,
      metadata: Readonly<Record<string, string>>,
      idempotencyKey: string,
    ) {
      const intent = yield* postPaymentIntents(
        {
          amount,
          currency,
          receipt_email: receiptEmail,
          metadata: { ...metadata },
        },
        { idempotencyKey },
      ).pipe(
        // The operation's static error channel is empty (the SDK reports
        // card/idempotency/invalid-request failures at runtime, not in the
        // type), so catch the whole `Cause` and squash it into ONE `PaymentError`
        // — a server-frozen amount means any failure is an upstream/transport
        // fault, not a user field. `Cause.squash` recovers the raw SDK error.
        Effect.catchCause((cause) => {
          const squashed = Cause.squash(cause);
          const message =
            typeof squashed === 'object' &&
            squashed !== null &&
            'message' in squashed &&
            typeof (squashed as { readonly message?: unknown }).message ===
              'string'
              ? (squashed as { readonly message: string }).message
              : undefined;
          return Effect.fail(new PaymentError({ message, cause: squashed }));
        }),
      );

      // `client_secret` is a `SensitiveNullableString` ⇒ `Redacted<string> | null`;
      // unwrap it once here at the boundary. A confirmable intent always carries a
      // secret, so a `null` is an upstream Stripe contract violation (it dies).
      if (intent.client_secret === null) {
        return yield* Effect.die(
          new PaymentError({
            message: 'Stripe PaymentIntent returned no client_secret',
          }),
        );
      }

      // The decoded `client_secret` is `string | Redacted<string>` (the SDK's
      // input-friendly `Sensitive` codec); normalize to the raw string here.
      const clientSecret = Redacted.isRedacted(intent.client_secret)
        ? Redacted.value(intent.client_secret)
        : intent.client_secret;

      return { intentId: intent.id, clientSecret } satisfies CreatedIntent;
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

    return Service.of({ createIntent, constructEvent });
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

/** The argument record `createIntent` was last called with — what a test asserts. */
export interface CreateIntentCall {
  readonly amount: Cents;
  readonly currency: CurrencyCode;
  readonly receiptEmail: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

/**
 * A network-free `Payment` test double (`Layer.succeed(Service, fake)`). The
 * registrar checkout tests (C7/C7.5) provide this to prove the create-intent
 * wiring (amount/currency/receiptEmail/metadata/idempotencyKey threading) WITHOUT
 * touching Stripe. `createIntent` records each call into `calls` and returns a
 * deterministic intent whose ids derive from the `idempotencyKey` (so a retry
 * with the same key yields the same fake intent — the idempotency contract is
 * observable in tests). `constructEvent` returns the supplied `event`.
 *
 * Pass `calls` (a mutable array the test owns) to capture invocations, and
 * optionally `event` to fix what `constructEvent` returns.
 */
export const testLayer = (options?: {
  readonly calls?: Array<CreateIntentCall>;
  readonly event?: StripeEvent;
}): Layer.Layer<Service> =>
  Layer.succeed(
    Service,
    Service.of({
      createIntent: (amount, currency, receiptEmail, metadata, idempotencyKey) =>
        Effect.sync(() => {
          options?.calls?.push({
            amount,
            currency,
            receiptEmail,
            metadata,
            idempotencyKey,
          });
          return {
            intentId: `pi_test_${idempotencyKey}`,
            clientSecret: `pi_test_${idempotencyKey}_secret`,
          };
        }),
      constructEvent: () => Effect.succeed(options?.event ?? {}),
    }),
  );
