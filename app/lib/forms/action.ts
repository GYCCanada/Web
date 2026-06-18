import { Effect, Result } from 'effect';

import { Content } from '../content.server';
import type { FormId, PageId } from '../content/pages/registry';
import { formValidationError, notFound } from '../effect/errors';
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

import { decodeForm } from './decode';
import type { Submission } from './submission';
import { Submissions } from './submissions.server';

/**
 * The generic form action skeleton (ADR 0007; registration-launch Branch 6.2,
 * persist-then-notify wired in Branch 7.3). Collapses the `parse → decode →
 * persist → notify → toast.redirect` pipeline triplicated verbatim across
 * `contact.tsx`, `volunteer.tsx`, and (for the single-registrant shape) the
 * registration route into ONE parameterized effect, driven by the form's
 * `FormDefinition` (read through Branch 5's `Content.getForm`).
 *
 * The triplicated body each route wrote (`contact.tsx:139-179`):
 *   1. read the parsed `SubmissionContext`;
 *   2. `parseSchema(handTunedSchema, payload)` → on failure
 *      `formValidationError(formatSchemaResult(...))`;
 *   3. build + `mailer.send` a notification, mapping a send failure to a
 *      form-level error key;
 *   4. `toast.redirect` to the same path with a success toast.
 *
 * The skeleton reproduces steps 1, 2, and 4 exactly; step 3 (the notification) is
 * the only form-specific part, so it is the caller's `notify` callback. Branch 7.3
 * inserts a `Submissions.persist` step BETWEEN decode and notify: a valid
 * submission is written to its durable `submissions/<form>/<id>.json` object FIRST,
 * and only then is `notify` run over the *stored* `Submission` (CONTEXT §Submission:
 * the email is a notification OF the persisted record, referencing its id). Because
 * `persist` returns the durable record before `notify` runs, a notify failure
 * provably cannot lose the record — the bucket object is already written. The
 * notification stays a CALLBACK rather than baked in because the decoded payload's
 * shape differs per form (contact's `name`/`method`, volunteer's positions list);
 * keeping `persist` (one durable write) separate from `notify` (the form-specific
 * mailer) is exactly the split the Submission plan demands (settled #8).
 *
 * `derive-dont-sync`: the validation comes from the stored `FormDefinition` via
 * `decodeForm`, and the persisted record's payload codec is derived from the SAME
 * definition (`Submissions.persist` → `submissionSchema`), never a re-declared
 * schema — editing `forms/<form>.json` changes both what the action accepts and
 * what it stores with no code change (ADR 0007 + ADR 0008 consequence).
 *
 * Registration's multi-registrant `{ registrants: [...] }` shell is NOT a closed
 * `FieldKind`, so it does not flow through this flat skeleton; it has its own
 * persist-then-notify action (`registration-action.ts`) that reuses the same
 * `Submissions.persist` + `routeFormAction` machinery over the registrant array.
 */

/** The success toast copy a form shows after a valid submission. */
export interface SuccessToast {
  readonly title: TranslationKey;
  readonly description: TranslationKey;
}

/**
 * Configure the generic form action for one form. `form` is the `FormId` whose
 * `FormDefinition` drives decode (and names the toast's `form` slot); `notify`
 * runs the form-specific notification over the PERSISTED `Submission` (the durable
 * record, already on the bucket — so the email can reference its id) and fails
 * (with any `AppError`, e.g. a mailer failure mapped to a form-level key) to abort
 * the redirect; `success` is the post-submit toast copy.
 *
 * `notify` receives the stored `Submission`, not the bare decoded payload: by the
 * time it runs, `Submissions.persist` has already written
 * `submissions/<form>/<id>.json`, so the record survives a notify failure
 * (settled #8). `notify`'s context is the form-notification slice of the request
 * runtime (`makeRequestRuntime`): `Mailer` (every form notifies by mail today),
 * plus `ReactRouterContext` / `Content` for a notifier that needs the request or
 * page/form copy.
 */
export interface FormActionConfig<E> {
  readonly form: FormId;
  /**
   * The evergreen `PageId` that OWNS this form's route (contact ↔ contact page,
   * volunteer ↔ volunteer page). The action 404s when that page is DISABLED
   * (Feature C, Codex #6): a disabled page must reject POSTs too, not only its GET
   * — otherwise a disabled contact page would still accept submissions. Gated off
   * the SAME per-page `enabled` flag the loader/nav read (`derive-dont-sync`).
   */
  readonly page: PageId;
  readonly notify: (
    submission: Submission,
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
 *   3. `Submissions.persist(form, decoded)` → the durable record is written to
 *      `submissions/<form>/<id>.json` and returned BEFORE any notification;
 *   4. `notify(submission)` — the caller's form-specific notification OF the
 *      stored record (a failure here cannot lose the record — it is already on
 *      the bucket);
 *   5. `toast.redirect(pathname, { success copy, form })`.
 */
export const formAction = <E>(config: FormActionConfig<E>) =>
  routeFormAction(function* () {
    const { url } = yield* ReactRouterContext;
    const submission = yield* SubmissionContext;
    const content = yield* Content.Service;
    const submissions = yield* Submissions.Service;
    const toast = yield* Toast;

    // 404 the action when the owning page is disabled (Feature C, Codex #6): a
    // disabled page rejects POSTs too, not only its GET. Read off the same
    // per-page `enabled` flag the loader/nav use.
    if (!(yield* content.getPage(config.page)).enabled) {
      return yield* notFound();
    }

    const definition = yield* content.getForm(config.form);

    const decoded = decodeForm(definition, submission.payload);
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }

    // Persist FIRST: the durable `submissions/<form>/<id>.json` object is written
    // and returned before any notification runs, so a `notify` failure provably
    // cannot lose the record (settled #8). A `StorageError` here aborts the
    // submission (losing a record must never look like success).
    const stored = yield* submissions.persist(config.form, decoded.success);

    yield* config.notify(stored);

    yield* toast.redirect(url.pathname, {
      title: config.success.title,
      description: config.success.description,
      type: 'success',
      form: config.form,
    });
    return { reset: true } satisfies FormSuccess;
  });
