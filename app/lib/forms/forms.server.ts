export * as Forms from './forms.server';

import { nanoid } from 'nanoid';
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  SchemaIssue,
} from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Database } from '../database.server';
import {
  defaultContactForm,
  defaultRegistrationForm,
  defaultVolunteerForm,
} from '../content/pages/defaults';
import { ValidationIssue, validationIssues } from '../validation-issue';

import { decodeForm, definitionToSchema } from './decode';
import { FORM_IDS, FormDefinition, FormId } from './definition';
import * as SubmissionCommand from './submission-command';

export const FormDefinitionVersionId =
  SubmissionCommand.FormDefinitionVersionId;
export type FormDefinitionVersionId =
  SubmissionCommand.FormDefinitionVersionId;
export const IdempotencyToken = SubmissionCommand.IdempotencyToken;
export type IdempotencyToken = SubmissionCommand.IdempotencyToken;

const nanoidSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{21}$/),
);

export const SubmissionId = nanoidSchema.pipe(Schema.brand('SubmissionId'));
export type SubmissionId = typeof SubmissionId.Type;

export const SubmissionGroupId = nanoidSchema.pipe(
  Schema.brand('SubmissionGroupId'),
);
export type SubmissionGroupId = typeof SubmissionGroupId.Type;

export type NonEmptyReadonlyArray<A> = readonly [A, ...ReadonlyArray<A>];

export interface PublishedForm<F extends FormId = FormId> {
  readonly form: F;
  readonly version: FormDefinitionVersionId;
  readonly definition: FormDefinition;
  readonly publishedAt: DateTime.Utc;
}

export interface Submission<F extends FormId = FormId> {
  readonly id: SubmissionId;
  readonly groupId: SubmissionGroupId;
  readonly form: F;
  readonly definitionVersion: FormDefinitionVersionId;
  readonly idempotencyToken: IdempotencyToken;
  readonly ordinal: number;
  readonly submittedAt: DateTime.Utc;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SubmissionBatch<F extends FormId = FormId> {
  readonly id: SubmissionGroupId;
  readonly form: F;
  readonly definitionVersion: FormDefinitionVersionId;
  readonly idempotencyToken: IdempotencyToken;
  readonly submittedAt: DateTime.Utc;
  readonly submissions: NonEmptyReadonlyArray<Submission<F>>;
  readonly replayed: boolean;
}

export interface PublishCommand<F extends FormId = FormId> {
  readonly form: F;
  readonly expectedCurrentVersion: Option.Option<FormDefinitionVersionId>;
  readonly definition: unknown;
}

export interface SubmitCommand<F extends FormId = FormId> {
  readonly form: F;
  readonly expectedVersion: FormDefinitionVersionId;
  readonly idempotencyToken: IdempotencyToken;
  readonly payloads: NonEmptyReadonlyArray<unknown>;
}

export class FormNotPublished extends Schema.TaggedErrorClass<FormNotPublished>()(
  'Forms.FormNotPublished',
  { form: FormId },
) {
  static is = Schema.is(this);
}

export class DefinitionRejected extends Schema.TaggedErrorClass<DefinitionRejected>()(
  'Forms.DefinitionRejected',
  { issues: Schema.Array(Schema.String) },
) {
  static is = Schema.is(this);
}

export class PublishConflict extends Schema.TaggedErrorClass<PublishConflict>()(
  'Forms.PublishConflict',
  {
    form: FormId,
    expected: Schema.Option(FormDefinitionVersionId),
    actual: Schema.Option(FormDefinitionVersionId),
  },
) {
  static is = Schema.is(this);
}

export class DefinitionAdvanced extends Schema.TaggedErrorClass<DefinitionAdvanced>()(
  'Forms.DefinitionAdvanced',
  {
    form: FormId,
    expected: FormDefinitionVersionId,
    current: FormDefinitionVersionId,
  },
) {
  static is = Schema.is(this);
}

export const SubmissionIssue = Schema.Struct({
  index: Schema.Number,
  issues: Schema.Array(ValidationIssue),
});
export type SubmissionIssue = typeof SubmissionIssue.Type;

export class SubmissionRejected extends Schema.TaggedErrorClass<SubmissionRejected>()(
  'Forms.SubmissionRejected',
  {
    form: FormId,
    definitionVersion: FormDefinitionVersionId,
    issues: Schema.Array(SubmissionIssue),
  },
) {
  static is = Schema.is(this);
}

export class IdempotencyConflict extends Schema.TaggedErrorClass<IdempotencyConflict>()(
  'Forms.IdempotencyConflict',
  { form: FormId, token: IdempotencyToken },
) {
  static is = Schema.is(this);
}

export class FormPersistenceError extends Schema.TaggedErrorClass<FormPersistenceError>()(
  'Forms.PersistenceError',
  { operation: Schema.String },
) {
  static is = Schema.is(this);
}

type DomainError =
  | FormNotPublished
  | DefinitionRejected
  | PublishConflict
  | DefinitionAdvanced
  | SubmissionRejected
  | IdempotencyConflict
  | FormPersistenceError;

const isDomainError = (error: unknown): error is DomainError =>
  FormNotPublished.is(error) ||
  DefinitionRejected.is(error) ||
  PublishConflict.is(error) ||
  DefinitionAdvanced.is(error) ||
  SubmissionRejected.is(error) ||
  IdempotencyConflict.is(error) ||
  FormPersistenceError.is(error);

const persistenceError = <E>(
  operation: string,
) =>
  (error: E): Extract<E, DomainError> | FormPersistenceError =>
    isDomainError(error)
      ? (error as Extract<E, DomainError>)
      : new FormPersistenceError({ operation });

const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();
const issueMessages = (error: Schema.SchemaError): readonly string[] =>
  issueFormatter(error.issue).issues.map((issue) => {
    const path = issue.path?.map((segment) => String(segment)).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

const decodeDefinition = Schema.decodeUnknownEffect(FormDefinition);
const decodeDefinitionJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);
const encodeDefinitionJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);
const decodeVersion = Schema.decodeUnknownEffect(FormDefinitionVersionId);
const decodeTimestamp = Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString);

