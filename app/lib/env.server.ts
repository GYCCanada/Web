export * as Env from './env.server';

import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect';

import { CurrencyCode } from './forms/pricing';

/**
 * Environment configuration, ported from the former Zod-over-`process.env`
 * discriminated union to Effect `Config` (ADR 0004).
 *
 *   - In `production` every mail variable is **required**; a missing one fails
 *     the layer at boot.
 *   - In `development` / `test` mail is **optional**; the mailer is a no-op.
 *
 * The object-storage **bucket** and **sendgrid** newsletter integration are
 * **optional everywhere** (dev AND prod): the CMS degrades to bundled defaults
 * when no bucket is configured, and the newsletter form is hidden when sendgrid
 * is unconfigured.
 *
 * Secrets (`MAIL_PASS`, `SENDGRID_API_KEY`, `BUCKET_SECRET_KEY`) flow through
 * `Config.redacted` so they are never accidentally logged.
 */

export interface MailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: Redacted.Redacted<string>;
  readonly from: string;
  readonly to: string;
}

export interface SendgridConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly listId: string;
}

export interface StripeConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly webhookSecret: Redacted.Redacted<string>;
  readonly currency: CurrencyCode;
}

export interface BucketConfig {
  readonly endpoint: string;
  readonly accessKeyId: Redacted.Redacted<string>;
  readonly secretAccessKey: Redacted.Redacted<string>;
  readonly bucket: string;
  readonly region: string;
}

export interface DatabaseConfig {
  readonly url: Redacted.Redacted<string>;
}

const mailConfigRequired = Config.all({
  host: Config.string('MAIL_HOST'),
  port: Config.number('MAIL_PORT'),
  user: Config.string('MAIL_USER'),
  pass: Config.redacted('MAIL_PASS'),
  from: Config.string('MAIL_FROM'),
  to: Config.string('MAIL_TO'),
});

const isBlankRedacted = (value: Redacted.Redacted<string>): boolean =>
  Redacted.value(value).trim().length === 0;

/**
 * SendGrid newsletter config. Both `SENDGRID_API_KEY` and `SENDGRID_LIST_ID`
 * must be non-blank for the integration to be considered configured (same
 * blank-collapse pattern as the bucket).
 */
const sendgridConfig: Config.Config<Option.Option<SendgridConfig>> = Config.all({
  apiKey: Config.redacted('SENDGRID_API_KEY').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  listId: Config.string('SENDGRID_LIST_ID').pipe(
    Config.map((value) => value.trim()),
    Config.withDefault(''),
  ),
}).pipe(
  Config.map((group) =>
    !isBlankRedacted(group.apiKey) && group.listId.length > 0
      ? Option.some<SendgridConfig>({
          apiKey: group.apiKey,
          listId: group.listId,
        })
      : Option.none(),
  ),
);

/**
 * Stripe payment config. Both `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` must
 * be non-blank for payments to be considered configured (same blank-collapse
 * pattern as sendgrid/bucket). The registrar lands behind this `None`-gate:
 * absent ⇒ the `Payment` service fails `PaymentDisabled`, the on-site path is
 * inert. `currency` is the form-level settlement currency; GYC is CAD-only, so
 * it defaults to `cad` and is decoded through the closed `CurrencyCode` brand —
 * a present-but-unsupported token fails the layer at boot rather than silently
 * mis-settling.
 */
const stripeConfig: Config.Config<Option.Option<StripeConfig>> = Config.all({
  apiKey: Config.redacted('STRIPE_API_KEY').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  webhookSecret: Config.redacted('STRIPE_WEBHOOK_SECRET').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  currency: Config.string('STRIPE_CURRENCY').pipe(
    Config.map((value) => value.trim().toLowerCase()),
    Config.withDefault('cad'),
    Config.mapOrFail((value) =>
      Schema.decodeUnknownEffect(CurrencyCode)(value).pipe(
        Effect.mapError((error) => new Config.ConfigError(error)),
      ),
    ),
  ),
}).pipe(
  Config.map((group) =>
    !isBlankRedacted(group.apiKey) && !isBlankRedacted(group.webhookSecret)
      ? Option.some<StripeConfig>({
          apiKey: group.apiKey,
          webhookSecret: group.webhookSecret,
          currency: group.currency,
        })
      : Option.none(),
  ),
);

