export * as StripeGateway from './stripe-gateway.server';

import {
  Credentials,
  DEFAULT_API_BASE_URL,
  PostCheckoutSessions,
  PostRefunds,
  Webhooks,
} from '@distilled.cloud/stripe';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

import { Env, type StripeConfig } from '../env.server';
import type { Cents } from '../forms/pricing';
import type { OrderId } from './order-repository.server';
import { checkoutLifetime } from './checkout-lifetime';

export const checkoutExpiresAt = (
  now: number,
  quoteExpiresAt: number,
): number | undefined => {
  const lifetime = checkoutLifetime(now, quoteExpiresAt);
  return lifetime.ok ? lifetime.expiresAtSeconds : undefined;
};

export type CreateCheckout = {
  readonly orderId: OrderId;
  readonly registrationId: string;
  readonly amount: Cents;
  readonly receiptEmail: string;
  readonly idempotencyKey: string;
  readonly now: number;
  readonly quoteExpiresAt: number;
};

export type Checkout = {
  readonly sessionId: string;
  readonly url: string;
};

export type Refund = {
  readonly orderId: OrderId;
  readonly paymentIntentId: string;
  readonly idempotencyKey: string;
};

export type RefundResult = {
  readonly refundId: string;
  readonly status: string | null;
};

export type StripeEvent = Webhooks.StripeEvent;

export class Unavailable extends Schema.TaggedErrorClass<Unavailable>()(
  'StripeGateway.Unavailable',
  {},
) {}

export class RequestFailed extends Schema.TaggedErrorClass<RequestFailed>()(
  'StripeGateway.RequestFailed',
  { operation: Schema.String },
) {}

export class InvalidWebhook extends Schema.TaggedErrorClass<InvalidWebhook>()(
  'StripeGateway.InvalidWebhook',
  {},
) {}

export interface Client {
  readonly createCheckout: (
    input: Parameters<typeof PostCheckoutSessions>[0],
    options: { readonly idempotencyKey: string },
  ) => Effect.Effect<{ readonly id: string; readonly url: string | null }, unknown>;
  readonly refund: (
    input: Parameters<typeof PostRefunds>[0],
    options: { readonly idempotencyKey: string },
  ) => Effect.Effect<unknown, unknown>;
  readonly constructEvent: (
    payload: string | Uint8Array | ArrayBuffer,
    signature: string | null | undefined,
  ) => Effect.Effect<StripeEvent, unknown>;
}

export class Service extends Context.Service<
  Service,
  {
    readonly available: boolean;
    readonly createCheckout: (
      command: CreateCheckout,
    ) => Effect.Effect<Checkout, Unavailable | RequestFailed>;
    readonly refund: (
      command: Refund,
    ) => Effect.Effect<RefundResult, Unavailable | RequestFailed>;
    readonly constructEvent: (
      payload: string | Uint8Array | ArrayBuffer,
      signature: string | null | undefined,
    ) => Effect.Effect<StripeEvent, Unavailable | InvalidWebhook>;
  }
>()('gycc/lib/registration/stripe-gateway.server/Service') {}

export const makeLayer = (
  client: Option.Option<Client>,
  publicOrigin = 'https://gyc.ca',
) =>
  Layer.succeed(
    Service,
    Service.of({
      available: Option.isSome(client),
      createCheckout: Effect.fn('StripeGateway.createCheckout')(function* (
        command: CreateCheckout,
      ) {
        if (Option.isNone(client)) return yield* new Unavailable();
        const expiresAt = checkoutExpiresAt(command.now, command.quoteExpiresAt);
        if (expiresAt === undefined) {
          return yield* new RequestFailed({
            operation: 'honor Checkout quote deadline',
          });
        }
        const output = yield* client.value
          .createCheckout(
            {
              mode: 'payment',
              client_reference_id: command.orderId,
              customer_email: command.receiptEmail,
              currency: 'cad',
              expires_at: expiresAt,
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: 'cad',
                    unit_amount: command.amount,
                    product_data: {
                      name: 'GYC Canada registration',
                      metadata: {
                        orderId: command.orderId,
                        registrationId: command.registrationId,
                      },
                    },
                  },
                },
              ],
              metadata: {
                orderId: command.orderId,
                registrationId: command.registrationId,
              },
              payment_intent_data: {
                metadata: {
                  orderId: command.orderId,
                  registrationId: command.registrationId,
                },
              },
              success_url: `${publicOrigin}/registration/status?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${publicOrigin}/registration/status?order=${encodeURIComponent(command.orderId)}`,
            },
            { idempotencyKey: command.idempotencyKey },
          )
          .pipe(
            Effect.mapError(
              () => new RequestFailed({ operation: 'create Checkout Session' }),
            ),
          );
        if (output.url === null) {
          return yield* new RequestFailed({
            operation: 'resolve hosted Checkout URL',
          });
        }
        return { sessionId: output.id, url: output.url };
      }),
      refund: Effect.fn('StripeGateway.refund')(function* (command: Refund) {
        if (Option.isNone(client)) return yield* new Unavailable();
        return yield* client.value
          .refund(
            {
              payment_intent: command.paymentIntentId,
              reason: 'requested_by_customer',
              metadata: { orderId: command.orderId },
            },
            { idempotencyKey: command.idempotencyKey },
          )
          .pipe(
            Effect.map((output) => {
              const refund = output as { readonly id?: unknown; readonly status?: unknown };
              if (typeof refund.id !== 'string') {
                return Effect.fail(
                  new RequestFailed({ operation: 'decode refund response' }),
                );
              }
              return Effect.succeed({
                refundId: refund.id,
                status:
                  typeof refund.status === 'string' || refund.status === null
                    ? refund.status
                    : null,
              });
            }),
            Effect.flatten,
            Effect.mapError(
              () => new RequestFailed({ operation: 'create full refund' }),
            ),
          );
      }),
      constructEvent: Effect.fn('StripeGateway.constructEvent')(function* (
        payload,
        signature,
      ) {
        if (Option.isNone(client)) return yield* new Unavailable();
        return yield* client.value.constructEvent(payload, signature).pipe(
          Effect.mapError(() => new InvalidWebhook()),
        );
      }),
    }),
  );

const liveClient = (config: StripeConfig): Client => {
  const stripeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(
      Credentials,
      Effect.succeed({
        apiKey: config.apiKey,
        apiBaseUrl: DEFAULT_API_BASE_URL,
      }),
    ),
  );
  return {
    createCheckout: (input, options) =>
      PostCheckoutSessions(input, options).pipe(Effect.provide(stripeLayer)),
    refund: (input, options) =>
      PostRefunds(input, options).pipe(Effect.provide(stripeLayer)),
    constructEvent: (payload, signature) =>
      Webhooks.constructEvent({
        payload,
        signature,
        secret: config.webhookSecret,
      }),
  };
};

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* Env.Service;
    return makeLayer(
      Option.map(env.stripe, liveClient),
      Option.match(env.stripe, {
        onNone: () => '',
        onSome: (config) => config.publicOrigin,
      }),
    );
  }),
);
