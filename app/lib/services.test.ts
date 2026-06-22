import { describe, expect, it } from 'effect-bun-test';
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
} from 'effect';

import { Env } from './env.server';
import { CurrencyCode } from './forms/pricing';
import { Sendgrid, SendgridDisabled } from './sendgrid.server';
import { Mailer } from './mailer.server';

const envLayer = (env: Record<string, string>) =>
  Layer.provide(Env.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

const provideEnv = (env: Record<string, string>) =>
  Effect.provide(envLayer(env));

const PROD_ENV = {
  NODE_ENV: 'production',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '465',
  MAIL_USER: 'user',
  MAIL_PASS: 'secret',
  MAIL_FROM: 'from@example.com',
  MAIL_TO: 'to@example.com',
};

const PROD_ENV_WITH_SENDGRID = {
  ...PROD_ENV,
  SENDGRID_API_KEY: 'sg-key',
  SENDGRID_LIST_ID: 'list-uuid-123',
};

describe('Env config', () => {
  it.effect('treats mail as optional and sendgrid as absent in development', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(env.isProduction).toBe(false);
      expect(Option.isNone(env.mail)).toBe(true);
      expect(Option.isNone(env.sendgrid)).toBe(true);
      expect(Option.isNone(env.bucket)).toBe(true);
    }).pipe(provideEnv({ NODE_ENV: 'development' })));

  it.effect('requires mail in production and keeps sendgrid optional', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(env.isProduction).toBe(true);
      expect(Option.isSome(env.mail)).toBe(true);
      expect(Option.isNone(env.sendgrid)).toBe(true);
      if (Option.isSome(env.mail)) {
        expect(env.mail.value.host).toBe('smtp.example.com');
        expect(env.mail.value.port).toBe(465);
        expect(Redacted.value(env.mail.value.pass)).toBe('secret');
      }
    }).pipe(provideEnv(PROD_ENV)));

  it.effect('resolves sendgrid when configured and redacts the API key', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(env.isProduction).toBe(true);
      expect(Option.isSome(env.sendgrid)).toBe(true);
      if (Option.isSome(env.sendgrid)) {
        expect(env.sendgrid.value.listId).toBe('list-uuid-123');
        expect(Redacted.value(env.sendgrid.value.apiKey)).toBe('sg-key');
      }
    }).pipe(provideEnv(PROD_ENV_WITH_SENDGRID)));

  it.effect('fails fast in production when a required mail var is missing', () =>
    Effect.gen(function* () {
      const exit = yield* Env.Service.pipe(
        provideEnv({ NODE_ENV: 'production', MAIL_HOST: 'only-host' }),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }));

  it.effect('leaves stripe absent everywhere when its vars are unset', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.stripe)).toBe(true);
    }).pipe(provideEnv({ NODE_ENV: 'development' })));

  it.effect('resolves stripe when both secrets are non-blank, redacting them', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isSome(env.stripe)).toBe(true);
      if (Option.isSome(env.stripe)) {
        expect(Redacted.value(env.stripe.value.apiKey)).toBe('sk_test_123');
        expect(Redacted.value(env.stripe.value.webhookSecret)).toBe('whsec_456');
        // Defaults to the GYC settlement currency when STRIPE_CURRENCY is unset.
        expect(env.stripe.value.currency).toBe(CurrencyCode.make('cad'));
      }
    }).pipe(
      provideEnv({
        ...PROD_ENV,
        STRIPE_API_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_456',
      }),
    ));

  it.effect('treats a partially-blank stripe group as absent', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      // API key set but webhook secret blank — not a usable gate, so None.
      expect(Option.isNone(env.stripe)).toBe(true);
    }).pipe(
      provideEnv({
        NODE_ENV: 'development',
        STRIPE_API_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: '',
      }),
    ));

  it.effect('treats whitespace-only stripe secrets as absent', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.stripe)).toBe(true);
    }).pipe(
      provideEnv({
        NODE_ENV: 'development',
        STRIPE_API_KEY: '   ',
        STRIPE_WEBHOOK_SECRET: '\t',
      }),
    ));

  it.effect('fails fast when a configured stripe carries an unsupported currency', () =>
    Effect.gen(function* () {
      const exit = yield* Env.Service.pipe(
        provideEnv({
          NODE_ENV: 'development',
          STRIPE_API_KEY: 'sk_test_123',
          STRIPE_WEBHOOK_SECRET: 'whsec_456',
          STRIPE_CURRENCY: 'usd',
        }),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }));

  it.effect('leaves the bucket absent in production when its vars are unset', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(env.isProduction).toBe(true);
      expect(Option.isNone(env.bucket)).toBe(true);
    }).pipe(provideEnv(PROD_ENV)));

  it.effect('treats present-but-blank sendgrid vars as absent', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.sendgrid)).toBe(true);
    }).pipe(
      provideEnv({
        ...PROD_ENV,
        SENDGRID_API_KEY: '',
        SENDGRID_LIST_ID: '',
      }),
    ));

  it.effect('resolves the bucket, redacts the secret, and defaults region to auto', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isSome(env.bucket)).toBe(true);
      if (Option.isSome(env.bucket)) {
        expect(env.bucket.value.endpoint).toBe('https://s3.example.com');
        expect(env.bucket.value.bucket).toBe('gycc-content');
        expect(env.bucket.value.region).toBe('auto');
        expect(Redacted.value(env.bucket.value.accessKeyId)).toBe('akid');
        expect(Redacted.value(env.bucket.value.secretAccessKey)).toBe('secret-key');
      }
    }).pipe(
      provideEnv({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: 'https://s3.example.com',
        BUCKET_ACCESS_KEY: 'akid',
        BUCKET_SECRET_KEY: 'secret-key',
        BUCKET_NAME: 'gycc-content',
      }),
    ));

  it.effect('treats present-but-blank bucket vars as absent (env.example placeholders)', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.bucket)).toBe(true);
    }).pipe(
      // Mirrors a freshly-copied `.env.example`: the BUCKET_* keys are present
      // but empty. These must collapse to `Option.none()` so the CMS falls back
      // to its bundled defaults (D3), not a Some(...) of empty strings.
      provideEnv({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: '',
        BUCKET_ACCESS_KEY: '',
        BUCKET_SECRET_KEY: '',
        BUCKET_NAME: '',
        BUCKET_REGION: 'auto',
      }),
    ));

  it.effect('treats whitespace-only bucket vars as absent', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.bucket)).toBe(true);
    }).pipe(
      provideEnv({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: '   ',
        BUCKET_ACCESS_KEY: '  ',
        BUCKET_SECRET_KEY: '\t',
        BUCKET_NAME: ' ',
      }),
    ));

  it.effect('treats a partially-blank bucket group as absent', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      expect(Option.isNone(env.bucket)).toBe(true);
    }).pipe(
      // Endpoint set, but the rest left blank — not a usable bucket, so None.
      provideEnv({
        NODE_ENV: 'development',
        BUCKET_ENDPOINT: 'https://s3.example.com',
        BUCKET_ACCESS_KEY: '',
        BUCKET_SECRET_KEY: '',
        BUCKET_NAME: '',
      }),
    ));

  it.effect('honours an explicit BUCKET_REGION', () =>
    Effect.gen(function* () {
      const env = yield* Env.Service;
      if (Option.isSome(env.bucket)) {
        expect(env.bucket.value.region).toBe('us-east-1');
      } else {
        throw new Error('expected bucket to be configured');
      }
    }).pipe(
      provideEnv({
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
  it.effect('is a no-op outside production', () =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service;
      yield* mailer.send({ subject: 's', content: 'c' });
    }).pipe(
      Effect.provide(Layer.provide(Mailer.layer, envLayer({ NODE_ENV: 'development' }))),
    ));
});

describe('Sendgrid', () => {
  it.effect('fails with SendgridDisabled when unconfigured', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const sendgrid = yield* Sendgrid.Service;
          yield* sendgrid.subscribe('a@b.com', 'Ada Lovelace');
        }),
      );
      expect(error).toBeInstanceOf(SendgridDisabled);
    }).pipe(
      Effect.provide(Layer.provide(Sendgrid.layer, envLayer({ NODE_ENV: 'development' }))),
    ));
});