/**
 * Bucket config. `endpoint` / `accessKeyId` / `secretAccessKey` / `bucket` are
 * the keys that make a bucket "configured"; `region` defaults to `'auto'` so a
 * missing `BUCKET_REGION` alone never makes the bucket present or absent.
 *
 * A bucket is "configured" only when all four required keys carry a
 * **non-blank** value. We deliberately do NOT lean on `Config.option`'s
 * missing-data semantics here: a present-but-empty env var (e.g. the
 * `BUCKET_ENDPOINT=` shipped in `.env.example`) is a *successful* empty-string
 * parse, not missing data, so `Config.option` would resolve it to
 * `Option.some({ endpoint: '', … })` and wrongly treat the empty placeholders
 * as a real bucket — silently breaking the "fall back to bundled defaults"
 * contract (D3). Instead every required key is read with a `''` default, trimmed,
 * and the whole group collapses to `Option.none()` unless all four are non-blank.
 */
const bucketConfig: Config.Config<Option.Option<BucketConfig>> = Config.all({
  endpoint: Config.string('BUCKET_ENDPOINT').pipe(
    Config.map((value) => value.trim()),
    Config.withDefault(''),
  ),
  accessKeyId: Config.redacted('BUCKET_ACCESS_KEY').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  secretAccessKey: Config.redacted('BUCKET_SECRET_KEY').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  bucket: Config.string('BUCKET_NAME').pipe(
    Config.map((value) => value.trim()),
    Config.withDefault(''),
  ),
  region: Config.string('BUCKET_REGION').pipe(
    Config.map((value) => value.trim()),
    Config.withDefault('auto'),
  ),
}).pipe(
  Config.map((group) =>
    group.endpoint.length > 0 &&
    group.bucket.length > 0 &&
    !isBlankRedacted(group.accessKeyId) &&
    !isBlankRedacted(group.secretAccessKey)
      ? Option.some<BucketConfig>({
          endpoint: group.endpoint,
          accessKeyId: group.accessKeyId,
          secretAccessKey: group.secretAccessKey,
          bucket: group.bucket,
          region: group.region.length > 0 ? group.region : 'auto',
        })
      : Option.none(),
  ),
);

/**
 * Sentinel sqlite in-memory connection string. SQLite treats `':memory:'` as a
 * private, per-connection database — impossible to share across two layer graphs.
 */
const SQLITE_MEMORY = ':memory:';

const isSqliteMemory = (value: Redacted.Redacted<string>): boolean =>
  Redacted.value(value).trim().toLowerCase() === SQLITE_MEMORY;

/**
 * Production guard on the durable Order DB target. The runner (`ServerLive`) and
 * the senders (`AppRuntime`) are two separate layer graphs that coordinate ONLY
 * through the shared sqlite FILE; `':memory:'` gives each graph its OWN private
 * in-memory DB, so a `send` from a route lands in a DB the runner never polls —
 * the route → runner → webhook loop silently breaks. The plan
 * (`docs/order-workflow-plan.md:327`) and `.env.example` already declare this
 * IMPOSSIBLE in production; this turns the documented invariant into a typed
 * boot failure. A `Schema.SchemaError` (not a thrown defect) flows into
 * `Config.ConfigError`, mirroring the `STRIPE_CURRENCY` decode above so the env
 * layer keeps its single `ConfigError` error channel.
 */