const hash = Effect.fn('Forms.hash')(function* (value: string) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
});

interface PublishedRow {
  readonly form: string;
  readonly version: string;
  readonly definitionJson: string;
  readonly publishedAt: string;
}

interface CurrentPointerRow {
  readonly currentVersionId: string | null;
}

interface BatchRow {
  readonly batchId: string;
  readonly definitionVersionId: string;
  readonly idempotencyToken: string;
  readonly commandHash: string;
  readonly submittedAt: string;
}

interface SubmissionRow {
  readonly submissionId: string;
  readonly ordinal: number;
  readonly payloadJson: string;
}

const DEFAULTS = {
  contact: defaultContactForm,
  volunteer: defaultVolunteerForm,
  registration: defaultRegistrationForm,
} as const satisfies Record<FormId, FormDefinition>;

export class Service extends Context.Service<
  Service,
  {
    readonly current: <F extends FormId>(
      form: F,
    ) => Effect.Effect<PublishedForm<F>, FormNotPublished | FormPersistenceError>;
    readonly publish: <F extends FormId>(
      command: PublishCommand<F>,
    ) => Effect.Effect<
      PublishedForm<F>,
      DefinitionRejected | PublishConflict | FormPersistenceError
    >;
    readonly submit: <F extends FormId>(
      command: SubmitCommand<F>,
    ) => Effect.Effect<
      SubmissionBatch<F>,
      | FormNotPublished
      | DefinitionAdvanced
      | SubmissionRejected
      | IdempotencyConflict
      | FormPersistenceError
    >;
  }
