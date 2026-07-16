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

/**
 * The registration server action (registration-launch Branch 7.3 — registration's
 * net-new server persist). Registration is the one form whose payload is NOT a
 * single flat field graph but a repeating `{ registrants: Registrant[] }` shell
 * (registration-spec §"Scope boundary"): a repeating-array-of-variant-items is not
 * a closed `FieldKind`, so it does NOT flow through the flat `formAction` skeleton.
 * It has its own action here, reusing the SAME machinery the flat skeleton uses
 * (`routeFormAction` + `decodeForm`'s codec + `Submissions.persist`) over the
 * array, so the persist-then-notify discipline is identical.
 *
 * Why net-new: the registration route's action was a deliberate no-op
 * (`registration-schema.ts`'s docstring: the schema was never run server-side —
 * only the client `RegistrationStandardSchema` validated). RegFox carries the live
 * 2026 channel (settled #9), so this on-site server path is built + proven but not
 * load-bearing for launch; it seeds the future first-party registrar (CONTEXT
 * §Submission:47) by persisting each registrant as its own durable `Submission`.
 *
 * Pipeline (the same shape `formAction` runs, lifted over the registrant array):
 *   1. `Content.getForm('registration')` → the registration `FormDefinition` (ONE
 *      registrant's graph — the route owns the array shell, registration-spec:39);
 *   2. decode `submission.payload` against
 *      `Schema.Struct({ registrants: Array(definitionToSchema(def)) })` — the same
 *      per-registrant codec the client validates with, wrapped in the array shell,
 *      so a field error keys as `registrants[0].email` (the conform field name the
 *      live form renders, via `formatSchemaResult`) → on failure,
 *      `formValidationError`;
 *   3. `Submissions.persist('registration', registrant)` for EACH decoded
 *      registrant → one durable `submissions/registration/<id>.json` object per
 *      registrant, written BEFORE any notification;
 *   4. `notify(stored)` over the persisted records (a failure cannot lose them —
 *      they are already on the bucket, settled #8);
 *   5. `toast.redirect(pathname, { success copy })`.
 *
 * `derive-dont-sync`: the validation codec AND the persisted payload codec both
 * derive from the stored `FormDefinition` (`definitionToSchema` /
 * `submissionSchema`), never a re-declared registrant struct — editing
 * `forms/registration.json` changes what the form accepts and what it stores with
 * no code change (ADR 0007 + ADR 0008).
 */

/**
 * Configure the registration action. `notify` runs the registration-specific
 * notification over the PERSISTED registrant records (already on the bucket, so
 * the email may reference each record's id) and fails (with any `AppError`, e.g. a
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
            formValidationError({
              formErrors: ['registration.form.error'],
            }),
          'Forms.IdempotencyConflict': () =>
            formValidationError({
              formErrors: ['registration.form.error'],
            }),
          'Forms.FormNotPublished': () =>
            formValidationError({
              formErrors: ['registration.form.error'],
            }),
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
  });