const ProductionDatabaseUrl = Schema.Redacted(Schema.String).check(
  Schema.makeFilter<Redacted.Redacted<string>>(
    (url) =>
      isSqliteMemory(url)
        ? "DATABASE_URL must be a sqlite FILE path on a persistent volume in production, never ':memory:' — the runner and request/webhook senders are separate layer graphs that coordinate only through the shared file (docs/order-workflow-plan.md:327)"
        : undefined,
    { title: 'DATABASE_URL' },
  ),
);

/**
 * Durable Order workflow database (encore SQL MessageStorage). OPTIONAL
 * everywhere — when `DATABASE_URL` is unset the durable Order entity is disabled
 * and the app falls back to the existing bucket-only registration/webhook path.
 *
 * Same blank-collapse None-gate as the bucket/stripe/sendgrid configs: read with
 * a `''` default, trimmed, collapsing to `Option.none()` unless non-blank. We do
 * NOT use `Config.option` — a present-but-empty `DATABASE_URL=` (the value
 * shipped in `.env.example`) is a *successful* empty parse, not missing data, so
 * `Config.option` would wrongly resolve it to `Some(Redacted(''))` and treat the
 * empty placeholder as a real DB.
 *
 * The connection string flows through `Config.redacted` so it is never
 * accidentally logged (harmless for a sqlite file path; load-bearing for a
 * future Postgres URL with embedded credentials). In production this MUST be a
 * sqlite FILE path on a persistent volume, never `':memory:'` — the long-lived
 * runner and the request/webhook senders are two separate layer graphs that
 * coordinate ONLY through the shared sqlite file. `:memory:` is read together
 * with `NODE_ENV` so the production rejection fails the env layer at boot
 * (development/test keep `':memory:'` for the single-graph G3 layerTest path).
 */
const databaseConfig: Config.Config<Option.Option<DatabaseConfig>> = Config.all({
  url: Config.redacted('DATABASE_URL').pipe(Config.withDefault(Redacted.make(''))),
  nodeEnv: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
}).pipe(
  Config.mapOrFail(({ url, nodeEnv }) => {
    if (isBlankRedacted(url)) {
      return Effect.succeed(Option.none<DatabaseConfig>());
    }
    if (nodeEnv !== 'production') {
      return Effect.succeed(Option.some<DatabaseConfig>({ url }));
    }
    return Schema.decodeUnknownEffect(ProductionDatabaseUrl)(url).pipe(
      Effect.map((validated) => Option.some<DatabaseConfig>({ url: validated })),
      Effect.mapError((error) => new Config.ConfigError(error)),
    );
  }),
);

export class Service extends Context.Service<
  Service,
  {
    readonly isProduction: boolean;
    readonly mail: Option.Option<MailConfig>;
    readonly sendgrid: Option.Option<SendgridConfig>;
    readonly stripe: Option.Option<StripeConfig>;
    readonly bucket: Option.Option<BucketConfig>;
    readonly database: Option.Option<DatabaseConfig>;
  }
>()('gycc/lib/env.server/Service') {}

/**
 * The `Env` layer, read straight off the platform `Config` (opencode's
 * module-level `export const layer`, `packages/core/src/git.ts:79`). It has no
 * service dependencies, so `defaultLayer` is just `layer` — provided for shape
 * parity with the other services so every consumer can pre-provide `Env`
 * uniformly via `Env.defaultLayer`.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const nodeEnv = yield* Config.string('NODE_ENV').pipe(
      Config.withDefault('development'),
    );
    const isProduction = nodeEnv === 'production';

    const bucket = yield* bucketConfig;
    const sendgrid = yield* sendgridConfig;
    const stripe = yield* stripeConfig;
    const database = yield* databaseConfig;

    if (isProduction) {
      const mail = yield* mailConfigRequired;
      return Service.of({
        isProduction,
        mail: Option.some(mail),
        sendgrid,
        stripe,
        bucket,
        database,
      });
    }

    const mail = yield* Config.option(mailConfigRequired);
    return Service.of({ isProduction, mail, sendgrid, stripe, bucket, database });
  }),
);

export const defaultLayer = layer;
