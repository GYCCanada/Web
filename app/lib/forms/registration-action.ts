import { createHash } from 'node:crypto';

import { Clock, Effect, Option, Result } from 'effect';

import { Content } from '../content.server';
import { Env } from '../env.server';
import { formValidationError } from '../effect/errors';
import {
  type FormSuccess,
  routeFormAction,
  SubmissionContext,
} from '../effect/form';
import { formatSchemaResult, parseSchema } from '../effect/form-schema';
import { ReactRouterContext } from '../effect/router-context';
import { Mailer } from '../mailer.server';
import { Payment } from '../payment.server';
import { Toast } from '../toast.server';

import type { SuccessToast } from './action';
import type { RegistrationOrder } from './order';
import { priceGroup } from './price';
import { registrationShellSchema } from './registration-shell';
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

    const env = yield* Env.Service;
    const payment = yield* Payment.Service;

    const definition = yield* content.getForm('registration');

    // The registrant-array shell is registration's own concern (registration-spec
    // §"Scope boundary"): the engine owns ONE registrant's graph, the route owns
    // the `{ registrants: [...] }` envelope — and, once a form authors a `party`
    // section, the party block alongside it. `registrationShellSchema` (registrar
    // plan Decision 2b.4 / Decision 7 step 0) decodes that envelope: it validates
    // the chosen `party._tag` against the authored `billingMode.options`
    // allow-list, decodes the `group`-arm nominated payer (name + required email),
    // and drops blank non-leader registrant emails so an un-filled email decodes
    // valid (2b.3). A definition with no `party` (legacy / contact / volunteer)
    // decodes the today `{ registrants }` shell, group-implicit. Error paths stay
    // at `registrants[n].<field>` / `party.payer.<field>` — the conform field
    // names the live form renders.
    const decoded = parseSchema(
      registrationShellSchema(definition),
      submission.payload,
    );
    if (Result.isFailure(decoded)) {
      return yield* formValidationError(formatSchemaResult(decoded) ?? {});
    }
    const shell = decoded.success;

    // Persist each registrant FIRST — one durable `submissions/registration/<id>.json`
    // object apiece, written + returned before any notification runs, so a `notify`
    // failure provably cannot lose a record (settled #8). A `StorageError` aborts the
    // submission (losing a registrant must never look like success).
    //
    // Idempotency (the deep review's escalated partial-write): the loop is sequential
    // and a `StorageError` on registrant K aborts after 0..K-1 are already durable. A
    // user retry would otherwise re-mint fresh ids and DUPLICATE the records that did
    // land. Scoping each registrant's id to `<request fingerprint>:<index>` makes the
    // retry overwrite the same K objects instead: the fingerprint is a stable hash of
    // THIS submission's payload (identical on a verbatim retry, different for a new
    // submission even with identical data), and the index pins each registrant to its
    // position. So retrying a group of 4 that failed at #3 re-writes #1/#2 in place and
    // completes #3/#4 — no duplicates — while a genuinely new submission gets new ids.
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(submission.payload))
      .digest('hex');
    const stored: Array<Submission> = [];
    for (const [index, registrant] of shell.registrants.entries()) {
      stored.push(
        yield* submissions.persist(
          'registration',
          registrant,
          `${requestFingerprint}:${index}`,
        ),
      );
    }

    // Group checkout (registrar plan Decision 2 / 2b / Decision 7), gated by the
    // `Env.stripe` `None`-gate (Decision 8). When stripe is unconfigured the
    // on-site payment path is INERT — registration persists + notifies + redirects
    // exactly as the RegFox-era no-op did, so nothing changes until the gate flips.
    // When configured AND the form authored a `party` section, the `group` arm
    // freezes ONE order for the party sum and mints ONE PaymentIntent for it.
    // (The `perRegistrant` cardinality is C7.5; this commit handles the `group`
    // arm + the no-party legacy arm only.)
    if (Option.isSome(env.stripe) && 'party' in shell) {
      const party = shell.party;
      if (party._tag === 'group') {
        const now = yield* Clock.currentTimeMillis;
        // The party sum, frozen under ONE `now` (Decision 6) — the amount the
        // order records and the intent charges. `priceGroup` sums each
        // registrant's price; an unpriced form sums to 0 (the gate is the only
        // thing that makes the on-site path live, not pricing).
        const amount = priceGroup(definition, shell.registrants, now);
        const currency = env.stripe.value.currency;
        // The receipt routes to the NOMINATED payer (possibly a non-attendee),
        // frozen here so a later edit cannot retro-redirect the receipt (2b.6).
        const receiptEmail = party.payer.email;
        // One PaymentIntent per party, keyed off the request fingerprint + mode
        // (Decision 2): a verbatim retry re-derives the same key ⇒ Stripe replays
        // the first intent (no double-charge); a changed payload ⇒ a new checkout.
        const idempotencyKey = `registration:checkout:${requestFingerprint}:group`;
        const intent = yield* payment.createIntent(
          amount,
          currency,
          receiptEmail,
          { orderId: requestFingerprint, mode: 'group' },
          idempotencyKey,
        );
        // Freeze the order record (Decision 7 step 3) — ONE order keyed by the
        // fingerprint, `registrantIds` = the whole party, amount + receiptEmail
        // frozen. The webhook (C8) reads it back to mark it `paid`.
        const order: RegistrationOrder = {
          orderId: requestFingerprint,
          mode: 'group',
          intentId: intent.intentId,
          amount,
          currency,
          receiptEmail,
          status: 'pending',
          registrantIds: stored.map((registrant) => registrant.id),
        };
        yield* submissions.persistOrder('registration', order);
      }
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
