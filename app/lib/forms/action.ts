import { Effect, Result } from 'effect';

import { Content } from '../content.server';
import type { FormId } from '../content/pages/registry';
import { formValidationError } from '../effect/errors';
import {
  type FormSuccess,
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatSchemaResult } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import type { TranslationKey } from '../localization/translations';
import { Mailer } from '../mailer.server';
import { Toast } from '../toast.server';

import { decodeForm, type DecodedForm } from './decode';

/**
 * The generic form action skeleton (ADR 0007; registration-launch Branch 6.2).
 * Collapses the `parse → decode → notify → toast.redirect` pipeline triplicated
 * verbatim across `contact.tsx`, `volunteer.tsx`, and the registration route into
 * ONE parameterized effect, driven by the form's `FormDefinition` (read through
 * Branch 5's `Content.getForm`). Branches 6.3–6.5 migrate the three actions onto
 * it behind the equivalence harness; this sub-commit lands the skeleton + tests.
 *
 * The triplicated body each route writes today (`contact.tsx:139-179`):
 *   1. read the parsed `SubmissionContext`;
 *   2. `parseSchema(handTunedSchema, payload)` → on failure
 *      `formValidationError(formatSchemaResult(...))`;
 *   3. build + `mailer.send` a notification, mapping a send failure to a
 *      form-level error key;
 *   4. `toast.redirect` to the same path with a success toast.
 *
 * The skeleton reproduces steps 1, 2, and 4 exactly; step 3 (the notification) is
 * the only form-specific part, so it is the caller's `notify` callback. The
 * notification stays a CALLBACK rather than baked in because the decoded payload's
 * shape differs per form (contact's `name`/`method`, volunteer's positions list,
 * registration's registrant array) and Branch 7 splits notification from a
 * durable `Submissions.persist` write — keeping `notify` separable here is what
 * lets Branch 7 add `persist` before it without rewriting this skeleton
 * (`subtract-before-you-add`, the persist/notify split the Submission plan
 * demands).
 *
 * `derive-dont-sync`: the validation comes from the stored `FormDefinition` via
 * `decodeForm`, never a re-declared schema — editing `forms/<form>.json` changes
 * what the action accepts with no code change (ADR 0007 consequence).
 */

/** The success toast copy a form shows after a valid submission. */
export interface SuccessToast {
  readonly title: TranslationKey;
  readonly description: TranslationKey;
}

/**
 * Configure the generic form action for one form. `form` is the `FormId` whose
 * `FormDefinition` drives decode (and names the toast's `form` slot); `notify`
 * runs the form-specific notification over the decoded payload and fails (with any
 * `AppError`, e.g. a mailer failure mapped to a form-level key) to abort the
 * redirect; `success` is the post-submit toast copy.
 *
 * `notify`'s context is the form-notification slice of the request runtime
 * (`makeRequestRuntime`): `Mailer` (every form notifies by mail today), plus
 * `ReactRouterContext` / `Content` for a notifier that needs the request or
 * page/form copy. Branch 7 widens the terminal step to `persist`-then-`notify`
 * over a durable `Submissions` write; keeping `notify` a caller callback (not a
 * baked-in mailer) is what lets that land without rewriting this skeleton.
 */
export interface FormActionConfig<E> {
  readonly form: FormId;
  readonly notify: (
    decoded: DecodedForm,
  ) => Effect.Effect<
    void,
    E,
    ReactRouterContext | Content.Service | Mailer.Service
  >;
  readonly success: SuccessToast;
}

/**
 * Build the route `action` for one form. Wraps the generic body in
 * `routeFormAction` (the same wrapper the hand-tuned forms use), so a migrated
 * route is `export const action = formAction({ form, notify, success })` — no
 * inline pipeline. The body yields a {@link FormSuccess} only to satisfy the
 * wrapper's body type; on the happy path the terminal `toast.redirect` fails with
 * a `RedirectError` the wrapper forwards to the runtime, so the return is
 * unreachable on success.
 *
 * Pipeline:
 *   1. `Content.getForm(form)` → the form's `FormDefinition`;
 *   2. `decodeForm(definition, submission.payload)` → on failure,
 *      `formValidationError(formatSchemaResult(...))` (bucketed field/form errors);
 *   3. `notify(decoded)` — the caller's form-specific notification;
 *   4. `toast.redirect(pathname, { success copy, form })`.
 */
export const formAction = <E>(config: FormActionConfig<E>) =>
  routeFormAction(function* () {
    const { url } = yield* ReactRouterContext;
    const submission = yield* SubmissionContext;
    const content = yield* Content.Service;
    const toast = yield* Toast;

    const definition = yield* content.getForm(config.form);

    const decoded = decodeForm(definition, submission.payload);
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }

    yield* config.notify(decoded.success);

    yield* toast.redirect(url.pathname, {
      title: config.success.title,
      description: config.success.description,
      type: 'success',
      form: config.form,
    });
    return { reset: true } satisfies FormSuccess;
  });
