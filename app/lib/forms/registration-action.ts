import { Effect, Result, Schema } from 'effect';

import { Content } from '../content.server';
import { formValidationError } from '../effect/errors';
import {
  type FormSuccess,
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatSchemaResult, parseSchema } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import { Mailer } from '../mailer.server';
import { Toast } from '../toast.server';

import type { SuccessToast } from './action';
import { Forms } from './forms.server';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
} from './submission-command';

/** Web adapter for an atomic, non-empty registration Submission batch. */

/**
 * Configure the registration action. `notify` runs the registration-specific
 * notification over committed registrant records and fails (with any `AppError`, e.g. a
 * mailer failure mapped to a form-level key) to abort the redirect; `success` is
 * the post-submit toast copy.
 */
export interface RegistrationActionConfig<E> {
  readonly notify: (
    submissions: ReadonlyArray<Forms.Submission<'registration'>>,
  ) => Effect.Effect<
    void,
    E,
    ReactRouterContext | Content.Service | Mailer.Service
  >;
  readonly success: SuccessToast;
}

/**
 * Build the registration route `action`. The three `{2024,2025,2026}/form` route
 * modules export `export const action = registrationAction({ notify, success })`
 * — no inline pipeline, exactly like a `formAction` caller. On the happy path the
 * terminal `toast.redirect` fails with a `RedirectError` the wrapper forwards, so
 * the {@link FormSuccess} return is unreachable on success.
 */
export const registrationAction = <E>(config: RegistrationActionConfig<E>) =>
  routeFormAction(function* () {
    const { url } = yield* ReactRouterContext;
    const submission = yield* SubmissionContext;
    const forms = yield* Forms.Service;
    const toast = yield* Toast;

    const commandSchema = Schema.Struct({
      [FORM_VERSION_FIELD]: Forms.FormDefinitionVersionId,
      [IDEMPOTENCY_TOKEN_FIELD]: Forms.IdempotencyToken,
      registrants: Schema.NonEmptyArray(Schema.Unknown),
    });

    const decoded = parseSchema(commandSchema, submission.payload);
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }

    const stored = yield* forms
      .submit({
        form: 'registration',
        expectedVersion: decoded.success[FORM_VERSION_FIELD],
        idempotencyToken: decoded.success[IDEMPOTENCY_TOKEN_FIELD],
        payloads: decoded.success.registrants,
      })
      .pipe(
        Effect.catchTag('Forms.SubmissionRejected', (error) => {
          const formErrors = error.issues.flatMap((issue) => issue.formErrors);
          const fieldErrors = Object.fromEntries(
            error.issues.flatMap((issue) =>
              Object.entries(issue.fieldErrors).map(([field, messages]) => [
                `registrants[${issue.index}].${field}`,
                messages,
              ]),
            ),
          );
          return formValidationError({ formErrors, fieldErrors });
        }),
        Effect.catchTags({
          'Forms.DefinitionAdvanced': () =>
            formValidationError(
              { formErrors: ['registration.form.error'] },
              'refreshDefinition',
            ),
          'Forms.IdempotencyConflict': () =>
            formValidationError(
              { formErrors: ['registration.form.error'] },
              'rotateToken',
            ),
          'Forms.FormNotPublished': () =>
            formValidationError(
              { formErrors: ['registration.form.error'] },
              'refreshDefinition',
            ),
        }),
      );

    yield* config.notify(stored.submissions);

    yield* toast.redirect(url.pathname, {
      title: config.success.title,
      description: config.success.description,
      type: 'success',
      form: 'registration',
    });
    return { reset: true } satisfies FormSuccess;
  }, {
    preserveFields: [FORM_VERSION_FIELD, IDEMPOTENCY_TOKEN_FIELD],
  });
