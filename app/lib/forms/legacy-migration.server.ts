import { Effect, Option, Schema, SchemaIssue } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import {
  defaultContactForm,
  defaultRegistrationForm,
  defaultVolunteerForm,
} from '../content/pages/defaults';
import { IsoDate, ListItemId } from '../content/schema';
import { deterministicListItemId } from '../content/schema.server';
import { Storage } from '../storage.server';

import { definitionToSchema } from './decode';
import { FORM_IDS, FormDefinition, FormId, type FormId as FormIdType } from './definition';
import {
  prepareDefinitionVersion,
  submissionCommandHash,
} from './form-version';
import type { FormDefinitionVersionId } from './submission-command';

const DEFAULTS = {
  contact: defaultContactForm,
  volunteer: defaultVolunteerForm,
  registration: defaultRegistrationForm,
} as const satisfies Record<FormIdType, FormDefinition>;

const FORM_KEY = /^forms\/(contact|volunteer|registration)\.json$/;
const SUBMISSION_KEY =
  /^submissions\/(contact|volunteer|registration)\/([A-Za-z0-9_-]{21})\.json$/;

const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();
const explainSchemaError = (error: Schema.SchemaError): string =>
  issueFormatter(error.issue).issues
    .map((issue) => {
      const path = issue.path?.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

export class Rejected extends Schema.TaggedErrorClass<Rejected>()(
  'LegacyFormsMigration.Rejected',
  { issues: Schema.Array(Schema.String) },
) {
  static is = Schema.is(this);
}

export interface Report {
  readonly applied: boolean;
  readonly definitions: number;
  readonly legacyDefinitionObjects: number;
  readonly submissions: number;
  readonly alreadyImportedSubmissions: number;
  readonly ignoredDraftObjects: number;
}

interface PreparedDefinition {
  readonly form: FormIdType;
  readonly definition: FormDefinition;
  readonly definitionJson: string;
  readonly version: FormDefinitionVersionId;
  readonly bundledVersion: FormDefinitionVersionId;
}

interface PreparedSubmission {
  readonly key: string;
  readonly id: string;
  readonly legacyId: string;
  readonly form: FormIdType;
  readonly submittedAt: string;
  readonly payloadJson: string;
  readonly definitionVersion: FormDefinitionVersionId;
  readonly commandHash: string;
}

const readText = Effect.fn('LegacyFormsMigration.readText')(function* (
  key: string,
) {
  const object = yield* (yield* Storage.Service).get(key);
  return yield* Effect.promise(() => new Response(object.stream).text());
});

const decodeAt = <A>(
  key: string,
  schema: Schema.Decoder<A, never>,
  json: string,
) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(json).pipe(
    Effect.mapError(
      (error) =>
        new Rejected({ issues: [`${key}: ${explainSchemaError(error)}`] }),
    ),
  );

const prepare = Effect.fn('LegacyFormsMigration.prepare')(function* () {
  const storage = yield* Storage.Service;
  const formObjects = yield* storage.list('forms/');
  const submissionObjects = yield* storage.list('submissions/');
  const publishedFormKeys = new Map<FormIdType, string>();
  let ignoredDraftObjects = 0;
  const invalidKeys: string[] = [];

  for (const object of formObjects) {
    const match = FORM_KEY.exec(object.key);
    if (match !== null) {
      publishedFormKeys.set(Schema.decodeUnknownSync(FormId)(match[1]), object.key);
    } else if (object.key.endsWith('.draft.json')) {
      ignoredDraftObjects += 1;
    } else {
      invalidKeys.push(`${object.key}: unrecognized legacy Form object key`);
    }
  }

  const definitions = new Map<FormIdType, PreparedDefinition>();
  for (const form of FORM_IDS) {
    const legacyKey = publishedFormKeys.get(form);
    const input =
      legacyKey === undefined
        ? DEFAULTS[form]
        : yield* readText(legacyKey).pipe(
            Effect.flatMap((json) => decodeAt(legacyKey, FormDefinition, json)),
          );
    const prepared = yield* prepareDefinitionVersion(form, input).pipe(
      Effect.mapError(
        (error) =>
          new Rejected({
            issues: [
              `${legacyKey ?? `bundled ${form} definition`}: ${explainSchemaError(error)}`,
            ],
          }),
      ),
    );
    const bundled = yield* prepareDefinitionVersion(form, DEFAULTS[form]).pipe(
      Effect.orDie,
    );
    definitions.set(form, {
      form,
      definition: prepared.definition,
      definitionJson: prepared.definitionJson,
      version: prepared.version,
      bundledVersion: bundled.version,
    });
  }

  const submissions: PreparedSubmission[] = [];
  for (const object of submissionObjects) {
    const match = SUBMISSION_KEY.exec(object.key);
    if (match === null) {
      invalidKeys.push(`${object.key}: unrecognized legacy Submission object key`);
      continue;
    }
    const form = Schema.decodeUnknownSync(FormId)(match[1]);
    const legacyId = ListItemId.make(match[2]!);
    const definition = definitions.get(form);
    if (definition === undefined) {
      invalidKeys.push(`${object.key}: no definition prepared for ${form}`);
      continue;
    }
    const schema = Schema.Struct({
      id: ListItemId,
      form: FormId,
      submittedAt: IsoDate,
      payload: definitionToSchema(definition.definition),
    });
    const decoded = yield* readText(object.key).pipe(
      Effect.flatMap((json) => decodeAt(object.key, schema, json)),
    );
    if (decoded.id !== legacyId || decoded.form !== form) {
      invalidKeys.push(
        `${object.key}: envelope identity does not match its object key`,
      );
      continue;
    }
    const payloadJson = yield* Schema.encodeUnknownEffect(
      Schema.fromJsonString(definitionToSchema(definition.definition)),
    )(decoded.payload).pipe(Effect.orDie);
    submissions.push({
      key: object.key,
      id: deterministicListItemId(`legacy-submission:${form}:${legacyId}`),
      legacyId,
      form,
      submittedAt: `${decoded.submittedAt}T00:00:00.000Z`,
      payloadJson,
      definitionVersion: definition.version,
      commandHash: yield* submissionCommandHash(
        definition.version,
        [payloadJson],
      ),
    });
  }

  if (invalidKeys.length > 0) {
    return yield* new Rejected({ issues: invalidKeys });
  }
  return {
    definitions: [...definitions.values()],
    submissions,
    ignoredDraftObjects,
    legacyDefinitionObjects: publishedFormKeys.size,
  };
});

interface CurrentRow {
  readonly form: string;
  readonly currentVersion: string | null;
}

interface ExistingBatchRow {
  readonly form: string;
  readonly version: string;
  readonly token: string;
  readonly commandHash: string;
  readonly submittedAtMatches: boolean;
  readonly submissionId: string | null;
  readonly payloadMatches: boolean;
}

/** Validate every legacy object, then optionally import the complete set atomically. */
export const migrate = Effect.fn('LegacyFormsMigration.migrate')(function* (
  options: { readonly apply: boolean },
) {
  const prepared = yield* prepare();
  const sql = yield* SqlClient;
  const ids = prepared.submissions.map((submission) => submission.id);
  const existingCount =
    ids.length === 0
      ? 0
      : Number(
          (
            yield* sql<{ count: string }>`
              SELECT count(*)::text AS count
              FROM submission_batches
              WHERE batch_id IN ${sql.in(ids)}
            `
          )[0]?.count ?? '0',
        );

  const report = {
    applied: options.apply,
    definitions: prepared.definitions.length,
    legacyDefinitionObjects: prepared.legacyDefinitionObjects,
    submissions: prepared.submissions.length,
    alreadyImportedSubmissions: existingCount,
    ignoredDraftObjects: prepared.ignoredDraftObjects,
  } satisfies Report;
  if (!options.apply) return report;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const currentRows = yield* sql<CurrentRow>`
        SELECT form_id AS form, current_version_id AS "currentVersion"
        FROM forms
        FOR UPDATE
      `;
      const currentByForm = new Map(
        currentRows.map((row) => [row.form, row.currentVersion]),
      );

      const conflicts: string[] = [];
      for (const definition of prepared.definitions) {
        const current = currentByForm.get(definition.form);
        if (
          current !== undefined &&
          current !== null &&
          current !== definition.bundledVersion &&
          current !== definition.version
        ) {
          conflicts.push(
            `${definition.form}: current version ${current} has advanced beyond the bundled or legacy definition`,
          );
        }
      }
      if (conflicts.length > 0) return yield* new Rejected({ issues: conflicts });

      for (const definition of prepared.definitions) {
        yield* sql`
          INSERT INTO forms (form_id)
          VALUES (${definition.form})
          ON CONFLICT (form_id) DO NOTHING
        `;
        yield* sql`
          INSERT INTO form_definition_versions (form_id, version_id, definition)
          VALUES (
            ${definition.form},
            ${definition.version},
            ${definition.definitionJson}::jsonb
          )
          ON CONFLICT (form_id, version_id) DO NOTHING
        `;
        yield* sql`
          UPDATE forms
          SET current_version_id = ${definition.version}
          WHERE form_id = ${definition.form}
        `;
      }

      for (const submission of prepared.submissions) {
        const token = `legacy:${submission.form}:${submission.legacyId}`;
        yield* sql`
          INSERT INTO submission_batches (
            batch_id,
            form_id,
            definition_version_id,
            idempotency_token,
            command_hash,
            submitted_at
          ) VALUES (
            ${submission.id},
            ${submission.form},
            ${submission.definitionVersion},
            ${token},
            ${submission.commandHash},
            ${submission.submittedAt}
          )
          ON CONFLICT (batch_id) DO NOTHING
        `;
        yield* sql`
          INSERT INTO submissions (submission_id, batch_id, ordinal, payload)
          VALUES (
            ${submission.id},
            ${submission.id},
            0,
            ${submission.payloadJson}::jsonb
          )
          ON CONFLICT (submission_id) DO NOTHING
        `;
        const rows = yield* sql<ExistingBatchRow>`
          SELECT
            batch.form_id AS form,
            batch.definition_version_id AS version,
            batch.idempotency_token AS token,
            batch.command_hash AS "commandHash",
            batch.submitted_at = ${submission.submittedAt}::timestamptz
              AS "submittedAtMatches",
            submission.submission_id AS "submissionId",
            submission.payload = ${submission.payloadJson}::jsonb
              AS "payloadMatches"
          FROM submission_batches AS batch
          LEFT JOIN submissions AS submission
            ON submission.batch_id = batch.batch_id AND submission.ordinal = 0
          WHERE batch.batch_id = ${submission.id}
        `;
        const row = Option.fromNullishOr(rows[0]);
        if (
          Option.isNone(row) ||
          row.value.form !== submission.form ||
          row.value.version !== submission.definitionVersion ||
          row.value.token !== token ||
          row.value.commandHash !== submission.commandHash ||
          !row.value.submittedAtMatches ||
          row.value.submissionId !== submission.id ||
          !row.value.payloadMatches
        ) {
          return yield* new Rejected({
            issues: [`${submission.key}: conflicts with an existing relational record`],
          });
        }
      }
    }),
  );
  return report;
});
