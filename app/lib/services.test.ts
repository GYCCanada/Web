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
        expect(Option.isNone(env.bucket)).toBe(true);
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

  it('leaves the bucket absent in production when its vars are unset', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(env.isProduction).toBe(true);
        expect(Option.isNone(env.bucket)).toBe(true);
      }),
      envLayer(PROD_ENV),
    ));

  it('resolves the bucket, redacts the secret, and defaults region to auto', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(Option.isSome(env.bucket)).toBe(true);
        if (Option.isSome(env.bucket)) {
          expect(env.bucket.value.endpoint).toBe('https://s3.example.com');
          expect(env.bucket.value.bucket).toBe('gycc-content');
          expect(env.bucket.value.region).toBe('auto');
          expect(Redacted.value(env.bucket.value.accessKeyId)).toBe('akid');
          expect(Redacted.value(env.bucket.value.secretAccessKey)).toBe('secret-key');
        }
      }),
      envLayer({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: 'https://s3.example.com',
        BUCKET_ACCESS_KEY: 'akid',
        BUCKET_SECRET_KEY: 'secret-key',
        BUCKET_NAME: 'gycc-content',
      }),
    ));

  it('treats present-but-blank bucket vars as absent (env.example placeholders)', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(Option.isNone(env.bucket)).toBe(true);
      }),
      // Mirrors a freshly-copied `.env.example`: the BUCKET_* keys are present
      // but empty. These must collapse to `Option.none()` so the CMS falls back
      // to its bundled defaults (D3), not a Some(...) of empty strings.
      envLayer({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: '',
        BUCKET_ACCESS_KEY: '',
        BUCKET_SECRET_KEY: '',
        BUCKET_NAME: '',
        BUCKET_REGION: 'auto',
      }),
    ));

  it('treats whitespace-only bucket vars as absent', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(Option.isNone(env.bucket)).toBe(true);
      }),
      envLayer({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: '   ',
        BUCKET_ACCESS_KEY: '  ',
        BUCKET_SECRET_KEY: '\t',
        BUCKET_NAME: ' ',
      }),
    ));

  it('treats a partially-blank bucket group as absent', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        expect(Option.isNone(env.bucket)).toBe(true);
      }),
      // Endpoint set, but the rest left blank — not a usable bucket, so None.
      envLayer({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: 'https://s3.example.com',
        BUCKET_ACCESS_KEY: '',
        BUCKET_SECRET_KEY: '',
        BUCKET_NAME: '',
      }),
    ));

  it('honours an explicit BUCKET_REGION', () =>
    run(
      Effect.gen(function* () {
        const env = yield* Env;
        if (Option.isSome(env.bucket)) {
          expect(env.bucket.value.region).toBe('us-east-1');
        } else {
          throw new Error('expected bucket to be configured');
        }
      }),
      envLayer({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: 'https://s3.example.com',
        BUCKET_ACCESS_KEY: 'akid',
        BUCKET_SECRET_KEY: 'secret-key',
        BUCKET_NAME: 'gycc-content',
        BUCKET_REGION: 'us-east-1',
      }),
    ));
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
