export * as Mailer from './mailer.server';

import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';
import nodemailer from 'nodemailer';

import { Env } from './env.server';

export class MailError extends Schema.TaggedErrorClass<MailError>()(
  'Mailer.Error',
  { cause: Schema.optional(Schema.Defect) },
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
export class Service extends Context.Service<
  Service,
  {
    readonly send: (input: {
      readonly subject: string;
      readonly content: string;
    }) => Effect.Effect<void, MailError>;
  }
>()('gycc/lib/mailer.server/Service') {}

/**
 * The `Mailer` layer (opencode's module-level `export const layer`,
 * `packages/core/src/git.ts:79`); `defaultLayer` pre-provides its `Env`
 * dependency so a standalone consumer wires it in one step.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;

    if (!env.isProduction || Option.isNone(env.mail)) {
      return Service.of({ send: () => Effect.void });
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

    const send = Effect.fn('Mailer.send')(
      (input: { readonly subject: string; readonly content: string }) =>
        Effect.tryPromise({
          try: () =>
            transporter.sendMail({
              from: `GYCC Contact <${mail.from}>`,
              to: mail.to,
              subject: input.subject,
              text: input.content,
            }),
          catch: (cause) => new MailError({ cause }),
        }).pipe(Effect.asVoid),
    );

    return Service.of({ send });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(Env.defaultLayer));
