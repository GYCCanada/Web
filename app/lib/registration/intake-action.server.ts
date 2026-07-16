import { Clock, DateTime, Effect, Result, Schema } from 'effect';
import { redirect } from 'react-router';

import { formValidationError } from '../effect/errors';
import { ConferenceSlug } from '../content/schema';
import {
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatSchemaResult, parseSchema } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import { Forms } from '../forms/forms.server';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
} from '../forms/submission-command';
import { getLocale } from '../localization/localization';
import { RegistrationIntake } from './intake.server';

/** Public web adapter for the transactional first-party Registration aggregate. */
export const registrationIntakeAction = routeFormAction(function* () {
  const { params } = yield* ReactRouterContext;
  const submission = yield* SubmissionContext;
  const command = parseSchema(
    Schema.Struct({
      [FORM_VERSION_FIELD]: Forms.FormDefinitionVersionId,
      [IDEMPOTENCY_TOKEN_FIELD]: Forms.IdempotencyToken,
      registrants: Schema.NonEmptyArray(Schema.Unknown),
      party: Schema.optionalKey(Schema.Unknown),
    }),
    submission.payload,
  );
  if (Result.isFailure(command)) {
    return yield* formValidationError(formatSchemaResult(command) ?? {});
  }

  const now = yield* Clock.currentTimeMillis;
  const result = yield* (yield* RegistrationIntake.Service)
    .submit({
      conference: ConferenceSlug.make('/2026'),
      expectedVersion: command.success[FORM_VERSION_FIELD],
      idempotencyToken: command.success[IDEMPOTENCY_TOKEN_FIELD],
      shell: submission.payload,
      at: DateTime.makeUnsafe(now),
    })
    .pipe(
      Effect.catchTags({
        'RegistrationIntake.Rejected': (error) =>
          formValidationError({ formErrors: [...error.issues] }),
        'RegistrationIntake.QuoteUnavailable': (error) =>
          formValidationError({ formErrors: [...error.issues] }),
        'RegistrationIntake.DefinitionAdvanced': () =>
          formValidationError(
            { formErrors: ['registration.form.error'] },
            'refreshDefinition',
          ),
        'RegistrationIntake.IdempotencyConflict': () =>
          formValidationError(
            { formErrors: ['registration.form.error'] },
            'rotateToken',
          ),
        'RegistrationIntake.ChannelNotOpen': () =>
          formValidationError({ formErrors: ['registration.form.error'] }),
        'RegistrationIntake.PersistenceError': () =>
          formValidationError({ formErrors: ['registration.form.error'] }),
      }),
    );

  const prefix = getLocale(params) === 'fr' ? '/fr' : '';
  return yield* Effect.fail(
    redirect(
      `${prefix}/registration/status?registration=${encodeURIComponent(result.registrationId)}`,
      { status: 303 },
    ),
  );
}, {
  preserveFields: [FORM_VERSION_FIELD, IDEMPOTENCY_TOKEN_FIELD],
});
