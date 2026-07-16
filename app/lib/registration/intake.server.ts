export * as RegistrationIntake from './intake.server';

import { nanoid } from 'nanoid';
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Result,
  Schema,
  SchemaIssue,
} from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { ConferenceSlug } from '../content/schema';
import { compileForm } from '../forms/compiled-form';
import { FormDefinition } from '../forms/definition';
import { sha256 } from '../forms/form-version';
import {
  FormDefinitionVersionId,
  IdempotencyToken,
  SubmissionGroupId,
  SubmissionId,
} from '../forms/forms.server';
import type { RegistrationShellDecoded } from '../forms/registration-shell';
import { OrderActor } from './order-actor.server';
import { OrderId } from './order-repository.server';
import type { OrderStatus } from './order-transition';

const nanoidSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{21}$/),
);
export const RegistrationId = nanoidSchema.pipe(Schema.brand('RegistrationId'));
export type RegistrationId = typeof RegistrationId.Type;
export const RegistrantId = nanoidSchema.pipe(Schema.brand('RegistrantId'));
export type RegistrantId = typeof RegistrantId.Type;

export type IntakeCommand = {
  readonly conference: typeof ConferenceSlug.Type;
  readonly expectedVersion: FormDefinitionVersionId;
  readonly idempotencyToken: IdempotencyToken;
  readonly shell: unknown;
  readonly at: DateTime.Utc;
};

export type IntakeOrder = {
  readonly id: OrderId;
  readonly status: OrderStatus;
  readonly amount: number;
  readonly checkoutUrl?: string;
};

export type IntakeResult = {
  readonly registrationId: RegistrationId;
  readonly orders: ReadonlyArray<IntakeOrder>;
  readonly replayed: boolean;
};

export class ChannelNotOpen extends Schema.TaggedErrorClass<ChannelNotOpen>()(
  'RegistrationIntake.ChannelNotOpen',
  { conference: ConferenceSlug, state: Schema.String },
) {}

export class DefinitionAdvanced extends Schema.TaggedErrorClass<DefinitionAdvanced>()(
  'RegistrationIntake.DefinitionAdvanced',
  {
    expected: FormDefinitionVersionId,
    current: FormDefinitionVersionId,
  },
) {}

export class Rejected extends Schema.TaggedErrorClass<Rejected>()(
  'RegistrationIntake.Rejected',
  { issues: Schema.Array(Schema.String) },
) {}

export class QuoteUnavailable extends Schema.TaggedErrorClass<QuoteUnavailable>()(
  'RegistrationIntake.QuoteUnavailable',
  { issues: Schema.Array(Schema.String) },
) {}

export class IdempotencyConflict extends Schema.TaggedErrorClass<IdempotencyConflict>()(
  'RegistrationIntake.IdempotencyConflict',
  { token: IdempotencyToken },
) {}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  'RegistrationIntake.PersistenceError',
  { operation: Schema.String },
) {}

type DomainError =
  | ChannelNotOpen
  | DefinitionAdvanced
  | Rejected
  | QuoteUnavailable
  | IdempotencyConflict
  | PersistenceError;

const isDomainError = (error: unknown): error is DomainError =>
  error instanceof ChannelNotOpen ||
  error instanceof DefinitionAdvanced ||
  error instanceof Rejected ||
  error instanceof QuoteUnavailable ||
  error instanceof IdempotencyConflict ||
  error instanceof PersistenceError;

interface ChannelRow {
  readonly state: string;
  readonly formDefinitionVersionId: string | null;
  readonly definitionJson: string | null;
}

interface ReplayRow {
  readonly registrationId: string;
  readonly formDefinitionVersionId: string;
  readonly commandHash: string;
  readonly definitionJson: string;
}

interface OrderRow {
  readonly id: string;
  readonly status: OrderStatus;
  readonly amount: number;
  readonly checkoutUrl: string | null;
}

const decodeDefinition = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);
const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

const canonicalParty = (shell: RegistrationShellDecoded): unknown => {
  if (!('party' in shell)) return null;
  return shell.party._tag === 'group'
    ? {
        _tag: 'group',
        payer: {
          name: shell.party.payer.name,
          email: shell.party.payer.email,
        },
      }
    : { _tag: 'perRegistrant' };
};

