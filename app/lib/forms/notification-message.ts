import type { Submission, SubmissionBatch } from './forms.server';

export interface NotificationMessage {
  readonly subject: string;
  readonly content: string;
}

const str = (submission: Submission, name: string): string => {
  const value = submission.payload[name];
  return typeof value === 'string' ? value : '';
};

const contactLine = (submission: Submission): string => {
  const method = str(submission, 'method');
  const email = `Email: ${str(submission, 'email')}`;
  const phone = `Phone: ${str(submission, 'phone')}`;
  if (method === 'phone') return phone;
  if (method === 'both') return `${email}\n${phone}`;
  return email;
};

const contactMessage = (submission: Submission): NotificationMessage => {
  const name = str(submission, 'name');
  return {
    subject: `[!] Contact Inquiry from ${name}`,
    content: `Name: ${name}\n${contactLine(submission)}\nMessage: ${str(submission, 'message')}`,
  };
};

const volunteerMessage = (submission: Submission): NotificationMessage => {
  const name = str(submission, 'name');
  const rawPositions = submission.payload['positions'];
  const positions = Array.isArray(rawPositions) ? rawPositions.join(', ') : '';
  return {
    subject: `[!] Volunteer Request from ${name}`,
    content: `Name: ${name}\n${contactLine(submission)}
        \nMessage: ${str(submission, 'why')}
        \nBackground: ${str(submission, 'background')}
        \nAge: ${str(submission, 'age')}
        \nLocation: ${str(submission, 'location')}
        \nPositions: ${positions}
        `,
  };
};

const registrationMessage = (
  submissions: SubmissionBatch<'registration'>['submissions'],
): NotificationMessage => {
  const count = submissions.length;
  const lines = submissions.map((submission) => {
    const name = str(submission, 'name');
    const email = str(submission, 'email');
    const type = str(submission, 'type');
    return `- ${name} (${type}) <${email}> — record ${submission.id}`;
  });
  return {
    subject: `[!] Registration: ${count} registrant${count === 1 ? '' : 's'}`,
    content: `${count} registrant${
      count === 1 ? '' : 's'
    } submitted. The durable records are committed; this is a notification of them.\n\n${lines.join('\n')}`,
  };
};

/** Derive admin-email copy exclusively from the committed Submission aggregate. */
export const notificationMessage = (
  batch: SubmissionBatch,
): NotificationMessage => {
  switch (batch.form) {
    case 'contact':
      return contactMessage(batch.submissions[0]);
    case 'volunteer':
      return volunteerMessage(batch.submissions[0]);
    case 'registration':
      return registrationMessage(
        batch.submissions as SubmissionBatch<'registration'>['submissions'],
      );
  }
};