>()('@gycc/app/forms/Forms') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    const decodePublished = Effect.fn('Forms.decodePublished')(function* <
      F extends FormId,
    >(row: PublishedRow, form: F) {
      return {
        form,
        version: yield* decodeVersion(row.version),
        definition: yield* decodeDefinitionJson(row.definitionJson),
        publishedAt: yield* decodeTimestamp(row.publishedAt),
      };
    });

    const currentUnmapped = Effect.fn('Forms.current.unmapped')(function* <
      F extends FormId,
    >(
      form: F,
    ) {
      const rows = yield* sql<PublishedRow>`
        SELECT
          form.form_id AS "form",
          version.version_id AS "version",
          version.definition::text AS "definitionJson",
          version.published_at::text AS "publishedAt"
        FROM forms AS form
        JOIN form_definition_versions AS version
          ON version.form_id = form.form_id
         AND version.version_id = form.current_version_id
        WHERE form.form_id = ${form}
      `;
      const row = Option.fromNullishOr(rows[0]);
      if (Option.isNone(row)) return yield* new FormNotPublished({ form });
      return yield* decodePublished(row.value, form);
    });

    const current = Effect.fn('Forms.current')(function* <F extends FormId>(
      form: F,
    ) {
      return yield* currentUnmapped(form).pipe(
        Effect.mapError(persistenceError('read current Form definition')),
      );
    });

    const publishUnmapped = Effect.fn('Forms.publish.unmapped')(function* <
      F extends FormId,
    >(
      command: PublishCommand<F>,
    ) {
      const definition = yield* decodeDefinition(command.definition).pipe(
        Effect.mapError(
          (error) => new DefinitionRejected({ issues: issueMessages(error) }),
        ),
      );
      const definitionJson = yield* encodeDefinitionJson(definition).pipe(
        Effect.orDie,
      );
      const version = FormDefinitionVersionId.make(
        `sha256:${yield* hash(`${command.form}\0${definitionJson}`)}`,
      );

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO forms (form_id)
            VALUES (${command.form})
            ON CONFLICT (form_id) DO NOTHING
          `;
          const pointerRows = yield* sql<CurrentPointerRow>`
            SELECT current_version_id AS "currentVersionId"
            FROM forms
            WHERE form_id = ${command.form}
            FOR UPDATE
          `;
          const pointer = Option.fromNullishOr(pointerRows[0]);
          if (Option.isNone(pointer)) {
            return yield* new FormPersistenceError({ operation: 'lock Form' });
          }
          const actual = Option.fromNullishOr(pointer.value.currentVersionId).pipe(
            Option.map(FormDefinitionVersionId.make),
          );
          if (
            !Option.makeEquivalence<string>((left, right) => left === right)(
              actual,
              command.expectedCurrentVersion,
            )
          ) {
            return yield* new PublishConflict({
              form: command.form,
              expected: command.expectedCurrentVersion,
              actual,
            });
          }

          yield* sql`
            INSERT INTO form_definition_versions (
              form_id,
              version_id,
              definition
            ) VALUES (
              ${command.form},
              ${version},
              ${definitionJson}::jsonb
            )
            ON CONFLICT (form_id, version_id) DO NOTHING
          `;

          const storedRows = yield* sql<{ definitionJson: string }>`
            SELECT definition::text AS "definitionJson"
            FROM form_definition_versions
            WHERE form_id = ${command.form}
              AND version_id = ${version}
          `;
          const stored = Option.fromNullishOr(storedRows[0]);
          if (Option.isNone(stored)) {
            return yield* new FormPersistenceError({ operation: 'verify Form version' });
          }
          const storedDefinition = yield* decodeDefinitionJson(
            stored.value.definitionJson,
          );
          const storedCanonical = yield* encodeDefinitionJson(storedDefinition);
          if (storedCanonical !== definitionJson) {
            return yield* new FormPersistenceError({ operation: 'Form version collision' });
          }

          yield* sql`
            UPDATE forms
            SET current_version_id = ${version}
            WHERE form_id = ${command.form}
          `;

          const publishedRows = yield* sql<PublishedRow>`
            SELECT
              form_id AS "form",
              version_id AS "version",
              definition::text AS "definitionJson",
              published_at::text AS "publishedAt"
            FROM form_definition_versions
            WHERE form_id = ${command.form}
              AND version_id = ${version}
          `;
          const published = Option.fromNullishOr(publishedRows[0]);
          if (Option.isNone(published)) {
            return yield* new FormPersistenceError({ operation: 'read published Form' });
          }
          return yield* decodePublished(published.value, command.form);
        }),
      );
    });

    const publish = Effect.fn('Forms.publish')(function* <F extends FormId>(
      command: PublishCommand<F>,
    ) {
      return yield* publishUnmapped(command).pipe(
        Effect.mapError(persistenceError('publish Form definition')),
      );
    });

    const loadCommitted = Effect.fn('Forms.loadCommitted')(function* <
      F extends FormId,
    >(
      batch: BatchRow,
      form: F,
      definition: FormDefinition,
      replayed: boolean,
    ) {
      const rows = yield* sql<SubmissionRow>`
        SELECT
          submission_id AS "submissionId",
          ordinal,
          payload::text AS "payloadJson"
        FROM submissions
        WHERE batch_id = ${batch.batchId}
        ORDER BY ordinal
      `;
      const submittedAt = yield* decodeTimestamp(batch.submittedAt);
      const definitionVersion = yield* decodeVersion(batch.definitionVersionId);
      const idempotencyToken = IdempotencyToken.make(batch.idempotencyToken);
      const payloadSchema = Schema.fromJsonString(definitionToSchema(definition));
      const submissions = yield* Effect.forEach(rows, (row) =>
        Schema.decodeUnknownEffect(payloadSchema)(row.payloadJson).pipe(
          Effect.map((payload) => ({
            id: SubmissionId.make(row.submissionId),
            groupId: SubmissionGroupId.make(batch.batchId),
            form,
            definitionVersion,
            idempotencyToken,
            ordinal: row.ordinal,
            submittedAt,
            payload,
          })),
        ),
      );
      const first = Option.fromNullishOr(submissions[0]);
      if (Option.isNone(first)) {
        return yield* new FormPersistenceError({ operation: 'read Submission batch' });
      }
      const nonEmptySubmissions: NonEmptyReadonlyArray<Submission<F>> = [
        first.value,
        ...submissions.slice(1),
      ];
      return {
        id: SubmissionGroupId.make(batch.batchId),
        form,
        definitionVersion,
        idempotencyToken,
        submittedAt,
        submissions: nonEmptySubmissions,
        replayed,
      };
    });

    const prepareSubmission = Effect.fn('Forms.prepareSubmission')(function* <
      F extends FormId,
    >(
      command: SubmitCommand<F>,
      definition: FormDefinition,
      definitionVersion: FormDefinitionVersionId,
    ) {
      const decoded: Array<Readonly<Record<string, unknown>>> = [];
      const rejected: Array<SubmissionIssue> = [];
      for (const [index, payload] of command.payloads.entries()) {
        const result = decodeForm(definition, payload);
        if (Result.isSuccess(result)) {
          decoded.push(result.success);
        } else {
          rejected.push({
            index,
            issues: validationIssues(result),
          });
        }
      }
      if (rejected.length > 0) {
        return yield* new SubmissionRejected({
          form: command.form,
          definitionVersion,
          issues: rejected,
        });
      }

      const payloadSchema = Schema.fromJsonString(definitionToSchema(definition));
      const payloadJson = yield* Effect.forEach(decoded, (payload) =>
        Schema.encodeUnknownEffect(payloadSchema)(payload),
      ).pipe(Effect.orDie);
      const commandJson = yield* Schema.encodeUnknownEffect(
        Schema.fromJsonString(Schema.Array(Schema.String)),
      )([definitionVersion, ...payloadJson]).pipe(Effect.orDie);
      return { payloadJson, commandHash: yield* hash(commandJson) };
    });

    const submitUnmapped = Effect.fn('Forms.submit.unmapped')(function* <
      F extends FormId,
    >(
      command: SubmitCommand<F>,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const replayRows = yield* sql<BatchRow>`
            SELECT
              batch_id AS "batchId",
              definition_version_id AS "definitionVersionId",
              idempotency_token AS "idempotencyToken",
              command_hash AS "commandHash",
              submitted_at::text AS "submittedAt"
            FROM submission_batches
            WHERE form_id = ${command.form}
              AND idempotency_token = ${command.idempotencyToken}
          `;
          const replay = Option.fromNullishOr(replayRows[0]);
          if (Option.isSome(replay)) {
            if (replay.value.definitionVersionId !== command.expectedVersion) {
              return yield* new IdempotencyConflict({
                form: command.form,
                token: command.idempotencyToken,
              });
            }
            const versionRows = yield* sql<PublishedRow>`
              SELECT
                form_id AS "form",
                version_id AS "version",
                definition::text AS "definitionJson",
                published_at::text AS "publishedAt"
              FROM form_definition_versions
              WHERE form_id = ${command.form}
                AND version_id = ${command.expectedVersion}
            `;
            const versionRow = Option.fromNullishOr(versionRows[0]);
            if (Option.isNone(versionRow)) {
              return yield* new FormPersistenceError({
                operation: 'read replay Form definition',
              });
            }
            const historical = yield* decodePublished(
              versionRow.value,
              command.form,
            );
            const prepared = yield* prepareSubmission(
              command,
              historical.definition,
              historical.version,
            );
            if (replay.value.commandHash !== prepared.commandHash) {
              return yield* new IdempotencyConflict({
                form: command.form,
                token: command.idempotencyToken,
              });
            }
            return yield* loadCommitted(
              replay.value,
              command.form,
              historical.definition,
              true,
            );
          }

          const currentRows = yield* sql<PublishedRow>`
            SELECT
              form.form_id AS "form",
              version.version_id AS "version",
              version.definition::text AS "definitionJson",
              version.published_at::text AS "publishedAt"
            FROM forms AS form
            JOIN form_definition_versions AS version
              ON version.form_id = form.form_id
             AND version.version_id = form.current_version_id
            WHERE form.form_id = ${command.form}
            FOR SHARE OF form
          `;
          const currentRow = Option.fromNullishOr(currentRows[0]);
          if (Option.isNone(currentRow)) {
            return yield* new FormNotPublished({ form: command.form });
          }
          const published = yield* decodePublished(currentRow.value, command.form);
          if (published.version !== command.expectedVersion) {
            return yield* new DefinitionAdvanced({
              form: command.form,
              expected: command.expectedVersion,
              current: published.version,
            });
          }

          const prepared = yield* prepareSubmission(
            command,
            published.definition,
            published.version,
          );
          const batchId = SubmissionGroupId.make(nanoid());

          const inserted = yield* sql<BatchRow>`
            INSERT INTO submission_batches (
              batch_id,
              form_id,
              definition_version_id,
              idempotency_token,
              command_hash
            ) VALUES (
              ${batchId},
              ${command.form},
              ${published.version},
              ${command.idempotencyToken},
              ${prepared.commandHash}
            )
            ON CONFLICT (form_id, idempotency_token) DO NOTHING
            RETURNING
              batch_id AS "batchId",
              definition_version_id AS "definitionVersionId",
              idempotency_token AS "idempotencyToken",
              command_hash AS "commandHash",
              submitted_at::text AS "submittedAt"
          `;
          const insertedBatch = Option.fromNullishOr(inserted[0]);
          if (Option.isNone(insertedBatch)) {
            const existingRows = yield* sql<BatchRow>`
              SELECT
                batch_id AS "batchId",
                definition_version_id AS "definitionVersionId",
                idempotency_token AS "idempotencyToken",
                command_hash AS "commandHash",
                submitted_at::text AS "submittedAt"
              FROM submission_batches
              WHERE form_id = ${command.form}
                AND idempotency_token = ${command.idempotencyToken}
            `;
            const existing = Option.fromNullishOr(existingRows[0]);
            if (Option.isNone(existing)) {
              return yield* new FormPersistenceError({ operation: 'replay Submission' });
            }
            if (existing.value.commandHash !== prepared.commandHash) {
              return yield* new IdempotencyConflict({
                form: command.form,
                token: command.idempotencyToken,
              });
            }
            return yield* loadCommitted(
              existing.value,
              command.form,
              published.definition,
              true,
            );
          }

          for (const [ordinal, json] of prepared.payloadJson.entries()) {
            yield* sql`
              INSERT INTO submissions (
                submission_id,
                batch_id,
                ordinal,
                payload
              ) VALUES (
                ${SubmissionId.make(nanoid())},
                ${batchId},
                ${ordinal},
                ${json}::jsonb
              )
            `;
          }

          return yield* loadCommitted(
            insertedBatch.value,
            command.form,
            published.definition,
            false,
          );
        }),
      );
    });

    const submit = Effect.fn('Forms.submit')(function* <F extends FormId>(
      command: SubmitCommand<F>,
    ) {
      return yield* submitUnmapped(command).pipe(
        Effect.mapError(persistenceError('submit Form')),
      );
    });

    for (const form of FORM_IDS) {
      yield* sql`
        INSERT INTO forms (form_id)
        VALUES (${form})
        ON CONFLICT (form_id) DO NOTHING
      `;
      const pointerRows = yield* sql<CurrentPointerRow>`
        SELECT current_version_id AS "currentVersionId"
        FROM forms
        WHERE form_id = ${form}
      `;
      const pointer = Option.fromNullishOr(pointerRows[0]).pipe(
        Option.flatMap((row) => Option.fromNullishOr(row.currentVersionId)),
      );
      if (Option.isNone(pointer)) {
        yield* publish({
          form,
          expectedCurrentVersion: Option.none(),
          definition: DEFAULTS[form],
        }).pipe(
          Effect.catchTag('Forms.PublishConflict', () => Effect.void),
        );
      }
    }

    return Service.of({ current, publish, submit });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(Database.layer));
