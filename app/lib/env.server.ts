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
 * The object-storage **bucket** is **optional everywhere** (dev AND prod): the
 * CMS degrades to bundled defaults when no bucket is configured, so a missing
 * bucket must never fail the layer at boot. Only mail/mailchimp keep their
 * dev-optional / prod-required behaviour.
 *
 * Secrets (`MAIL_PASS`, `MAILCHIMP_API_KEY`, `BUCKET_SECRET_KEY`) flow through
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

export interface MailchimpConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly listId: string;
}

export interface BucketConfig {
  readonly endpoint: string;
  readonly accessKeyId: Redacted.Redacted<string>;
  readonly secretAccessKey: Redacted.Redacted<string>;
  readonly bucket: string;
  readonly region: string;
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

const isBlankRedacted = (value: Redacted.Redacted<string>): boolean =>
  Redacted.value(value).trim().length === 0;

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

export class Env extends Context.Service<
  Env,
  {
    readonly isProduction: boolean;
    readonly mail: Option.Option<MailConfig>;
    readonly mailchimp: Option.Option<MailchimpConfig>;
    readonly bucket: Option.Option<BucketConfig>;
  }
>()('gycc/lib/env.server/Env') {
  static layer = Layer.effect(
    Env,
    Effect.gen(function* () {
      const nodeEnv = yield* Config.string('NODE_ENV').pipe(
        Config.withDefault('development'),
      );
      const isProduction = nodeEnv === 'production';

      // Bucket is optional in dev AND prod: a bucket-less prod still serves the
      // bundled defaults, so it must never fail the layer at boot. `bucketConfig`
      // already yields `Option.none()` whenever any required key is missing OR
      // present-but-blank.
      const bucket = yield* bucketConfig;

      if (isProduction) {
        const mail = yield* mailConfigRequired;
        const mailchimp = yield* mailchimpConfigRequired;
        return Env.of({
          isProduction,
          mail: Option.some(mail),
          mailchimp: Option.some(mailchimp),
          bucket,
        });
      }

      const mail = yield* Config.option(mailConfigRequired);
      const mailchimp = yield* Config.option(mailchimpConfigRequired);
      return Env.of({ isProduction, mail, mailchimp, bucket });
    }),
  );
}
