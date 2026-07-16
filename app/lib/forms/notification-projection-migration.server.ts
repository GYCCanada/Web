import { Effect, Option, Result, Schema, SchemaIssue } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import {
  FORM_IDS,
  FormDefinition,
  NotificationProjection,
  type FormId as FormIdType,
  type NotificationProjection as NotificationProjectionType,
} from './definition';
import { prepareDefinitionVersion } from './form-version';

export const ProjectionMappings = Schema.Struct({
  contact: Schema.optionalKey(NotificationProjection),
  volunteer: Schema.optionalKey(NotificationProjection),
  registration: Schema.optionalKey(NotificationProjection),
});
export type ProjectionMappings = typeof ProjectionMappings.Type;

export class Rejected extends Schema.TaggedErrorClass<Rejected>()(
  'NotificationProjectionMigration.Rejected',
  { issues: Schema.Array(Schema.String) },
) {
  static is = Schema.is(this);
}

export interface Entry {
  readonly form: FormIdType;
  readonly currentVersion: string;
  readonly proposedVersion: string | null;
  readonly status: 'current' | 'ready' | 'needs-mapping';
  readonly issues: readonly string[];
}

export interface Report {
  readonly applied: boolean;
  readonly entries: readonly Entry[];
}

interface CurrentRow {
  readonly form: string;
  readonly version: string;
  readonly definitionJson: string;
}

const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();
const explain = (error: Schema.SchemaError): readonly string[] =>
  issueFormatter(error.issue).issues.map((issue) => issue.message);

const decodeDefinition = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);

interface PreparedEntry extends Entry {
  readonly definitionJson: string | null;
}

/**
 * Preflight and optionally apply projection versions before deploying code that
 * makes the startup audit a readiness postcondition. Custom historical field
 * names are supplied through `mappings`; canonical definitions need no mapping.
 */
export const migrate = Effect.fn(
  'NotificationProjectionMigration.migrate',
)(function* (options: {
  readonly apply: boolean;
  readonly mappings: ProjectionMappings;
}) {
  const sql = yield* SqlClient;
  const rows = yield* sql<CurrentRow>`
    SELECT
      form.form_id AS form,
      version.version_id AS version,
      version.definition::text AS "definitionJson"
    FROM forms AS form
    JOIN form_definition_versions AS version
      ON version.form_id = form.form_id
     AND version.version_id = form.current_version_id
    ORDER BY form.form_id
  `;
  const byForm = new Map(rows.map((row) => [row.form, row] as const));
  const prepared: PreparedEntry[] = [];

  for (const form of FORM_IDS) {
    const row = Option.fromNullishOr(byForm.get(form));
    if (Option.isNone(row)) {
      prepared.push({
        form,
        currentVersion: '(unpublished)',
        proposedVersion: null,
        status: 'needs-mapping',
        issues: [`${form} has no current definition`],
        definitionJson: null,
      });
      continue;
    }
    const decoded = yield* decodeDefinition(row.value.definitionJson);
    const explicit = options.mappings[form] as
      | NotificationProjectionType
      | undefined;
    // An explicit operator mapping is authoritative even when a projection is
    // already present: contract upgrades may invalidate a shape accepted by the
    // previous release, and this preflight must remain able to repair it.
    const candidate =
      explicit === undefined ? decoded : { ...decoded, notification: explicit };
    const result = yield* prepareDefinitionVersion(form, candidate).pipe(
      Effect.result,
    );
    if (Result.isFailure(result)) {
      prepared.push({
        form,
        currentVersion: row.value.version,
        proposedVersion: null,
        status: 'needs-mapping',
        issues: explain(result.failure),
        definitionJson: null,
      });
      continue;
    }
    prepared.push({
      form,
      currentVersion: row.value.version,
      proposedVersion: result.success.version,
      status:
        result.success.version === row.value.version ? 'current' : 'ready',
      issues: [],
      definitionJson: result.success.definitionJson,
    });
  }

  const rejected = prepared.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.form}: ${issue}`),
  );
  if (options.apply && rejected.length > 0) {
    return yield* new Rejected({ issues: rejected });
  }

  if (options.apply) {
    yield* sql.withTransaction(
      Effect.forEach(
        prepared.filter((entry) => entry.status === 'ready'),
        (entry) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO form_definition_versions (
                form_id,
                version_id,
                definition
              ) VALUES (
                ${entry.form},
                ${entry.proposedVersion},
                ${entry.definitionJson}::jsonb
              )
              ON CONFLICT (form_id, version_id) DO NOTHING
            `;
            const updated = yield* sql<{ readonly version: string }>`
              UPDATE forms
              SET current_version_id = ${entry.proposedVersion}
              WHERE form_id = ${entry.form}
                AND current_version_id = ${entry.currentVersion}
              RETURNING current_version_id AS version
            `;
            if (updated.length === 0) {
              return yield* new Rejected({
                issues: [
                  `${entry.form}: current definition advanced during migration; rerun dry-run`,
                ],
              });
            }
          }),
        { discard: true },
      ),
    );
  }

  return {
    applied: options.apply,
    entries: prepared.map(({ definitionJson: _, ...entry }) => entry),
  } satisfies Report;
});