const prepareShell = Effect.fn('RegistrationIntake.prepareShell')(function* (
  version: FormDefinitionVersionId,
  definition: FormDefinition,
  input: unknown,
) {
  const compiled = compileForm(definition);
  const decoded = compiled.decodeRegistration(input);
  if (Result.isFailure(decoded)) {
    return yield* new Rejected({
      issues: issueFormatter(decoded.failure).issues.map((issue) => {
        const path = issue.path?.map(String).join('.');
        return path === undefined || path.length === 0
          ? issue.message
          : `${path}: ${issue.message}`;
      }),
    });
  }
  const payloadCodec = Schema.fromJsonString(compiled.codec);
  const payloadJson = yield* Effect.forEach(
    decoded.success.registrants,
    (registrant) => Schema.encodeUnknownEffect(payloadCodec)(registrant),
  ).pipe(Effect.orDie);
  const commandHash = yield* sha256(
    JSON.stringify([version, canonicalParty(decoded.success), ...payloadJson]),
  );
  return { commandHash, compiled, payloadJson, shell: decoded.success };
});

const resultRows = Effect.fn('RegistrationIntake.resultRows')(function* (
  sql: SqlClient,
  registrationId: RegistrationId,
  replayed: boolean,
) {
  const rows = yield* sql<OrderRow>`
    SELECT
      order_id AS id,
      status,
      amount,
      stripe_checkout_url AS "checkoutUrl"
    FROM registration_orders
    WHERE registration_id = ${registrationId}
    ORDER BY ordinal
  `;
  return {
    registrationId,
    replayed,
    orders: rows.map((row) => ({
      id: OrderId.make(row.id),
      status: row.status,
      amount: row.amount,
      ...(row.checkoutUrl === null ? {} : { checkoutUrl: row.checkoutUrl }),
    })),
  } satisfies IntakeResult;
});

export class Service extends Context.Service<
  Service,
  {
    readonly submit: (
      command: IntakeCommand,
    ) => Effect.Effect<IntakeResult, DomainError>;
  }
