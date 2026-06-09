import { describe, expect, it } from 'bun:test';
import {
  Config,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';

import { Env } from './env.server';
import { Mailchimp, MailchimpDisabled } from './mailchimp.server';
import { Mailer } from './mailer.server';

const envLayer = (env: Record<string, string>) =>
  Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

const run = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, Config.ConfigError>,
) => Effect.runPromise(Effect.provide(effect, layer));

const runExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, Config.ConfigError>,
) => Effect.runPromise(Effect.exit(Effect.provide(effect, layer)));

const PROD_ENV = {
  NODE_ENV: 'production',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '465',
  MAIL_USER: 'user',
  MAIL_PASS: 'secret',
  MAIL_FROM: 'from@example.com',
  MAIL_TO: 'to@example.com',
  MAILCHIMP_API_KEY: 'key-us10',
  MAILCHIMP_LIST_ID: 'list-123',
};

describe('Env config', () => {
  it('treats every mail/mailchimp var as optional in development', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(env.isProduction).toBe(false);
        expect(Option.isNone(env.mail)).toBe(true);
        expect(Option.isNone(env.mailchimp)).toBe(true);
      }),
      envLayer({ NODE_ENV: 'development' }),
    ));

  it('requires every mail/mailchimp var in production and redacts secrets', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(env.isProduction).toBe(true);
        expect(Option.isSome(env.mail)).toBe(true);
        expect(Option.isSome(env.mailchimp)).toBe(true);
        if (Option.isSome(env.mail)) {
          expect(env.mail.value.host).toBe('smtp.example.com');
          expect(env.mail.value.port).toBe(465);
          expect(Redacted.value(env.mail.value.pass)).toBe('secret');
        }
        if (Option.isSome(env.mailchimp)) {
          expect(env.mailchimp.value.listId).toBe('list-123');
          expect(Redacted.value(env.mailchimp.value.apiKey)).toBe('key-us10');
        }
      }),
      envLayer(PROD_ENV),
    ));

  it('fails fast in production when a required mail var is missing', async () => {
    const exit = await runExit(
      Env.asEffect(),
      envLayer({ NODE_ENV: 'production', MAIL_HOST: 'only-host' }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('Mailer', () => {
  it('is a no-op outside production', () =>
    run(
      Effect.gen(function* () {
        const mailer = yield* Mailer;
        yield* mailer.send({ subject: 's', content: 'c' });
      }),
      Layer.provide(Mailer.layer, envLayer({ NODE_ENV: 'development' })),
    ));
});

describe('Mailchimp', () => {
  it('fails with MailchimpDisabled when unconfigured', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const mailchimp = yield* Mailchimp;
        yield* mailchimp.subscribe('a@b.com', 'Ada Lovelace');
      }),
      Layer.provide(Mailchimp.layer, envLayer({ NODE_ENV: 'development' })),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failed = exit.cause.reasons.some(
        (reason) =>
          reason._tag === 'Fail' && Schema.is(MailchimpDisabled)(reason.error),
      );
      expect(failed).toBe(true);
    }
  });
});
