export * as Mailchimp from './mailchimp.server';

import mailchimp from '@mailchimp/mailchimp_marketing';
import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';

import { Env } from './env.server';

export class MailchimpError extends Schema.TaggedErrorClass<MailchimpError>()(
  'Mailchimp.Error',
  { cause: Schema.optional(Schema.Defect) },
) {}

export class MailchimpDisabled extends Schema.TaggedErrorClass<MailchimpDisabled>()(
  'Mailchimp.Disabled',
  {},
) {}

/**
 * Newsletter subscription, ported from the standalone Mailchimp module to an
 * Effect `Context.Service`.
 *
 * Behaviour preserved exactly: the `us10` Mailchimp server, and the
 * `FNAME` / `LNAME` split of the supplied name (first token → FNAME, the
 * remainder joined → LNAME). When mailchimp is unconfigured (dev), `subscribe`
 * fails with `MailchimpDisabled` so the newsletter route surfaces the same
 * form error the old try/catch produced.
 */
export class Service extends Context.Service<
  Service,
  {
    readonly subscribe: (
      email: string,
      name: string,
    ) => Effect.Effect<void, MailchimpError | MailchimpDisabled>;
  }
>()('gycc/lib/mailchimp.server/Service') {}

/**
 * The `Mailchimp` layer (opencode's module-level `export const layer`,
 * `packages/core/src/git.ts:79`); `defaultLayer` pre-provides its `Env`
 * dependency so a standalone consumer wires it in one step.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;

    if (Option.isNone(env.mailchimp)) {
      return Service.of({
        subscribe: () => Effect.fail(new MailchimpDisabled()),
      });
    }

    const config = env.mailchimp.value;
    mailchimp.setConfig({
      apiKey: Redacted.value(config.apiKey),
      server: 'us10',
    });

    const subscribe = Effect.fn('Mailchimp.subscribe')(function* (
      email: string,
      name: string,
    ) {
      const nameParts = name.split(' ');
      yield* Effect.tryPromise({
        try: () =>
          mailchimp.lists.addListMember(config.listId, {
            email_address: email,
            status: 'subscribed',
            merge_fields: {
              FNAME: nameParts[0] ?? '',
              LNAME: nameParts.slice(1).join(' '),
            },
          }),
        catch: (cause) => new MailchimpError({ cause }),
      });
    });

    return Service.of({ subscribe });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(Env.defaultLayer));
