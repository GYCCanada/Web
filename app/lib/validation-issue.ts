import { Result, Schema, SchemaIssue } from 'effect';
import type { Issue } from 'effect/SchemaIssue';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export const ValidationPathSegment = Schema.Union([
  Schema.String,
  Schema.Number,
]);
export type ValidationPathSegment = typeof ValidationPathSegment.Type;

/** A transport-neutral validation failure with a structured data path. */
export const ValidationIssue = Schema.Struct({
  path: Schema.Array(ValidationPathSegment),
  message: Schema.String,
});
export type ValidationIssue = typeof ValidationIssue.Type;

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

const structuredPath = (
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): ReadonlyArray<ValidationPathSegment> => {
  if (path === undefined) return [];
  return path.flatMap((segment) => {
    const value =
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? segment.key
        : segment;
    return typeof value === 'string' || typeof value === 'number' ? [value] : [];
  });
};

/** Flatten an Effect Schema issue tree without choosing a UI field-name syntax. */
export const validationIssues = <A>(
  result: Result.Result<A, Issue>,
): ReadonlyArray<ValidationIssue> =>
  Result.isSuccess(result)
    ? []
    : formatter(result.failure).issues.map((issue) => ({
        path: structuredPath(issue.path),
        message: issue.message,
      }));
