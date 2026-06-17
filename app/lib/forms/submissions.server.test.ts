import { describe, expect, it } from 'effect-bun-test';
import { Effect, Layer, Result, Schema } from 'effect';

import { Content } from '../content.server';
import {
  defaultContactForm,
  defaultRegistrationForm,
} from '../content/pages/defaults';
import { submissionKey } from '../content/pages/registry';
import { ListItemId } from '../content/schema';
import { Storage } from '../storage.server';
import { layerTest } from '../storage.test-helper';

import { decodeForm } from './decode';
import { submissionSchema } from './submission';
import { Submissions } from './submissions.server';

/**
 * Branch 7.2 — the `Submissions.persist` service (persist-only). These tests pin
 * the durable-write contract the persist-then-notify wiring (Branch 7.3) and the
 * future first-party registrar (CONTEXT §Submission:47) build on (`prove-it-works`):
 *
 *   - `persist` writes the `Submission` object to `submissions/<form>/<id>.json`
 *     and returns the stored record — the bucket is the durable source of truth;
 *   - the stored object round-trips: reading it back + decoding through
 *     `submissionSchema(definition)` recovers the same envelope + payload (the
 *     on-bucket shape the registrar reads);
 *   - persistence is decoupled from notification — `persist` has NO mailer in its
 *     call path, so the record is written BEFORE any notify step could run; a
 *     downstream notify failure (Branch 7.3) provably cannot lose the record
 *     because the durable write already returned;
 *   - the registration `Submission`'s payload shape IS the decoded `FormDefinition`
 *     type (`derive-dont-sync`) — what the registrar's read contract expects.
 */

/**
 * Provide `Submissions` (with its `Content` + `Storage` requirements satisfied by a
 * SHARED bucket-less `Storage` test layer) AND expose that same `Storage` to the
 * test effect, so a test can read back what `persist` wrote. The empty bucket makes
 * `Content.getForm` fall back to the bundled default definition (the dev / fallback
 * path), which is exactly what a `persist` derives its payload codec from.
 */
const provideSubmissions =
  (objects: Parameters<typeof layerTest>[0] = {}) =>
  <A, E>(
    effect: Effect.Effect<
      A,
      E,
      Submissions.Service | Storage.Service
    >,
  ) => {
    const storage = layerTest(objects);
    return effect.pipe(
      Effect.provide(
        Layer.provideMerge(
          Submissions.layer,
          Layer.provideMerge(Content.layer, storage),
        ),
      ),
    );
  };

/** Read a stored object's body as text through `Storage.get`. */
const readStoredText = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const object = yield* storage.get(key);
    return yield* Effect.promise(() => new Response(object.stream).text());
  });

/**
 * A minimal VALID registration payload — the `exhibitor` variant (the simpler of
 * the two: base name/email/phone + synopsis/website/company, no nested attendee
 * graph). Decoded through the registration `FormDefinition`'s own decoder so the
 * persisted value is exactly what the generic decoder produces.
 */
const registrationPayload = {
  name: 'Booth Co.',
  email: 'booth@example.com',
  phone: '123-456-7890',
  type: 'exhibitor',
  synopsis: 'We sell health books.',
  website: 'https://example.com',
  company: 'Booth Co. Ltd.',
};

/** Decode a valid contact payload through the form's own decoder (the real path). */
const decodeContact = (payload: Record<string, unknown>) => {
  const result = decodeForm(defaultContactForm, payload);
  if (Result.isFailure(result)) {
    throw new Error('contact fixture payload should decode but did not');
  }
  return result.success;
};

/** Decode the valid registration fixture through the registration form's decoder. */
const decodeRegistration = () => {
  const result = decodeForm(defaultRegistrationForm, registrationPayload);
  if (Result.isFailure(result)) {
    throw new Error('registration fixture payload should decode but did not');
  }
  return result.success;
};

