import { formatPath } from '@conform-to/dom/future';
import type { FormError } from '@conform-to/react/future';
import * as Conform from '@conform-to/react/future';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * conform `/future` facade. Centralizes `configureForms` (wiring Standard Schema
 * validation so `useForm(schema, …)` works with Effect Schema codecs via
 * `Schema.toStandardSchemaV1`) and re-exports the future hooks/components the app
 * uses. Routes import from `~/lib/conform` rather than `@conform-to/react`
 * directly, keeping the classic-vs-future boundary in one place.
 */

/** Runtime type guard: is `schema` a Standard Schema V1 value? */
function isStandardSchemaV1(schema: unknown): schema is StandardSchemaV1 {
  if (schema === null || schema === undefined) return false;
  const kind = typeof schema;
  if (kind !== 'object' && kind !== 'function') return false;
  const candidate = schema as { '~standard'?: { version?: unknown } };
  return (
    typeof candidate['~standard'] === 'object' &&
    candidate['~standard'] !== null &&
    candidate['~standard'].version === 1
  );
}

/**
 * Serialize a Standard Schema issue path into a conform field name. Mirrors the
 * server-side `formatSchemaResult`: object segments (`{ key }`) are unwrapped and
 * numbers stay numeric so {@link formatPath} renders `registrants[0].email`
 * rather than a dotted join that would never attach to the field.
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

/** Bucket Standard Schema issues into conform's `{ formErrors, fieldErrors }`. */
function formatIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): FormError<string[]> {
  const error: FormError<string[]> = { formErrors: null, fieldErrors: {} };
  for (const issue of issues) {
    const name = issuePathToName(issue.path);
    if (name === '') {
      (error.formErrors ??= []).push(issue.message);
    } else {
      (error.fieldErrors[name] ??= []).push(issue.message);
    }
  }
  return error;
}

type ValidationResult = {
  error: FormError<string[]> | null;
  value?: unknown;
};

function resolveResult(
  result: StandardSchemaV1.Result<unknown>,
): ValidationResult {
  if (result.issues) return { error: formatIssues(result.issues) };
  return { error: null, value: result.value };
}

// conform's `InferOutput` is structurally identical to `@standard-schema/spec`'s
// but uses an internal copy of `StandardSchemaV1`, so TS can't reconcile the two
// type paths. Cast at the seam.
const validateStandardSchemaV1 = ((
  schema: StandardSchemaV1,
  payload: Record<string, unknown>,
) => {
  const result = schema['~standard'].validate(payload);
  if (result instanceof Promise) return result.then(resolveResult);
  return resolveResult(result);
}) as Parameters<typeof Conform.configureForms>[0] extends infer C
  ? C extends { validateSchema?: infer V }
    ? NonNullable<V>
    : never
  : never;

const forms = Conform.configureForms({
  isSchema: isStandardSchemaV1,
  validateSchema: validateStandardSchemaV1,
});

export const useForm = forms.useForm as typeof Conform.useForm;
export const useFormMetadata =
  forms.useFormMetadata as typeof Conform.useFormMetadata;
export const useField = forms.useField as typeof Conform.useField;
export const useIntent = forms.useIntent as typeof Conform.useIntent;
export const FormProvider = forms.FormProvider as typeof Conform.FormProvider;

export {
  parseSubmission,
  report,
  useControl,
  useFormData,
} from '@conform-to/react/future';