>()('gycc/lib/registration/intake.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const sender = yield* OrderActor.Sender;

    const submit = Effect.fn('RegistrationIntake.submit')(function* (
      command: IntakeCommand,
    ) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const replay = Effect.gen(function* () {
              const rows = yield* sql<ReplayRow>`
                SELECT
                  registration.registration_id AS "registrationId",
                  registration.form_definition_version_id AS "formDefinitionVersionId",
                  registration.command_hash AS "commandHash",
                  version.definition::text AS "definitionJson"
                FROM registrations AS registration
                JOIN form_definition_versions AS version
                  ON version.form_id = registration.form_id
                 AND version.version_id = registration.form_definition_version_id
                WHERE registration.conference_slug = ${command.conference}
                  AND registration.idempotency_token = ${command.idempotencyToken}
              `;
              const row = rows[0];
              if (row === undefined) return undefined;
              const version = FormDefinitionVersionId.make(
                row.formDefinitionVersionId,
              );
              if (version !== command.expectedVersion) {
                return yield* new IdempotencyConflict({
                  token: command.idempotencyToken,
                });
              }
              const definition = yield* decodeDefinition(row.definitionJson).pipe(
                Effect.orDie,
              );
              const prepared = yield* prepareShell(
                version,
                definition,
                command.shell,
              );
              if (prepared.commandHash !== row.commandHash) {
                return yield* new IdempotencyConflict({
                  token: command.idempotencyToken,
                });
              }
              return yield* resultRows(
                sql,
                RegistrationId.make(row.registrationId),
                true,
              );
            });

            const existing = yield* replay;
            if (existing !== undefined) return existing;

            const channels = yield* sql<ChannelRow>`
              SELECT
                channel.state,
                channel.form_definition_version_id AS "formDefinitionVersionId",
                version.definition::text AS "definitionJson"
              FROM registration_channels AS channel
              LEFT JOIN form_definition_versions AS version
                ON version.form_id = channel.form_id
               AND version.version_id = channel.form_definition_version_id
              WHERE channel.conference_slug = ${command.conference}
              FOR UPDATE OF channel
            `;
            const channel = channels[0];
            if (channel === undefined || channel.state !== 'open') {
              return yield* new ChannelNotOpen({
                conference: command.conference,
                state: channel?.state ?? 'missing',
              });
            }

            const racedReplay = yield* replay;
            if (racedReplay !== undefined) return racedReplay;

            const current = FormDefinitionVersionId.make(
              channel.formDefinitionVersionId ?? '',
            );
            if (current !== command.expectedVersion) {
              return yield* new DefinitionAdvanced({
                expected: command.expectedVersion,
                current,
              });
            }
            const definition = yield* decodeDefinition(
              channel.definitionJson ?? '',
            ).pipe(Effect.orDie);
            const prepared = yield* prepareShell(
              current,
              definition,
              command.shell,
            );
            const quoted = prepared.compiled.quoteRegistration(
              prepared.shell,
              command.at,
            );
            if (!quoted.ok) {
              return yield* new QuoteUnavailable({
                issues: quoted.issues.map((issue) => issue.message),
              });
            }

            const registrationId = RegistrationId.make(nanoid());
            const batchId = SubmissionGroupId.make(nanoid());
            const pricedAt = DateTime.formatIso(quoted.quote.pricedAt);
            const expiresAt = DateTime.formatIso(quoted.quote.expiresAt);

            yield* sql`
              INSERT INTO submission_batches (
                batch_id,
                form_id,
                definition_version_id,
                idempotency_token,
                command_hash
              ) VALUES (
                ${batchId}, 'registration', ${current},
                ${command.idempotencyToken}, ${prepared.commandHash}
              )
            `;
            const registrants: Array<{
              readonly id: RegistrantId;
              readonly submissionId: SubmissionId;
            }> = [];
            for (const [ordinal, payloadJson] of prepared.payloadJson.entries()) {
              const submissionId = SubmissionId.make(nanoid());
              const registrantId = RegistrantId.make(nanoid());
              yield* sql`
                INSERT INTO submissions (
                  submission_id, batch_id, ordinal, payload
                ) VALUES (
                  ${submissionId}, ${batchId}, ${ordinal}, ${payloadJson}::jsonb
                )
              `;
              registrants.push({ id: registrantId, submissionId });
            }

            yield* sql`
              INSERT INTO registrations (
                registration_id,
                conference_slug,
                form_id,
                form_definition_version_id,
                submission_batch_id,
                idempotency_token,
                command_hash,
                billing_mode,
                currency,
                total_amount,
                priced_at,
                quote_expires_at
              ) VALUES (
                ${registrationId}, ${command.conference}, 'registration', ${current},
                ${batchId}, ${command.idempotencyToken}, ${prepared.commandHash},
                ${quoted.quote.mode}, ${quoted.quote.currency},
                ${quoted.quote.total}, ${pricedAt}, ${expiresAt}
              )
            `;

            // Registrants reference their Registration, so insert them after the
            // aggregate root and retain their pre-minted identities above.
            for (const [ordinal, registrant] of registrants.entries()) {
              yield* sql`
                INSERT INTO registrants (
                  registrant_id, registration_id, submission_id, ordinal
                ) VALUES (
                  ${registrant.id}, ${registrationId}, ${registrant.submissionId},
                  ${ordinal}
                )
              `;
            }

            for (const [ordinal, quotedOrder] of quoted.quote.orders.entries()) {
              const orderId = OrderId.make(nanoid());
              const linked =
                quotedOrder._tag === 'group'
                  ? registrants.map((registrant) => registrant.id)
                  : [registrants[quotedOrder.ordinal]?.id].filter(
                      (id): id is RegistrantId => id !== undefined,
                    );
              const snapshot = JSON.stringify({
                ...quotedOrder,
                pricedAt,
                expiresAt,
                registrationClosesAt: DateTime.formatIso(
                  quoted.quote.registrationClosesAt,
                ),
              });
              yield* sql`
                INSERT INTO registration_orders (
                  order_id,
                  registration_id,
                  ordinal,
                  status,
                  amount,
                  currency,
                  receipt_email,
                  quote_snapshot,
                  priced_at,
                  quote_expires_at,
                  stripe_idempotency_key
                ) VALUES (
                  ${orderId}, ${registrationId}, ${ordinal}, 'preparing_checkout',
                  ${quotedOrder.amount}, ${quoted.quote.currency},
                  ${quotedOrder.receiptEmail}, ${snapshot}::jsonb,
                  ${pricedAt}, ${expiresAt}, ${`registration:checkout:${orderId}`}
                )
              `;
              for (const registrantId of linked) {
                yield* sql`
                  INSERT INTO registration_order_registrants (
                    order_id, registrant_id, registration_id
                  ) VALUES (${orderId}, ${registrantId}, ${registrationId})
                `;
              }
              yield* sender.createCheckout(orderId);
            }

            return yield* resultRows(sql, registrationId, false);
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            isDomainError(error)
              ? error
              : new PersistenceError({
                  operation: 'commit Registration intake',
                }),
          ),
        );
    });

    return Service.of({ submit });
  }),
);
