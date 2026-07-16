export * as FormNotifications from './form-notifications.server';

import { Context, Effect, Layer, Schema } from 'effect';

import { Forms, type SubmissionBatch } from './forms/forms.server';
import { adminEmailDeliveryKey } from './forms/notification-intent';
import { notificationMessage } from './forms/notification-message';
import { Mailer, type MailError } from './mailer.server';
import {
  NotificationDelivery,
  type DeliveryResult,
  type PersistenceError,
} from './notification-delivery.server';

export class DispatchError extends Schema.TaggedErrorClass<DispatchError>()(
  'FormNotifications.DispatchError',
  { operation: Schema.String },
) {}

export class Service extends Context.Service<
  Service,
  {
    readonly dispatch: (
      batch: SubmissionBatch,
    ) => Effect.Effect<DeliveryResult<void>, MailError | PersistenceError>;
    readonly drain: Effect.Effect<
      number,
      PersistenceError | DispatchError
    >;
  }
>()('gycc/lib/form-notifications.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const forms = yield* Forms.Service;
    const deliveries = yield* NotificationDelivery.Service;
    const mailer = yield* Mailer.Service;

    const dispatch = Effect.fn('FormNotifications.dispatch')(function* (
      batch: SubmissionBatch,
    ) {
      const key = adminEmailDeliveryKey(batch.id);
      const message = notificationMessage(batch);
      return yield* deliveries.deliver(
        key,
        mailer.send({ ...message, idempotencyKey: key }),
      );
    });

    const drain = Effect.gen(function* () {
      const pending = yield* deliveries.pending();
      const results = yield* Effect.forEach(
        pending,
        (id) =>
          forms.getBatch(id).pipe(
            Effect.flatMap(dispatch),
            Effect.as(true),
            Effect.catch((error) =>
              Effect.logError('Form notification dispatch failed', error).pipe(
                Effect.as(false),
              ),
            ),
          ),
        { concurrency: 4 },
      );
      return results.filter(Boolean).length;
    }).pipe(
      Effect.mapError(
        () => new DispatchError({ operation: 'drain Form notification outbox' }),
      ),
    );

    return Service.of({ dispatch, drain });
  }),
);
