export * as Sendgrid from './sendgrid.server';

import client from '@sendgrid/client';
import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';

import { Env } from './env.server';

export class SendgridError extends Schema.TaggedErrorClass<SendgridError>()(
  'Sendgrid.Error',
  { cause: Schema.optional(Schema.Defect) },
) {}

export class SendgridDisabled extends Schema.TaggedErrorClass<SendgridDisabled>()(
  'Sendgrid.Disabled',
  {},
) {}

/**
 * Newsletter subscription via SendGrid Marketing Contacts API.
 *
 * Name splitting matches the former Mailchimp integration: first token →
 * `first_name`, the remainder joined → `last_name`. When sendgrid is
 * unconfigured, `subscribe` fails with `SendgridDisabled`.
 */
export class Service extends Context.Service<
  Service,
  {
    readonly subscribe: (
      email: string,
      name: string,
    ) => Effect.Effect<void, SendgridError | SendgridDisabled>;
  }
>()('gycc/lib/sendgrid.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;

    if (Option.isNone(env.sendgrid)) {
      return Service.of({
        subscribe: () => Effect.fail(new SendgridDisabled()),
      });
    }

    const config = env.sendgrid.value;
    client.setApiKey(Redacted.value(config.apiKey));

    const subscribe = Effect.fn('Sendgrid.subscribe')(function* (
      email: string,
      name: string,
    ) {
      const nameParts = name.split(' ');
      yield* Effect.tryPromise({
        try: async () => {
          const [, response] = await client.request({
            method: 'PUT',
            url: '/v3/marketing/contacts',
            body: {
              list_ids: [config.listId],
              contacts: [
                {
                  email,
                  first_name: nameParts[0] ?? '',
                  last_name: nameParts.slice(1).join(' '),
                },
              ],
            },
          });
          if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`SendGrid returned ${response.statusCode}`);
          }
        },
        catch: (cause) => new SendgridError({ cause }),
      });
    });

    return Service.of({ subscribe });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(Env.defaultLayer));
