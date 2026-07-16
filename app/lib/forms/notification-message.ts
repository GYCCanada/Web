import type {
  FormDefinition,
  FormId,
  NotificationProjection,
} from './definition';
import type { Submission, SubmissionBatch } from './forms.server';

export interface NotificationMessage {
  readonly subject: string;
  readonly content: string;
}

const defaultProjection = (form: FormId): NotificationProjection => {
  switch (form) {
    case 'contact':
      return {
        _tag: 'contact',
        name: 'name',
        method: 'method',
        email: 'email',
        phone: 'phone',
        message: 'message',
      } as NotificationProjection;
    case 'volunteer':
      return {
        _tag: 'volunteer',
        name: 'name',
        method: 'method',
        email: 'email',
        phone: 'phone',
        why: 'why',
        background: 'background',
        age: 'age',
        location: 'location',
      } as NotificationProjection;
    case 'registration':
      return {
        _tag: 'registration',
        name: 'name',
        email: 'email',
        type: 'type',
      } as NotificationProjection;
  }
};

/** Normalize historical definitions and reject dangling semantic field roles. */
export const normalizeNotificationProjection = (
  form: FormId,
  definition: FormDefinition,
): {
  readonly definition: FormDefinition;
  readonly issues: readonly string[];
} => {
  const notification = definition.notification ?? defaultProjection(form);
  const available = new Set(
    definition.fields.map((field) => String(field.name)),
  );
  if (definition.variant !== undefined) {
    available.add(String(definition.variant.discriminator));
  }
  const issues: string[] = [];
  if (notification._tag !== form) {
    issues.push(`notification._tag must be "${form}" for the ${form} form`);
  }
  for (const [role, field] of Object.entries(notification)) {
    if (role !== '_tag' && !available.has(String(field))) {
      issues.push(
        `notification.${role} references missing top-level field "${String(field)}"`,
      );
    }
  }
  return {
    definition: { ...definition, notification },
    issues,
  };
};

const str = (submission: Submission, name: string): string => {
  const value = submission.payload[name];
  return typeof value === 'string' ? value : '';
};

const contactLine = (
  submission: Submission,
  projection: Extract<
    NotificationProjection,
    { readonly _tag: 'contact' | 'volunteer' }
  >,
): string => {
  const method = str(submission, projection.method);
  const email = `Email: ${str(submission, projection.email)}`;
  const phone = `Phone: ${str(submission, projection.phone)}`;
  if (method === 'phone') return phone;
  if (method === 'both') return `${email}\n${phone}`;
  return email;
};

const contactMessage = (
  submission: Submission,
  projection: Extract<NotificationProjection, { readonly _tag: 'contact' }>,
): NotificationMessage => {
  const name = str(submission, projection.name);
  return {
    subject: `[!] Contact Inquiry from ${name}`,
    content: `Name: ${name}\n${contactLine(submission, projection)}\nMessage: ${str(submission, projection.message)}`,
  };
};

const volunteerMessage = (
  submission: Submission,
  projection: Extract<NotificationProjection, { readonly _tag: 'volunteer' }>,
): NotificationMessage => {
  const name = str(submission, projection.name);
  return {
    subject: `[!] Volunteer Request from ${name}`,
    content: `Name: ${name}\n${contactLine(submission, projection)}
        \nMessage: ${str(submission, projection.why)}
        \nBackground: ${str(submission, projection.background)}
        \nAge: ${str(submission, projection.age)}
        \nLocation: ${str(submission, projection.location)}
        `,
  };
};

const registrationMessage = (
  submissions: SubmissionBatch<'registration'>['submissions'],
  projection: Extract<
    NotificationProjection,
    { readonly _tag: 'registration' }
  >,
): NotificationMessage => {
  const count = submissions.length;
  const lines = submissions.map((submission) => {
    const name = str(submission, projection.name);
    const email = str(submission, projection.email);
    const type = str(submission, projection.type);
    return `- ${name} (${type}) <${email}> — record ${submission.id}`;
  });
  return {
    subject: `[!] Registration: ${count} registrant${count === 1 ? '' : 's'}`,
    content: `${count} registrant${
      count === 1 ? '' : 's'
    } submitted. The durable records are committed; this is a notification of them.\n\n${lines.join('\n')}`,
  };
};

/** Render from the committed aggregate and its immutable, validated definition. */
export const notificationMessage = (
  definition: FormDefinition,
  batch: SubmissionBatch,
): NotificationMessage => {
  const projection = definition.notification ?? defaultProjection(batch.form);
  switch (projection._tag) {
    case 'contact':
      return contactMessage(batch.submissions[0], projection);
    case 'volunteer':
      return volunteerMessage(batch.submissions[0], projection);
    case 'registration':
      return registrationMessage(
        batch.submissions as SubmissionBatch<'registration'>['submissions'],
        projection,
      );
  }
};
