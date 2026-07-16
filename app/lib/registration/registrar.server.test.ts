import { describe, expect, it } from 'effect-bun-test';
import { DateTime, Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import {
  ConferenceSlug,
  ExternalHttpsUrl,
} from '../content/schema';
import { DatabaseTest } from '../database.test-helper';
import { Forms } from '../forms/forms.server';
import {
  ActiveOrders,
  ChannelNotReady,
  ConferenceTimeZone,
  InvalidTransition,
  Registrar,
  RevisionConflict,
  projectPublicChannel,
} from './registrar.server';

const formsLayer = Forms.layer.pipe(Layer.provideMerge(DatabaseTest.layer));
const readyInfrastructure = Layer.succeed(
  Registrar.Infrastructure,
  Registrar.Infrastructure.of({
    readiness: Effect.succeed({ stripe: true, workflows: true, alerts: true }),
  }),
);
const testLayer = Registrar.layer.pipe(
  Layer.provideMerge(formsLayer),
  Layer.provideMerge(readyInfrastructure),
);
const unavailableTestLayer = Registrar.layer.pipe(
  Layer.provideMerge(formsLayer),
  Layer.provideMerge(
    Layer.succeed(
      Registrar.Infrastructure,
      Registrar.Infrastructure.of({
        readiness: Effect.succeed({
          stripe: false,
          workflows: false,
          alerts: false,
        }),
      }),
    ),
  ),
);
const test = it.effect.layer(testLayer);

const conference = ConferenceSlug.make('/2026');
const timeZone = ConferenceTimeZone.make('America/Toronto');
const at = DateTime.makeUnsafe(Date.parse('2026-08-01T12:00:00.000Z'));

const text = (value: string) => ({ en: value, fr: value });

const publishReadyRegistration = Effect.gen(function* () {
  const forms = yield* Forms.Service;
  const current = yield* forms.current('registration');
  return yield* forms.publish({
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
            perRegistrant: text('Each registrant pays'),
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
        base: 0,
        registrationClosesAt: '2026-09-01T04:00:00.000Z',
        rules: [],
        windows: [],
      },
    },
  });
});

