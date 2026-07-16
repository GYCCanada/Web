import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Option } from 'effect';

import { Database } from '../database.server';

import { defaultContactForm } from './defaults';
import { Forms } from './forms.server';

const testLayer = Forms.layer.pipe(Layer.provide(Database.layerTest));

const validContact = {
  name: 'Ada Lovelace',
  method: 'email',
  email: 'ada@example.com',
  message: 'Hello from the relational store.',
};

describe('Forms', () => {
  it.effect('seeds and reads the current immutable definition', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;

      const first = yield* forms.current('contact');
      const second = yield* forms.current('contact');

      expect(first.definition).toEqual(defaultContactForm);
      expect(first.version).toBe(second.version);
      expect(first.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('publishes a new version and rejects a stale compare-and-set', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const initial = yield* forms.current('contact');
      const edited = {
        ...initial.definition,
        title: { ...initial.definition.title, en: 'Write to us' },
      };

      const published = yield* forms.publish({
        form: 'contact',
        expectedCurrentVersion: Option.some(initial.version),
        definition: edited,
      });
      const conflict = yield* forms
        .publish({
          form: 'contact',
          expectedCurrentVersion: Option.some(initial.version),
          definition: initial.definition,
        })
        .pipe(Effect.flip);

      expect(published.version).not.toBe(initial.version);
      expect(published.definition.title.en).toBe('Write to us');
      expect(conflict._tag).toBe('Forms.PublishConflict');
      if (Forms.PublishConflict.is(conflict)) {
        expect(conflict.actual).toEqual(Option.some(published.version));
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('validates a whole batch before consuming its idempotency token', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const current = yield* forms.current('contact');
      const token = Forms.IdempotencyToken.make('atomic-batch');

      const rejected = yield* forms
        .submit({
          form: 'contact',
          expectedVersion: current.version,
          idempotencyToken: token,
          payloads: [validContact, { method: 'email' }],
        })
        .pipe(Effect.flip);
      const accepted = yield* forms.submit({
        form: 'contact',
        expectedVersion: current.version,
        idempotencyToken: token,
        payloads: [validContact, validContact],
      });

      expect(rejected._tag).toBe('Forms.SubmissionRejected');
      expect(accepted.replayed).toBe(false);
      expect(accepted.submissions).toHaveLength(2);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('replays one command but rejects token reuse for another command', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const current = yield* forms.current('contact');
      const token = Forms.IdempotencyToken.make('explicit-retry-token');
      const command = {
        form: 'contact' as const,
        expectedVersion: current.version,
        idempotencyToken: token,
        payloads: [validContact] as const,
      };

      const first = yield* forms.submit(command);
      const replay = yield* forms.submit(command);
      const conflict = yield* forms
        .submit({
          ...command,
          payloads: [{ ...validContact, message: 'A different command.' }],
        })
        .pipe(Effect.flip);
      const distinct = yield* forms.submit({
        ...command,
        idempotencyToken: Forms.IdempotencyToken.make('another-token'),
      });

      expect(replay.replayed).toBe(true);
      expect(replay.id).toBe(first.id);
      expect(replay.submissions[0].id).toBe(first.submissions[0].id);
      expect(conflict._tag).toBe('Forms.IdempotencyConflict');
      expect(distinct.id).not.toBe(first.id);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('rejects a submission rendered from a superseded definition', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const rendered = yield* forms.current('contact');
      const current = yield* forms.publish({
        form: 'contact',
        expectedCurrentVersion: Option.some(rendered.version),
        definition: {
          ...rendered.definition,
          title: { ...rendered.definition.title, en: 'A newer definition' },
        },
      });

      const advanced = yield* forms
        .submit({
          form: 'contact',
          expectedVersion: rendered.version,
          idempotencyToken: Forms.IdempotencyToken.make('stale-render'),
          payloads: [validContact],
        })
        .pipe(Effect.flip);

      expect(advanced._tag).toBe('Forms.DefinitionAdvanced');
      if (Forms.DefinitionAdvanced.is(advanced)) {
        expect(advanced.expected).toBe(rendered.version);
        expect(advanced.current).toBe(current.version);
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect('replays a committed attempt after its definition is superseded', () =>
    Effect.gen(function* () {
      const forms = yield* Forms.Service;
      const rendered = yield* forms.current('contact');
      const command = {
        form: 'contact' as const,
        expectedVersion: rendered.version,
        idempotencyToken: Forms.IdempotencyToken.make('published-retry'),
        payloads: [validContact] as const,
      };
      const committed = yield* forms.submit(command);

      yield* forms.publish({
        form: 'contact',
        expectedCurrentVersion: Option.some(rendered.version),
        definition: {
          ...rendered.definition,
          title: { ...rendered.definition.title, en: 'Published after commit' },
        },
      });

      const replay = yield* forms.submit(command);

      expect(replay.replayed).toBe(true);
      expect(replay.id).toBe(committed.id);
      expect(replay.definitionVersion).toBe(rendered.version);
    }).pipe(Effect.provide(testLayer)),
  );
});
