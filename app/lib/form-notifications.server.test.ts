import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { makeTestAppLayer } from './effect/runtime.test-helper';
import { defaultContactForm } from './forms/defaults';
import { Forms } from './forms/forms.server';
import { Mailer } from './mailer.server';
import { layerTest } from './storage.test-helper';

import { FormNotifications } from './form-notifications.server';

const validContact = {
  name: 'Ada Lovelace',
  method: 'email',
  email: 'ada@example.com',
  message: 'A durable notification.',
};

describe('Form notification outbox', () => {
  it.effect('persists intent before delivery and drains it exactly once', () => {
    const sent: Array<{
      readonly subject: string;
      readonly content: string;
      readonly idempotencyKey?: string;
    }> = [];
    const mailer = Layer.succeed(
      Mailer.Service,
      Mailer.Service.of({
        send: (input) => Effect.sync(() => void sent.push(input)),
      }),
    );
    return Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const notifications = yield* FormNotifications.Service;
      const current = yield* forms.current('contact');
      expect(current.definition).toEqual(defaultContactForm);

      const stored = yield* forms.submit({
        form: 'contact',
        expectedVersion: current.version,
        idempotencyToken: Forms.IdempotencyToken.make('outbox-test'),
        payloads: [validContact],
      });
      expect(sent).toHaveLength(0);

      // Delayed dispatch consumes the payload captured with the commit, not a
      // later reconstruction from mutable code or definition state.
      const sql = yield* SqlClient;
      const payload = yield* sql<{ subject: string; content: string }>`
        SELECT subject, content
        FROM notification_deliveries
        WHERE batch_id = ${stored.id}
      `;
      expect(payload[0]?.subject).toBe(
        '[!] Contact Inquiry from Ada Lovelace',
      );

      expect(yield* notifications.drain).toBe(1);
      expect(yield* notifications.drain).toBe(0);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toBe('[!] Contact Inquiry from Ada Lovelace');
      expect(sent[0]?.idempotencyKey).toBe(
        `form:${stored.id}:admin-email`,
      );
    }).pipe(Effect.provide(makeTestAppLayer(layerTest({}), mailer)));
  });

  it.effect('retries a failed delivery from durable state without a browser replay', () => {
    let attempts = 0;
    const mailer = Layer.succeed(
      Mailer.Service,
      Mailer.Service.of({
        send: () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1
              ? Effect.fail(new Mailer.MailError({}))
              : Effect.void;
          }),
      }),
    );
    return Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const notifications = yield* FormNotifications.Service;
      const current = yield* forms.current('contact');
      yield* forms.submit({
        form: 'contact',
        expectedVersion: current.version,
        idempotencyToken: Forms.IdempotencyToken.make('outbox-retry-test'),
        payloads: [validContact],
      });

      expect(yield* notifications.drain).toBe(0);
      expect(yield* notifications.drain).toBe(1);
      expect(attempts).toBe(2);
    }).pipe(Effect.provide(makeTestAppLayer(layerTest({}), mailer)));
  });
});
