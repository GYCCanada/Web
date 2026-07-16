export * as RegistrationAlerts from './registration-alerts.server';

import { Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Env } from '../env.server';
import { Mailer } from '../mailer.server';
import { NotificationDelivery } from '../notification-delivery.server';

const REMINDER_AFTER_MS = 24 * 60 * 60 * 1_000;

export class DispatchError extends Schema.TaggedErrorClass<DispatchError>()(
  'RegistrationAlerts.DispatchError',
  { operation: Schema.String },
) {}

export class Service extends Context.Service<
  Service,
  {
    readonly available: boolean;
    readonly drain: (
      at: number,
    ) => Effect.Effect<
      number,
      NotificationDelivery.PersistenceError | DispatchError
    >;
  }
>()('@gycc/app/registration/RegistrationAlerts') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Env.Service;
    const mailer = yield* Mailer.Service;
    const deliveries = yield* NotificationDelivery.Service;
    const sql = yield* SqlClient;
    const recipient = Option.getOrUndefined(env.registrationAlertEmail);
    const available = Option.isSome(env.mail) && recipient !== undefined;

    const enqueueReviewReminders = Effect.fn(
      'RegistrationAlerts.enqueueReviewReminders',
    )(function* (at: number) {
      const day = new Date(at).toISOString().slice(0, 10);
      const cutoff = new Date(at - REMINDER_AFTER_MS).toISOString();
      yield* sql`
        INSERT INTO notification_deliveries (
          delivery_key,
          registration_order_id,
          registration_review_id,
          subject,
          content,
          status
        )
        SELECT
          ${`review-reminder:${day}:`} || review.review_id,
          review.order_id,
          review.review_id,
          '[Registration] Unresolved Order review — ' || review.order_id,
          review.reason || ': ' || review.detail ||
            E'\n\nThis review remains unresolved in /admin/registration.',
          'failed'
        FROM registration_order_reviews AS review
        WHERE review.status = 'open'
          AND review.created_at <= ${cutoff}
        ON CONFLICT (delivery_key) DO NOTHING
      `.pipe(
        Effect.mapError(
          () =>
            new NotificationDelivery.PersistenceError({
              operation: 'enqueue unresolved Registration review reminders',
            }),
        ),
      );
    });

    const drainUnmapped = Effect.fn('RegistrationAlerts.drain')(function* (
      at: number,
    ) {
      if (!available || recipient === undefined) return 0;
      yield* enqueueReviewReminders(at);
      const pending = yield* deliveries.pending('registration');
      const results = yield* Effect.forEach(
        pending,
        (intent) =>
          deliveries
            .deliver(
              intent,
              mailer.send({
                recipient,
                senderName: 'GYCC Registration',
                subject: intent.subject,
                content: intent.content,
                idempotencyKey: intent.key,
              }),
            )
            .pipe(
              Effect.as(true),
              Effect.catch((error) =>
                Effect.logError(
                  'Registration alert dispatch failed',
                  error,
                ).pipe(Effect.as(false)),
              ),
            ),
        { concurrency: 4 },
      );
      return results.filter(Boolean).length;
    });
    const drain = (at: number) =>
      drainUnmapped(at).pipe(
        Effect.mapError(
          () =>
            new DispatchError({
              operation: 'drain Registration alert outbox',
            }),
        ),
      );

    return Service.of({ available, drain });
  }),
);
