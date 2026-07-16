import { Schema } from 'effect';

import type { SubmissionGroupId } from './forms.server';

export const DeliveryKey = Schema.NonEmptyString.check(
  Schema.isMaxLength(300),
).pipe(Schema.brand('NotificationDeliveryKey'));
export type DeliveryKey = typeof DeliveryKey.Type;

/** The one durable admin-email intent owned by a committed Submission batch. */
export const adminEmailDeliveryKey = (
  batchId: SubmissionGroupId,
): DeliveryKey => DeliveryKey.make(`form:${batchId}:admin-email`);
