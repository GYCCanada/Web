import { formatPath } from '@conform-to/dom/future';
import { Result, Schema, SchemaIssue, SchemaParser } from 'effect';
import type { Issue } from 'effect/SchemaIssue';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { FormValidationErrorInput } from './errors';

/**
 * Conform-shaped validation error buckets. `formErrors` collects path-less
 * (form-level) issues; `fieldErrors` maps a **conform field name** to its
 * messages. Field names are serialized with conform's {@link formatPath}, so a
 * nested-array path round-trips as `registrants[0].email` (the name conform
 * actually renders) rather than a dotted `registrants.0.email` that would never
 * attach to the field.
 */
export interface FormSchemaError {
  readonly formErrors: string[];
  readonly fieldErrors: Record<string, string[]>;
}

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Serialize a Standard Schema issue path into a conform field name. Object path
 * segments (`{ key }`) are unwrapped; numbers stay numeric so {@link formatPath}
 * renders them as `[n]` array indices. Anything that is neither string nor
 * number is dropped — those segments cannot name a form field.
 */
function issuePathToName(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
  if (!path || path.length === 0) return '';
  const segments: Array<string | number> = [];
  for (const segment of path) {
    const value =
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? segment.key
        : segment;
    if (typeof value === 'string' || typeof value === 'number') {
      segments.push(value);
    }
  }
  return formatPath(segments);
}

/**
 * Parse an unknown payload with an Effect Schema, returning a {@link Result}
 * for conform consumption. Pair with {@link formatSchemaResult} in a route
 * action to bucket failures into form/field errors. The failure channel is a
 * {@link Issue} (beta.60 `decodeUnknownResult` returns the issue tree directly,
 * not a wrapping `SchemaError`).
 */
export const parseSchema = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  payload: unknown,
): Result.Result<A, Issue> => SchemaParser.decodeUnknownResult(schema)(payload);

/**
 * Convert an Effect Schema parse {@link Result} into conform's
 * `{ formErrors, fieldErrors }` shape. Returns `null` on success (conform's
 * convention for "no errors"). Issues with no path become form-level errors;
 * the rest are keyed by their {@link issuePathToName conform field name}.
 */
export const formatSchemaResult = <A>(
  result: Result.Result<A, Issue>,
): FormValidationErrorInput | null => {
  if (Result.isSuccess(result)) return null;

  const issues = formatter(result.failure).issues;
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const name = issuePathToName(issue.path);
    if (name === '') {
      formErrors.push(issue.message);
    } else {
      const existing = fieldErrors[name];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[name] = [issue.message];
      }
    }
  }

  return { formErrors, fieldErrors } satisfies FormSchemaError;
};