describe('Submissions.persist — durable write (Branch 7.2)', () => {
  it.effect('writes the Submission object and returns the stored record', () =>
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;
      const decoded = decodeContact({
        name: 'Ada Lovelace',
        method: 'email',
        email: 'ada@example.com',
        message: 'Hello from the bucket.',
      });

      const stored = yield* submissions.persist('contact', decoded);

      // The returned record carries the closed form id, a real branded id, and the
      // decoded payload (the source of truth the caller hands the notify step).
      expect(stored.form).toBe('contact');
      expect(Schema.is(ListItemId)(stored.id)).toBe(true);
      expect(stored.payload['name']).toBe('Ada Lovelace');
      expect(stored.payload['email']).toBe('ada@example.com');

      // The object physically landed at `submissions/<form>/<id>.json`.
      const key = submissionKey('contact', stored.id);
      const head = yield* (yield* Storage.Service).head(key);
      expect(head._tag).toBe('Some');
    }).pipe(provideSubmissions()),
  );

  it.effect('the stored object round-trips back to the same Submission', () =>
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;
      const decoded = decodeContact({
        name: 'Grace Hopper',
        method: 'phone',
        phone: '123-456-7890',
        message: 'Reading my own record back.',
      });

      const stored = yield* submissions.persist('contact', decoded);

      // Read the on-bucket JSON and decode it through the SAME definition-derived
      // schema (`derive-dont-sync`) — the registrar's read contract.
      const json = yield* readStoredText(submissionKey('contact', stored.id));
      const back = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(submissionSchema(defaultContactForm)),
      )(json);
      expect(back.id).toBe(stored.id);
      expect(back.form).toBe('contact');
      expect(String(back.submittedAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(back.payload).toEqual(stored.payload);
    }).pipe(provideSubmissions()),
  );

  it.effect('two submissions get distinct ids + distinct keys', () =>
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;
      const decoded = decodeContact({
        name: 'Repeat Submitter',
        method: 'email',
        email: 'repeat@example.com',
        message: 'Again.',
      });

      const first = yield* submissions.persist('contact', decoded);
      const second = yield* submissions.persist('contact', decoded);

      expect(first.id).not.toBe(second.id);
      // Both records survive — neither overwrote the other.
      const firstHead = yield* (yield* Storage.Service).head(
        submissionKey('contact', first.id),
      );
      const secondHead = yield* (yield* Storage.Service).head(
        submissionKey('contact', second.id),
      );
      expect(firstHead._tag).toBe('Some');
      expect(secondHead._tag).toBe('Some');
    }).pipe(provideSubmissions()),
  );
});

describe('Submissions.persist — persist is decoupled from notify (settled #8)', () => {
  /**
   * `persist` is persistence ONLY: it has no mailer in its context or call path.
   * The record is written + returned BEFORE any notify step (Branch 7.3) could
   * run, so a downstream notify failure provably cannot lose the record — the
   * durable object is already on the bucket. This test proves the WRITE completes
   * independent of any notification by asserting the object exists the instant
   * `persist` returns, with no mailer ever wired into this path.
   */
  it.effect('the record is on the bucket the instant persist returns', () =>
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;
      const decoded = decodeContact({
        name: 'Durable Record',
        method: 'email',
        email: 'durable@example.com',
        message: 'I survive a notify failure.',
      });

      const stored = yield* submissions.persist('contact', decoded);

      const head = yield* (yield* Storage.Service).head(
        submissionKey('contact', stored.id),
      );
      expect(head._tag).toBe('Some');
    }).pipe(provideSubmissions()),
  );
});

describe('Submissions.persist — payload derived from the FormDefinition', () => {
  /**
   * The registration `Submission`'s payload shape IS the decoded registration
   * `FormDefinition` type (`derive-dont-sync`) — the read contract the future
   * registrar consumes. Persisting a valid registration payload and reading it
   * back through `submissionSchema(defaultRegistrationForm)` proves the stored
   * shape is the form's decoded type, never a re-declared struct.
   */
  it.effect('a registration submission round-trips through the derived schema', () =>
    Effect.gen(function* () {
      const submissions = yield* Submissions.Service;

      // A minimal valid registration payload, decoded through the form's OWN decoder
      // (the same path the action runs), so the persisted value is exactly what the
      // generic decoder produces — not a hand-built shape.
      const decoded = decodeRegistration();

      const stored = yield* submissions.persist('registration', decoded);
      expect(stored.form).toBe('registration');

      const json = yield* readStoredText(
        submissionKey('registration', stored.id),
      );
      const back = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(submissionSchema(defaultRegistrationForm)),
      )(json);
      expect(back.payload).toEqual(stored.payload);
    }).pipe(provideSubmissions()),
  );
});
