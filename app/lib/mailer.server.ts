import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';
import nodemailer from 'nodemailer';

import { Env } from './env.server';

export class MailError extends Schema.TaggedErrorClass<MailError>()(
  'gycc/lib/mailer.server/MailError',
  { message: Schema.String },
) {}

/**
 * Contact / volunteer email sender, ported from the standalone
 * `nodemailer` module to an Effect `Context.Service`.
 *
 * Behaviour preserved exactly: outside `production` `send` is a no-op (the old
 * module returned early when `NODE_ENV !== 'production'`); in `production` it
 * sends through the configured SMTP transport with the same
 * `GYCC Contact <from>` envelope.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (input: {
      readonly subject: string;
      readonly content: string;
    }) => Effect.Effect<void, MailError>;
  }
>()('gycc/lib/mailer.server/Mailer') {
  static layer = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const env = yield* Env;

      if (!env.isProduction || Option.isNone(env.mail)) {
        return Mailer.of({ send: () => Effect.void });
      }

      const mail = env.mail.value;
      const transporter = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.port === 465,
        auth: {
          user: mail.user,
          pass: Redacted.value(mail.pass),
        },
      });

      return Mailer.of({
        send: ({ subject, content }) =>
          Effect.tryPromise({
            try: () =>
              transporter.sendMail({
                from: `GYCC Contact <${mail.from}>`,
                to: mail.to,
                subject,
                text: content,
              }),
            catch: (cause) => new MailError({ message: String(cause) }),
          }).pipe(Effect.asVoid),
      });
    }),
  );
}
