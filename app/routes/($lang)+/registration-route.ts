import { registrationAction } from '~/lib/forms/registration-action';

/**
 * The shared registration route action (registration-launch Branch 7.3). The
 * three `{2024,2025,2026}/form` route modules re-export this single configured
 * action, so all three year shells share one persist-then-notify pipeline rather
 * than three forks.
 *
 * The pipeline (`registrationAction`) validates and commits the complete
 * registration group atomically in PostgreSQL, then runs `notify` over those
 * stored records. The notification references persisted ids (CONTEXT
 * §Submission: the email is a notification of the record, not the record), so a
 * mailer failure cannot lose or partially commit a registration.
 */

export const action = registrationAction({
  success: {
    title: 'registration.form.success.title',
    description: 'registration.form.success.description',
  },
});
