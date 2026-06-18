import type { Submission, SubmissionResult } from '@conform-to/react/future';
import { parseSubmission, report } from '@conform-to/react/future';
import { Context, Effect } from 'effect';

import { isHoneypotTriggered } from '../honeypot';
import {
  BadRequestError,
  FormValidationError,
  InternalServerError,
  NotFoundError,
  RedirectError,
} from './errors';
import { ReactRouterContext, type RouteArgs } from './router-context';
import type { AppError, AppServices } from './runtime';

/**
 * The parsed conform `/future` {@link Submission} for the in-flight form
 * action. Provided by {@link routeFormAction} so the action body — and the
 * Effect Schema validation helpers — can reach the submission without threading
 * it through arguments.
 */
export class SubmissionContext extends Context.Service<
  SubmissionContext,
  Submission
>()('gycc/lib/effect/form/SubmissionContext') {}

/**
 * Services available inside a {@link routeFormAction} body: everything a normal
 * route effect has, plus the {@link SubmissionContext}.
 */
export type FormServices = AppServices | ReactRouterContext | SubmissionContext;

/**
 * What a form-action body returns on the happy path. `reset` tells conform
 * whether to clear the form after a successful submit.
 */
export interface FormSuccess {
  readonly reset: boolean;
}

/**
 * The value a {@link routeFormAction} resolves to — a conform
 * {@link SubmissionResult} plus a discriminant the client uses to branch on
 * success vs. validation failure. `useForm({ lastResult })` consumes the
 * `result`; the client reads `status` to drive its own post-submit UX.
 */
export type FormResult = {
  readonly result: SubmissionResult<string[]>;
  readonly status: 'success' | 'error';
};

/** Build a successful {@link FormResult} from the body's `reset` flag. */
const successResult = (submission: Submission, reset: boolean): FormResult => ({
  result: report(submission, { reset }),
  status: 'success',
});

/** Build the error-status {@link FormResult} for a set of form-level messages. */
const formLevelError = (submission: Submission, message: string): FormResult => ({
  result: report(submission, { error: { formErrors: [message] } }),
  status: 'error',
});

/** Build the error-status {@link FormResult} from validation error buckets. */
const validationResult = (
  submission: Submission,
  error: FormValidationError['error'],
): FormResult => ({
  result: report(submission, {
    error: {
      // Schema yields readonly arrays; conform's `report` wants mutable ones.
      formErrors: error.formErrors ? [...error.formErrors] : undefined,
      fieldErrors: error.fieldErrors
        ? Object.fromEntries(
            Object.entries(error.fieldErrors).map(([key, value]) => [
              key,
              [...value],
            ]),
          )
        : undefined,
    },
  }),
  status: 'error',
});

/**
 * Map a body failure onto a {@link FormResult}, or re-fail it for the runtime.
 *
 * {@link RedirectError} re-fails so the runtime maps it to a redirect
 * `Response` (C1), letting a successful submit redirect with a flash toast.
 * Validation / request errors become form-level (or field-level) error reports.
 * Anything else (mailer/sendgrid failures, raw `Response`) re-fails to the
 * runtime's generic handling.
 */
const handleFormError = (
  submission: Submission,
  error: AppError,
): Effect.Effect<FormResult, AppError> => {
  if (RedirectError.is(error)) return Effect.fail(error);
  if (FormValidationError.is(error)) {
    return Effect.succeed(validationResult(submission, error.error));
  }
  if (BadRequestError.is(error)) {
    return Effect.succeed(
      formLevelError(submission, error.message || 'Bad request'),
    );
  }
  // A 404 is a route-level outcome, not a form-validation outcome: a disabled
  // page's action (Feature C) and a disabled feature's action (the newsletter
  // when SendGrid is unconfigured) both `notFound()`, and the public must see a
  // real 404 — not a 200 form-error report against a page that doesn't exist.
  // Re-fail so the runtime maps it to a 404 Response (the C1 mapping).
  if (NotFoundError.is(error)) {
    return Effect.fail(error);
  }
  if (InternalServerError.is(error)) {
    return Effect.succeed(formLevelError(submission, 'An error occurred'));
  }
  return Effect.fail(error);
};

/**
 * Conform-based action wrapper. Sits alongside {@link routeHandler} /
 * `routeAction` (which run arbitrary loader/non-form effects); use
 * `routeFormAction` for conform forms that must return a {@link FormResult}.
 *
 * Pipeline (modeled on bureau's `runtime.server.ts form()`, minus intent
 * dispatch):
 * 1. Parse `request.formData()` and {@link parseSubmission}. A parse failure
 *    fails with {@link BadRequestError} — there is no submission to report
 *    against, so it propagates to the runtime and is mapped to a 400 (C1).
 * 2. Provide the {@link SubmissionContext} and run the body generator.
 * 3. Success → `report(submission, { reset })`, `status: 'success'`.
 * 4. Failures are bucketed by {@link handleFormError}: validation/request
 *    errors become form/field error reports; redirects propagate via C1.
 */
export const routeFormAction =
  <Eff extends Effect.Yieldable<any, any, any, FormServices>>(
    body: () => Generator<Eff, FormSuccess, never>,
  ) =>
  (args: RouteArgs): Promise<FormResult> => {
    const pipeline: Effect.Effect<
      FormResult,
      AppError,
      AppServices | ReactRouterContext
    > = Effect.gen(function* () {
      const reactRouter = yield* ReactRouterContext;
      const formData = yield* Effect.tryPromise({
        try: () => reactRouter.request.formData(),
        catch: (cause) =>
          new BadRequestError({
            message:
              cause instanceof Error ? cause.message : 'Unable to read form data',
          }),
      });
      const submission = yield* Effect.try({
        try: () => parseSubmission(formData),
        catch: (cause) =>
          new BadRequestError({
            message:
              cause instanceof Error
                ? cause.message
                : 'Unable to parse form submission',
          }),
      });

      if (isHoneypotTriggered(formData)) {
        yield* Effect.logInfo('Honeypot triggered');
        return successResult(submission, true);
      }

      const bodyEffect = Effect.gen(body) as Effect.Effect<
        FormSuccess,
        AppError,
        FormServices
      >;

      return yield* bodyEffect.pipe(
        Effect.provideService(SubmissionContext, submission),
        Effect.map(({ reset }) => successResult(submission, reset)),
        Effect.catch((error) => handleFormError(submission, error)),
      );
    });

    return args.context.runtime.run(args, pipeline);
  };
