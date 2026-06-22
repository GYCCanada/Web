import { Effect } from 'effect';

import { formValidationError } from '~/lib/effect/errors';
import { registrationAction } from '~/lib/forms/registration-action';
import type { Submission } from '~/lib/forms/submission';
import { translate } from '~/lib/localization/localization';
import { Mailer } from '~/lib/mailer.server';

/**
 * The shared registration route action (registration-launch Branch 7.3). The
 * three `{2024,2025,2026}/form` route modules re-export this single configured
 * action — the registration server path is net-new (the old action was a
 * deliberate no-op; RegFox carries the live channel, settled #9), so all three
 * year shells share one persist-then-notify pipeline rather than three forks.
 *
 * The pipeline (`registrationAction`) persists EACH submitted registrant as its
 * own durable `submissions/registration/<id>.json` object FIRST, then runs this
 * `notify` over the stored records. The notification REFERENCES the persisted ids
 * (CONTEXT §Submission: the email is a notification OF the record, not the record),
 * so a mailer failure cannot lose a registration — the bucket objects are already
 * written.
 */

/** The string value of one decoded registrant field, or `''` when absent. */
const str = (payload: Submission['payload'], name: string): string => {
  const value = payload[name];
  return typeof value === 'string' ? value : '';
};

/** One line per persisted registrant: their name, email, type, and record id. */
const registrantLine = (submission: Submission): string => {
  const name = str(submission.payload, 'name');
  const email = str(submission.payload, 'email');
  const type = str(submission.payload, 'type');
  return `- ${name} (${type}) <${email}> — record ${submission.id}`;
};

export const action = registrationAction({
  notify: (submissions) =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service;
      const count = submissions.length;
      const result = yield* Effect.exit(
        mailer.send({
          subject: `[!] Registration: ${count} registrant${
            count === 1 ? '' : 's'
          }`,
          content: `${count} registrant${
            count === 1 ? '' : 's'
          } submitted. The durable records are on the bucket; this is a notification of them.\n\n${submissions
            .map(registrantLine)
            .join('\n')}`,
        }),
      );
      if (result._tag === 'Failure') {
        yield* Effect.logError('Error sending registration email', result.cause);
        // The records are already persisted; surface a form-level error so the
        // submitter can retry the notification path without losing the records.
        return yield* formValidationError({
          formErrors: ['registration.form.error'],
        });
      }
    }),
  // The perRegistrant Checkout-link mail (round-2 --deep BLOCKER): each registrant
  // is mailed THEIR OWN hosted Checkout url, routed to THEIR email (the `to`
  // override on the shared Mailer boundary) with a localized name + url body. The
  // session+order are already durable + `pending`, so a send failure surfaces a
  // form-level error WITHOUT losing them (persist-then-notify) — the visitor can
  // retry, and each session still reconciles on its own webhook regardless.
  notifyPaymentLink: ({ submission, url, locale }) =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service;
      const name = str(submission.payload, 'name');
      const email = str(submission.payload, 'email');
      const result = yield* Effect.exit(
        mailer.send({
          to: email,
          subject: translate(
            locale,
            'registration.checkout.perRegistrant.email.subject',
          ),
          content: translate(
            locale,
            'registration.checkout.perRegistrant.email.body',
            { name, url },
          ),
        }),
      );
      if (result._tag === 'Failure') {
        yield* Effect.logError(
          'Error sending registration payment-link email',
          result.cause,
        );
        return yield* formValidationError({
          formErrors: ['registration.form.error'],
        });
      }
    }),
  success: {
    title: 'registration.form.success.title',
    description: 'registration.form.success.description',
  },
  perRegistrantSuccess: {
    title: 'registration.checkout.perRegistrant.success.title',
    description: 'registration.checkout.perRegistrant.success.description',
  },
});