describe('Registrar', () => {
  test('projects one public CTA/intake policy from lifecycle state', () => Effect.sync(() => {
    const base = { conference, revision: 0, updatedAt: at };
    const externalUrl = ExternalHttpsUrl.make('https://example.com/register');
    expect(projectPublicChannel({ ...base, state: 'closed' }, 'en')).toEqual({
      intake: 'unavailable',
    });
    expect(
      projectPublicChannel(
        {
          ...base,
          state: 'external',
          url: externalUrl,
        },
        'en',
      ),
    ).toEqual({ intake: 'external', url: externalUrl });
    expect(
      projectPublicChannel(
        {
          ...base,
          state: 'open',
          formVersion: Forms.FormDefinitionVersionId.make(
            `sha256:${'0'.repeat(64)}`,
          ),
          timeZone,
        },
        'fr',
      ),
    ).toMatchObject({ intake: 'open', registrationUrl: '/fr/2026/form' });
  }));

  it.effect('derives infrastructure readiness internally before opening', () =>
    Effect.gen(function* () {
      const registrar = yield* Registrar.Service;
      const sql = yield* SqlClient;
      const ready = yield* publishReadyRegistration;
      yield* sql`DELETE FROM registration_channels WHERE conference_slug = '/2026'`;
      const closed = yield* registrar.ensureClosed(conference);
      const preview = yield* registrar.setPreview({
        conference,
        expectedRevision: closed.revision,
        formVersion: ready.version,
        timeZone,
      });
      const unavailable = yield* registrar
        .open({ conference, expectedRevision: preview.revision, at })
        .pipe(Effect.flip);
      expect(unavailable).toBeInstanceOf(ChannelNotReady);
      if (unavailable instanceof ChannelNotReady) {
        expect(unavailable.issues.map((issue) => issue.code)).toEqual([
          'stripe-unavailable',
          'workflows-unavailable',
          'alerts-unavailable',
        ]);
      }
      yield* sql`
        UPDATE registration_channels
        SET state = 'draining'
        WHERE conference_slug = ${conference}
      `;
      const reopen = yield* registrar
        .reopen({ conference, expectedRevision: preview.revision, at })
        .pipe(Effect.flip);
      expect(reopen).toBeInstanceOf(ChannelNotReady);
    }).pipe(Effect.provide(unavailableTestLayer)),
  );

  test('serializes the named closed → external → preview → open lifecycle', () =>
    Effect.gen(function* () {
      const registrar = yield* Registrar.Service;
      const sql = yield* SqlClient;
      const ready = yield* publishReadyRegistration;
      yield* sql`DELETE FROM registration_channels WHERE conference_slug = '/2026'`;
      const closed = yield* registrar.ensureClosed(conference);
      expect(closed.state).toBe('closed');
      expect(closed.revision).toBe(0);

      const external = yield* registrar.setExternal({
        conference,
        expectedRevision: closed.revision,
        url: ExternalHttpsUrl.make('https://example.com/register'),
      });
      expect(external.state).toBe('external');

      const stale = yield* registrar
        .close({ conference, expectedRevision: closed.revision })
        .pipe(Effect.flip);
      expect(stale).toBeInstanceOf(RevisionConflict);

      const preview = yield* registrar.setPreview({
        conference,
        expectedRevision: external.revision,
        formVersion: ready.version,
        timeZone,
      });
      expect(preview.state).toBe('preview');

      const opened = yield* registrar.open({
        conference,
        expectedRevision: preview.revision,
        at,
      });
      expect(opened.state).toBe('open');

      const directClose = yield* registrar
        .close({ conference, expectedRevision: opened.revision })
        .pipe(Effect.flip);
      expect(directClose).toBeInstanceOf(InvalidTransition);

      const draining = yield* registrar.beginDrain({
        conference,
        expectedRevision: opened.revision,
      });
      expect(draining.state).toBe('draining');

      const closedAgain = yield* registrar.close({
        conference,
        expectedRevision: draining.revision,
      });
      expect(closedAgain.state).toBe('closed');
    }),
  );

  test('blocks draining completion while any Order remains non-terminal', () =>
    Effect.gen(function* () {
      const registrar = yield* Registrar.Service;
      const sql = yield* SqlClient;
      const ready = yield* publishReadyRegistration;
      yield* sql`DELETE FROM registration_channels WHERE conference_slug = '/2026'`;
      const closed = yield* registrar.ensureClosed(conference);
      const preview = yield* registrar.setPreview({
        conference,
        expectedRevision: closed.revision,
        formVersion: ready.version,
        timeZone,
      });
      const opened = yield* registrar.open({
        conference,
        expectedRevision: preview.revision,
        at,
      });
      const draining = yield* registrar.beginDrain({
        conference,
        expectedRevision: opened.revision,
      });

      yield* sql`
        INSERT INTO submission_batches (
          batch_id,
          form_id,
          definition_version_id,
          idempotency_token,
          command_hash
        ) VALUES (
          'batch-active',
          'registration',
          ${ready.version},
          'attempt-active',
          'submission-command-hash'
        )
      `;
      yield* sql`
        INSERT INTO submissions (
          submission_id,
          batch_id,
          ordinal,
          payload
        ) VALUES (
          'submission-active',
          'batch-active',
          0,
          '{}'::jsonb
        )
      `;
      yield* sql`
        INSERT INTO registrations (
          registration_id,
          conference_slug,
          form_id,
          form_definition_version_id,
          submission_batch_id,
          idempotency_token,
          command_hash,
          billing_mode,
          currency,
          total_amount,
          priced_at,
          quote_expires_at
        ) VALUES (
          'registration-active',
          ${conference},
          'registration',
          ${ready.version},
          'batch-active',
          'commerce-attempt',
          'commerce-hash',
          'perRegistrant',
          'cad',
          0,
          '2026-08-01T12:00:00.000Z',
          '2026-08-02T12:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO registrants (
          registrant_id,
          registration_id,
          submission_id,
          ordinal
        ) VALUES (
          'registrant-active',
          'registration-active',
          'submission-active',
          0
        )
      `;
      yield* sql`
        INSERT INTO registration_orders (
          order_id,
          registration_id,
          ordinal,
          status,
          amount,
          currency,
          receipt_email,
          quote_snapshot,
          priced_at,
          quote_expires_at,
          stripe_idempotency_key
        ) VALUES (
          'order-active',
          'registration-active',
          0,
          'awaiting_payment',
          0,
          'cad',
          'ada@example.com',
          '{}'::jsonb,
          '2026-08-01T12:00:00.000Z',
          '2026-08-02T12:00:00.000Z',
          'checkout-order-active'
        )
      `;

      const blocked = yield* registrar
        .close({ conference, expectedRevision: draining.revision })
        .pipe(Effect.flip);
      expect(blocked).toBeInstanceOf(ActiveOrders);
      if (blocked instanceof ActiveOrders) expect(blocked.count).toBe(1);
      expect((yield* registrar.get(conference)).state).toBe('draining');
    }),
  );
});
