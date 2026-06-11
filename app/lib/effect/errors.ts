import { Schema } from 'effect';

/**
 * Tagged HTTP error taxonomy. These model the HTTP-shaped failures a
 * loader/action can produce; the Effect runtime (`runtime.ts`) maps the
 * response-shaped tags (`RedirectError`, `NotFoundError`, `BadRequestError`,
 * `InternalServerError`) onto the matching React Router response (`redirect`,
 * `data(..., { status })`) before the raw `Response` passthrough. Failing with
 * the error object — rather than throwing a `Response` inside the effect —
 * keeps the failure channel typed and lets the runtime own the HTTP
 * translation.
 *
 * `FormValidationError` is deliberately *not* HTTP-mapped: the form pipeline
 * (C3's `routeFormAction`) reports it back through conform, so if it ever
 * reaches the runtime directly it falls through to the generic 500.
 *
 * Tags use the short, domain-namespaced `Http.*` convention so the failure
 * surface reads as one cohesive taxonomy.
 */

/** Redirect (3xx). `init` carries response init (e.g. set-cookie headers). */
export class RedirectError extends Schema.TaggedErrorClass<RedirectError>()(
  'Http.Redirect',
  {
    url: Schema.Union([Schema.String, Schema.URL]),
    init: Schema.optional(Schema.Unknown),
  },
) {
  static is = Schema.is(this);
}

/** Not found (404). */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  'Http.NotFound',
  {},
) {
  static is = Schema.is(this);
}

/** Bad request (400). Optional `message` surfaces in the response payload. */
export class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  'Http.BadRequest',
  { message: Schema.optional(Schema.String) },
) {
  static is = Schema.is(this);
}

/** Internal server error (500). */
export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  'Http.InternalServerError',
  {},
) {
  static is = Schema.is(this);
}

/**
 * Form validation failure. Carries the conform-shaped error buckets
 * (`formErrors` / `fieldErrors`) so the form pipeline (C3) can hand them to
 * `report()`. Field keys are conform field names, not dotted paths.
 */
export class FormValidationError extends Schema.TaggedErrorClass<FormValidationError>()(
  'Http.FormValidation',
  {
    error: Schema.Struct({
      formErrors: Schema.optional(Schema.Array(Schema.String)),
      fieldErrors: Schema.optional(
        Schema.Record(Schema.String, Schema.Array(Schema.String)),
      ),
    }),
  },
) {
  static is = Schema.is(this);
}

export type HttpError =
  | RedirectError
  | NotFoundError
  | BadRequestError
  | InternalServerError
  | FormValidationError;

/** Validation error payload carried by {@link FormValidationError}. */
export type FormValidationErrorInput = FormValidationError['error'];

/**
 * Build a {@link RedirectError}. The instance is a yieldable Effect error, so
 * `yield* redirect(url, init)` fails the effect; the runtime forwards `init` to
 * React Router's `redirect(url, init)`, so set-cookie headers etc. survive.
 */
export function redirect(url: string | URL, init?: ResponseInit): RedirectError {
  return new RedirectError({ url, init });
}

/** Build a {@link NotFoundError} (yieldable). */
export function notFound(): NotFoundError {
  return new NotFoundError();
}

/** Build a {@link FormValidationError} (yieldable). */
export function formValidationError(
  error: FormValidationErrorInput,
): FormValidationError {
  return new FormValidationError({ error });
}
