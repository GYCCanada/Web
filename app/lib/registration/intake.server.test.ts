import { describe, expect, it } from 'effect-bun-test';
import { DateTime, Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { ConferenceSlug } from '../content/schema';
import { DatabaseTest } from '../database.test-helper';
import { Forms } from '../forms/forms.server';
import { OrderActor } from './order-actor.server';
import {
  IdempotencyConflict,
  RegistrationIntake,
} from './intake.server';
import {
  ConferenceTimeZone,
  Registrar,
} from './registrar.server';

const conference = ConferenceSlug.make('/2026');
const at = DateTime.makeUnsafe(Date.parse('2026-08-01T12:00:00Z'));
const text = (value: string) => ({ en: value, fr: value });

const shell = (mode: 'group' | 'perRegistrant' = 'group') => ({
  party:
    mode === 'group'
      ? {
          _tag: 'group',
          payer: { name: 'Treasurer', email: 'payer@example.com' },
        }
      : { _tag: 'perRegistrant' },
  registrants: [
    {
      name: 'Ada Exhibits',
      email: 'ada@example.com',
      phone: '555-0100',
      type: 'exhibitor',
      synopsis: 'Books',
      website: 'https://example.com',
      company: 'Ada Books',
    },
    ...(mode === 'perRegistrant'
      ? [
          {
            name: 'Grace Exhibits',
            email: 'grace@example.com',
            phone: '555-0101',
            type: 'exhibitor',
            synopsis: 'More books',
            website: 'https://example.org',
            company: 'Grace Books',
          },
        ]
      : []),
  ],
});

const testLayer = (
  createCheckout: OrderActor.Sender['Service']['createCheckout'],
) => {
  const foundation = Layer.mergeAll(
    Forms.layer,
    Layer.succeed(
      OrderActor.Sender,
      OrderActor.Sender.of({
        createCheckout,
        applyStripeEvent: () => Effect.die('unused'),
        expire: () => Effect.die('unused'),
        refund: () => Effect.die('unused'),
      }),
    ),
  ).pipe(Layer.provideMerge(DatabaseTest.layer));
  return Layer.mergeAll(Registrar.layer, RegistrationIntake.layer).pipe(
    Layer.provideMerge(foundation),
  );
};

const openRegistration = Effect.gen(function* () {
  const forms = yield* Forms.Service;
  const registrar = yield* Registrar.Service;
  const sql = yield* SqlClient;
  const current = yield* forms.current('registration');
  const published = yield* forms.publish({
    form: 'registration',
    expectedCurrentVersion: Option.some(current.version),
    definition: {
      ...current.definition,
      party: {
        billingMode: {
          label: text('Payment'),
          requiredMessage: 'registration.form.type.required',
          options: {
            group: text('One payment'),
            perRegistrant: text('Each pays'),
          },
        },
        payer: {
          label: text('Payer'),
          nameField: {
            label: text('Payer name'),
            requiredMessage: 'registration.form.name.required',
          },
          emailField: {
            label: text('Payer email'),
            requiredMessage: 'registration.form.email.required',
            invalidMessage: 'registration.form.email.error',
          },
        },
      },
      pricing: {
        currency: 'cad',
        base: 5_000,
        registrationClosesAt: '2026-09-01T04:00:00Z',
        rules: [],
        windows: [],
      },
    },
  });
  yield* sql`DELETE FROM registration_channels WHERE conference_slug = '/2026'`;
  const closed = yield* registrar.ensureClosed(conference);
  const preview = yield* registrar.setPreview({
    conference,
    expectedRevision: closed.revision,
    formVersion: published.version,
    timeZone: ConferenceTimeZone.make('America/Toronto'),
  });
  yield* registrar.open({
    conference,
    expectedRevision: preview.revision,
    at,
    infrastructure: { stripe: true, workflows: true },
  });
  return published.version;
});

describe('RegistrationIntake', () => {
  it.effect('freezes the whole group aggregate and enqueues Checkout in one transaction', () => {
    const queued: string[] = [];
    return Effect.gen(function* () {
      const version = yield* openRegistration;
      const intake = yield* RegistrationIntake.Service;
      const command = {
        conference,
        expectedVersion: version,
        idempotencyToken: Forms.IdempotencyToken.make('attempt-group'),
        shell: shell(),
        at,
      };
      const created = yield* intake.submit(command);
      expect(created.replayed).toBe(false);
      expect(created.orders).toHaveLength(1);
      const order = created.orders[0];
      if (order === undefined) throw new Error('expected one Order');
      expect(order.amount).toBe(5_000);
      expect(queued).toEqual([order.id]);

      const sql = yield* SqlClient;
      const counts = yield* sql<{
        registrations: number;
        registrants: number;
        orders: number;
        links: number;
      }>`
        SELECT
          (SELECT count(*)::int FROM registrations) AS registrations,
          (SELECT count(*)::int FROM registrants) AS registrants,
          (SELECT count(*)::int FROM registration_orders) AS orders,
          (SELECT count(*)::int FROM registration_order_registrants) AS links
      `;
      expect(counts[0]).toEqual({
        registrations: 1,
        registrants: 1,
        orders: 1,
        links: 1,
      });

      const replay = yield* intake.submit(command);
      expect(replay).toEqual({ ...created, replayed: true });
      expect(queued).toHaveLength(1);

      const conflict = yield* intake
        .submit({
          ...command,
          shell: {
            ...shell(),
            registrants: [
              { ...shell().registrants[0], company: 'Changed Books' },
            ],
          },
        })
        .pipe(Effect.flip);
      expect(conflict).toBeInstanceOf(IdempotencyConflict);
    }).pipe(
      Effect.provide(
        testLayer((orderId) =>
          Effect.sync(() => {
            queued.push(orderId);
          }),
        ),
      ),
    );
  });

  it.effect('creates one independently payable Order per Registrant', () => {
    const queued: string[] = [];
    return Effect.gen(function* () {
      const version = yield* openRegistration;
      const intake = yield* RegistrationIntake.Service;
      const result = yield* intake.submit({
        conference,
        expectedVersion: version,
        idempotencyToken: Forms.IdempotencyToken.make('attempt-individual'),
        shell: shell('perRegistrant'),
        at,
      });
      expect(result.orders.map((order) => order.amount)).toEqual([5_000, 5_000]);
      expect(queued).toEqual(result.orders.map((order) => order.id));

      const sql = yield* SqlClient;
      const links = yield* sql<{ orderId: string; count: number }>`
        SELECT order_id AS "orderId", count(*)::int AS count
        FROM registration_order_registrants
        GROUP BY order_id
        ORDER BY order_id
      `;
      expect(links.map((link) => link.count)).toEqual([1, 1]);
    }).pipe(
      Effect.provide(
        testLayer((orderId) =>
          Effect.sync(() => {
            queued.push(orderId);
          }),
        ),
      ),
    );
  });

  it.effect('rolls back the aggregate when any durable Checkout enqueue fails', () =>
    Effect.gen(function* () {
      const version = yield* openRegistration;
      const intake = yield* RegistrationIntake.Service;
      yield* intake
        .submit({
          conference,
          expectedVersion: version,
          idempotencyToken: Forms.IdempotencyToken.make('attempt-rollback'),
          shell: shell('perRegistrant'),
          at,
        })
        .pipe(Effect.flip);

      const sql = yield* SqlClient;
      const rows = yield* sql<{ count: number }>`
        SELECT count(*)::int AS count FROM registrations
      `;
      expect(rows[0]?.count).toBe(0);
    }).pipe(
      Effect.provide(
        testLayer(() =>
          Effect.fail(
            new OrderActor.EnqueueError({ operation: 'test failure' }),
          ),
        ),
      ),
    ),
  );
});
