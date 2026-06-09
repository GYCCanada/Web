import { Config, Context, Effect, Layer, Option, Redacted } from 'effect';

/**
 * Environment configuration, ported from the former Zod-over-`process.env`
 * discriminated union to Effect `Config` (ADR 0004).
 *
 * Behaviour preserved exactly:
 *   - In `production` every mail / mailchimp variable is **required**; a
 *     missing one fails the layer at boot (the old code `throw`-ed on an
 *     invalid `process.env`).
 *   - In `development` / `test` every variable is **optional**; the mailer is
 *     a no-op and mailchimp is unconfigured, matching the old optional schema.
 *
 * Secrets (`MAIL_PASS`, `MAILCHIMP_API_KEY`) flow through `Config.redacted` so
 * they are never accidentally logged.
 */

export interface MailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: Redacted.Redacted<string>;
  readonly from: string;
  readonly to: string;
}

export interface MailchimpConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly listId: string;
}

const mailConfigRequired = Config.all({
  host: Config.string('MAIL_HOST'),
  port: Config.number('MAIL_PORT'),
  user: Config.string('MAIL_USER'),
  pass: Config.redacted('MAIL_PASS'),
  from: Config.string('MAIL_FROM'),
  to: Config.string('MAIL_TO'),
});

const mailchimpConfigRequired = Config.all({
  apiKey: Config.redacted('MAILCHIMP_API_KEY'),
  listId: Config.string('MAILCHIMP_LIST_ID'),
});

export class Env extends Context.Service<
  Env,
  {
    readonly isProduction: boolean;
    readonly mail: Option.Option<MailConfig>;
    readonly mailchimp: Option.Option<MailchimpConfig>;
  }
>()('gycc/lib/env.server/Env') {
  static layer = Layer.effect(
    Env,
    Effect.gen(function* () {
      const nodeEnv = yield* Config.string('NODE_ENV').pipe(
        Config.withDefault('development'),
      );
      const isProduction = nodeEnv === 'production';

      if (isProduction) {
        const mail = yield* mailConfigRequired;
        const mailchimp = yield* mailchimpConfigRequired;
        return Env.of({
          isProduction,
          mail: Option.some(mail),
          mailchimp: Option.some(mailchimp),
        });
      }

      const mail = yield* Config.option(mailConfigRequired);
      const mailchimp = yield* Config.option(mailchimpConfigRequired);
      return Env.of({ isProduction, mail, mailchimp });
    }),
  );
}
