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

import { definitionToSchema } from './decode';
import type { SuccessToast } from './action';
import type { Submission } from './submission';
import { Submissions } from './submissions.server';

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
    submissions: ReadonlyArray<Submission>,
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
    const content = yield* Content.Service;
    const submissions = yield* Submissions.Service;
    const toast = yield* Toast;

    const definition = yield* content.getForm('registration');

    // The registrant-array shell is registration's own concern (registration-spec
    // §"Scope boundary"): the engine owns ONE registrant's graph, the route owns
    // the `{ registrants: [...] }` envelope. Decoding the shell with the
    // per-registrant codec keeps error paths at `registrants[n].<field>` — the
    // conform field names the live form renders.
    const registrantsSchema = Schema.Struct({
      registrants: Schema.Array(definitionToSchema(definition)),
    });

    const decoded = parseSchema(registrantsSchema, submission.payload);
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }

    // Persist each registrant FIRST — one durable `submissions/registration/<id>.json`
    // object apiece, written + returned before any notification runs, so a `notify`
    // failure provably cannot lose a record (settled #8). A `StorageError` aborts the
    // submission (losing a registrant must never look like success).
    const stored: Array<Submission> = [];
    for (const registrant of decoded.success.registrants) {
      stored.push(yield* submissions.persist('registration', registrant));
    }

    yield* config.notify(stored);

    yield* toast.redirect(url.pathname, {
      title: config.success.title,
      description: config.success.description,
      type: 'success',
      form: 'registration',
    });
    return { reset: true } satisfies FormSuccess;
  });
