export * as FormNotifications from './form-notifications.server';

import { Context, Effect, Layer, Schema } from 'effect';

import type { SubmissionBatch } from './forms/forms.server';
import { adminEmailDeliveryKey } from './forms/notification-intent';
import { Mailer, type MailError } from './mailer.server';
import {
  NotificationDelivery,
  type DeliveryTimeout,
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
    ) => Effect.Effect<
      DeliveryResult<void>,
      MailError | PersistenceError | DeliveryTimeout
    >;
    readonly drain: Effect.Effect<number, PersistenceError | DispatchError>;
  }
>()('gycc/lib/form-notifications.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const deliveries = yield* NotificationDelivery.Service;
    const mailer = yield* Mailer.Service;

    const dispatch = Effect.fn('FormNotifications.dispatch')(function* (
      batch: SubmissionBatch,
    ) {
      const key = adminEmailDeliveryKey(batch.id);
      const intent = yield* deliveries.intent(key);
      return yield* deliveries.deliver(
        intent,
        mailer.send({
          subject: intent.subject,
          content: intent.content,
          idempotencyKey: key,
        }),
      );
    });

    const drain = Effect.gen(function* () {
      const pending = yield* deliveries.pending();
      const results = yield* Effect.forEach(
        pending,
        (intent) =>
          deliveries
            .deliver(
              intent,
              mailer.send({
                subject: intent.subject,
                content: intent.content,
                idempotencyKey: intent.key,
              }),
            )
            .pipe(
              Effect.as(true),
              Effect.catch((error) =>
                Effect.logError(
                  'Form notification dispatch failed',
                  error,
                ).pipe(Effect.as(false)),
              ),
            ),
        { concurrency: 4 },
      );
      return results.filter(Boolean).length;
    }).pipe(
      Effect.mapError(
        () =>
          new DispatchError({ operation: 'drain Form notification outbox' }),
      ),
    );

    return Service.of({ dispatch, drain });
  }),
);
