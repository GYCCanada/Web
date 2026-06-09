import mailchimp from '@mailchimp/mailchimp_marketing';
import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';

import { Env } from './env.server';

export class MailchimpError extends Schema.TaggedErrorClass<MailchimpError>()(
  'gycc/lib/mailchimp.server/MailchimpError',
  { message: Schema.String },
) {}

export class MailchimpDisabled extends Schema.TaggedErrorClass<MailchimpDisabled>()(
  'gycc/lib/mailchimp.server/MailchimpDisabled',
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
export class Mailchimp extends Context.Service<
  Mailchimp,
  {
    readonly subscribe: (
      email: string,
      name: string,
    ) => Effect.Effect<void, MailchimpError | MailchimpDisabled>;
  }
>()('gycc/lib/mailchimp.server/Mailchimp') {
  static layer = Layer.effect(
    Mailchimp,
    Effect.gen(function* () {
      const env = yield* Env;

      if (Option.isNone(env.mailchimp)) {
        return Mailchimp.of({
          subscribe: () => Effect.fail(new MailchimpDisabled()),
        });
      }

      const config = env.mailchimp.value;
      mailchimp.setConfig({
        apiKey: Redacted.value(config.apiKey),
        server: 'us10',
      });

      return Mailchimp.of({
        subscribe: (email, name) =>
          Effect.gen(function* () {
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
              catch: (cause) =>
                new MailchimpError({ message: String(cause) }),
            });
          }),
      });
    }),
  );
}
