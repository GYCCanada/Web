export * as Env from './env.server';

import { Config, Context, Effect, Layer, Option, Redacted } from 'effect';

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

export class Service extends Context.Service<
  Service,
  {
    readonly isProduction: boolean;
    readonly mail: Option.Option<MailConfig>;
    readonly sendgrid: Option.Option<SendgridConfig>;
    readonly bucket: Option.Option<BucketConfig>;
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

    if (isProduction) {
      const mail = yield* mailConfigRequired;
      return Service.of({
        isProduction,
        mail: Option.some(mail),
        sendgrid,
        bucket,
      });
    }

    const mail = yield* Config.option(mailConfigRequired);
    return Service.of({ isProduction, mail, sendgrid, bucket });
  }),
);

export const defaultLayer = layer;
