import { Effect, Schema } from 'effect';

import { Content } from '../content.server';
import type { PageId } from '../content/pages/registry';
import { formValidationError, notFound } from '../effect/errors';
import {
  type FormSuccess,
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatValidationIssues } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import { FormNotifications } from '../form-notifications.server';
import type { TranslationKey } from '../localization/translations';
import { Toast } from '../toast.server';

import { Forms } from './forms.server';
import type { FormId } from './definition';
import {
  FORM_VERSION_FIELD,
  IDEMPOTENCY_TOKEN_FIELD,
} from './submission-command';

/** Web adapter for a single-payload Forms submission and post-commit notification. */

/** The success toast copy a form shows after a valid submission. */
export interface SuccessToast {
  readonly title: TranslationKey;
  readonly description: TranslationKey;
}

/**
 * `notify` receives the committed relational Submission through the durable
 * delivery ledger. A failed delivery may retry; a delivered batch never sends
 * again when its submission command is replayed.
 */
export interface FormActionConfig {
  readonly form: FormId;
  /**
   * The evergreen `PageId` that OWNS this form's route (contact ↔ contact page,
   * volunteer ↔ volunteer page). The action 404s when that page is DISABLED
   * (Feature C, Codex #6): a disabled page must reject POSTs too, not only its GET
   * — otherwise a disabled contact page would still accept submissions. Gated off
   * the SAME per-page `enabled` flag the loader/nav read (`derive-dont-sync`).
   */
  readonly page: PageId;
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
 * The hidden version binds validation to the rendered definition; the hidden
 * token provides explicit retry identity. Forms performs validation and commit
 * atomically, then this adapter notifies and redirects.
 */
export const formAction = (config: FormActionConfig) =>
  routeFormAction(
    function* () {
      const { url } = yield* ReactRouterContext;
      const submission = yield* SubmissionContext;
      const forms = yield* Forms.Service;
      const toast = yield* Toast;
      const notifications = yield* FormNotifications.Service;

      const {
        [FORM_VERSION_FIELD]: rawVersion,
        [IDEMPOTENCY_TOKEN_FIELD]: rawToken,
        ...payload
      } = submission.payload;
      const expectedVersion = yield* Schema.decodeUnknownEffect(
        Forms.FormDefinitionVersionId,
      )(rawVersion).pipe(
        Effect.mapError(() =>
          formValidationError({ formErrors: [`${config.form}.form.error`] }),
        ),
      );
      const idempotencyToken = yield* Schema.decodeUnknownEffect(
        Forms.IdempotencyToken,
      )(rawToken).pipe(
        Effect.mapError(() =>
          formValidationError({ formErrors: [`${config.form}.form.error`] }),
        ),
      );

      const stored = yield* forms
        .submit({
          form: config.form,
          expectedVersion,
          idempotencyToken,
          payloads: [payload],
        })
        .pipe(
          Effect.catchTag('Forms.SubmissionRejected', (error) => {
            const issue = error.issues[0];
            return formValidationError(
              formatValidationIssues(issue?.issues ?? []),
            );
          }),
          Effect.catchTags({
            'Forms.DefinitionAdvanced': () =>
              formValidationError(
                { formErrors: [`${config.form}.form.error`] },
                'refreshDefinition',
              ),
            'Forms.IdempotencyConflict': () =>
              formValidationError(
                { formErrors: [`${config.form}.form.error`] },
                'rotateToken',
              ),
            'Forms.FormNotPublished': () =>
              formValidationError(
                { formErrors: [`${config.form}.form.error`] },
                'refreshDefinition',
              ),
          }),
        );

      const delivery = yield* notifications.dispatch(stored).pipe(
        Effect.catchTags({
          'Mailer.Error': () =>
            formValidationError({ formErrors: [`${config.form}.form.error`] }),
          'NotificationDelivery.PersistenceError': () =>
            formValidationError({ formErrors: [`${config.form}.form.error`] }),
        }),
      );
      if (delivery._tag === 'InProgress') {
        return yield* formValidationError({
          formErrors: [`${config.form}.form.error`],
        });
      }

      yield* toast.redirect(url.pathname, {
        title: config.success.title,
        description: config.success.description,
        type: 'success',
        form: config.form,
      });
      return { reset: true } satisfies FormSuccess;
    },
    {
      preserveFields: [FORM_VERSION_FIELD, IDEMPOTENCY_TOKEN_FIELD],
      // ROUTE-LEVEL 404 gate, run BEFORE form-data parse + honeypot handling so a
      // disabled page rejects EVERY POST (incl. a honeypot-filled one), not only
      // the normal body path (Feature C, Codex #6, Risk 11). Read off the same
      // per-page `enabled` flag the loader/nav use (`derive-dont-sync`).
      guard: Effect.gen(function* () {
        const content = yield* Content.Service;
        if (!(yield* content.getPage(config.page)).enabled) {
          return yield* notFound();
        }
      }),
    },
  );
