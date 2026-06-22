import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { defaultRegistrationForm } from '../content/pages/defaults';

import { FormDefinition } from './definition';
import { registrationShellSchema, type RegistrationShellDecoded } from './registration-shell';

/**
 * The route-owned party-aware shell decoder (registrar plan Decision 2b.4 / C7) —
 * the codec the registration route decodes a submission against. These tests pin
 * the C7 scope: the `group` arm (nominated payer required, blank non-leader emails
 * dropped to absent) + the no-`party` legacy arm. The `perRegistrant` arm + the
 * allow-list smuggle reject are C7.5.
 *
 * The decode boundary is the same `Schema.decodeUnknownResult` the route uses, so
 * a value that decodes here is exactly what the action's `parseSchema` accepts.
 */

const decode = (definition: FormDefinition, payload: unknown) =>
  Schema.decodeUnknownResult(registrationShellSchema(definition))(payload);

/**
 * A minimal exhibitor registrant the engine codec accepts (the simple branch — no
 * nested attendee graph). `email` is included where presence matters; tests omit
 * or blank it to exercise the group blank-drop.
 */
const exhibitor = (over?: Record<string, unknown>) => ({
  type: 'exhibitor',
  name: 'Booth Co.',
  email: 'booth@example.com',
  phone: '123-456-7890',
  synopsis: 'We sell health books.',
  website: 'https://example.com',
  company: 'Booth Co. Ltd.',
  ...over,
});

/** The group party payer block the default `registration` form authors. */
const payer = (over?: Record<string, unknown>) => ({
  name: 'Group Leader',
  email: 'leader@example.com',
  ...over,
});

describe('registrationShellSchema — group arm', () => {
  test('decodes a group submission: registrants + nominated payer, mode defaulted', () => {
    const result = decode(defaultRegistrationForm, {
      // `party._tag` ABSENT — the shell fills the lone authored `group` mode.
      party: { payer: payer() },
      registrants: [exhibitor()],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const shell = result.success as Extract<
        RegistrationShellDecoded,
        { party: { _tag: 'group' } }
      >;
      expect(shell.party._tag).toBe('group');
      expect(shell.party.payer).toEqual({
        name: 'Group Leader',
        email: 'leader@example.com',
      });
      expect(shell.registrants.length).toBe(1);
    }
  });

  test('an explicit group _tag also decodes (idempotent with the default fill)', () => {
    const result = decode(defaultRegistrationForm, {
      party: { _tag: 'group', payer: payer() },
      registrants: [exhibitor()],
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  test('a blank non-leader registrant email is DROPPED to absent and decodes valid (2b.3)', () => {
    // The live form renders `email: ''`; in group an un-filled non-leader email
    // must be normalized to absent server-side so the optional-at-key email codec
    // accepts it. This is the shell drop — the schema alone would still reject ''.
    const result = decode(defaultRegistrationForm, {
      party: { payer: payer() },
      registrants: [exhibitor(), exhibitor({ email: '' })],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const shell = result.success as { registrants: ReadonlyArray<Record<string, unknown>> };
      // The dropped email is absent (not present-blank) on the decoded registrant.
      expect('email' in shell.registrants[1]!).toBe(false);
    }
  });

  test('a blank payer email FAILS (the payer email is required, never dropped)', () => {
    const result = decode(defaultRegistrationForm, {
      party: { payer: payer({ email: '' }) },
      registrants: [exhibitor()],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('a malformed payer email FAILS the invalid key', () => {
    const result = decode(defaultRegistrationForm, {
      party: { payer: payer({ email: 'not-an-email' }) },
      registrants: [exhibitor()],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('an absent payer name FAILS (the nominated payer name is required)', () => {
    const result = decode(defaultRegistrationForm, {
      party: { payer: { email: 'leader@example.com' } },
      registrants: [exhibitor()],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('an empty party (zero registrants) FAILS — nonEmptyParty', () => {
    const result = decode(defaultRegistrationForm, {
      party: { payer: payer() },
      registrants: [],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('the "I\'m paying" payer values (copied from a registrant) decode to that payer', () => {
    // The affordance copies a registrant's name + email into the payer inputs; the
    // server decodes + freezes them verbatim — so a payer equal to registrant[0]
    // is the decoded payer (the convenience is purely client-side).
    const reg = exhibitor({ name: 'Self Payer', email: 'self@example.com' });
    const result = decode(defaultRegistrationForm, {
      party: { payer: { name: reg.name, email: reg.email } },
      registrants: [reg],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const shell = result.success as Extract<
        RegistrationShellDecoded,
        { party: { _tag: 'group' } }
      >;
      expect(shell.party.payer).toEqual({
        name: 'Self Payer',
        email: 'self@example.com',
      });
    }
  });
});

/**
 * C7.5 — the mode union: `perRegistrant` cardinality + per-registrant email
 * re-imposition + the allow-list smuggle reject. The default `registration` form
 * now authors BOTH modes; a group-only form is derived by dropping the
 * `perRegistrant` option (the allow-list IS the authored option-struct keys).
 */
const groupOnlyForm = (() => {
  const encoded = Schema.encodeSync(FormDefinition)(defaultRegistrationForm);
  // Drop the `perRegistrant` option key so the allow-list is `['group']` only.
  const { perRegistrant: _drop, ...groupOnlyOptions } =
    encoded.party!.billingMode.options;
  return Schema.decodeUnknownSync(FormDefinition)({
    ...encoded,
    party: {
      ...encoded.party!,
      billingMode: { ...encoded.party!.billingMode, options: groupOnlyOptions },
    },
  });
})();

describe('registrationShellSchema — perRegistrant arm + allow-list (C7.5)', () => {
  test('present perRegistrant on a GROUP-ONLY form REJECTS (allow-list smuggle)', () => {
    const result = decode(groupOnlyForm, {
      party: { _tag: 'perRegistrant' },
      registrants: [exhibitor()],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('present perRegistrant on a TWO-MODE form ACCEPTS (no payer, registrant emails present)', () => {
    const result = decode(defaultRegistrationForm, {
      party: { _tag: 'perRegistrant' },
      registrants: [exhibitor(), exhibitor({ email: 'two@example.com' })],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const shell = result.success as Extract<
        RegistrationShellDecoded,
        { party: { _tag: 'perRegistrant' } }
      >;
      expect(shell.party._tag).toBe('perRegistrant');
      // No payer is decoded in perRegistrant (unrepresentable).
      expect('payer' in shell.party).toBe(false);
      expect(shell.registrants.length).toBe(2);
    }
  });

  test('present group on a TWO-MODE form ACCEPTS (the payer arm still works)', () => {
    const result = decode(defaultRegistrationForm, {
      party: { _tag: 'group', payer: payer() },
      registrants: [exhibitor()],
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  test('an ABSENT mode on a TWO-MODE form decodes to the FIRST authored arm (group), requirements intact', () => {
    // `group` is the first authored option; an absent `_tag` fills it — so the
    // payer is REQUIRED (the first arm's requirement is not skipped by falling
    // through to perRegistrant).
    const ok = decode(defaultRegistrationForm, {
      party: { payer: payer() },
      registrants: [exhibitor()],
    });
    expect(Result.isSuccess(ok)).toBe(true);
    if (Result.isSuccess(ok)) {
      const shell = ok.success as Extract<
        RegistrationShellDecoded,
        { party: { _tag: 'group' } }
      >;
      expect(shell.party._tag).toBe('group');
    }
    // Absent mode + NO payer must NOT silently fall through to perRegistrant — the
    // first arm's payer requirement holds.
    const missingPayer = decode(defaultRegistrationForm, {
      party: {},
      registrants: [exhibitor()],
    });
    expect(Result.isFailure(missingPayer)).toBe(true);
  });

  test('perRegistrant re-imposes EVERY registrant email — a blank registrant email FAILS', () => {
    // The engine sees email as optional-at-key; perRegistrant re-imposes presence,
    // so a blank (un-filled) registrant email FAILS — the orthogonal opposite of
    // the group blank-drop.
    const result = decode(defaultRegistrationForm, {
      party: { _tag: 'perRegistrant' },
      registrants: [exhibitor(), exhibitor({ email: '' })],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('perRegistrant with an ABSENT registrant email also FAILS (presence required, not just non-blank)', () => {
    const { email: _absent, ...noEmail } = exhibitor();
    const result = decode(defaultRegistrationForm, {
      party: { _tag: 'perRegistrant' },
      registrants: [noEmail],
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('registrationShellSchema — no-party legacy arm', () => {
  // A definition with no `party` (a legacy `forms/registration.json` authored
  // before the party section, or contact/volunteer) decodes the TODAY shell,
  // group-implicit — nothing about the existing forms changes.
  const legacyForm = (() => {
    const { party: _party, ...withoutParty } = Schema.encodeSync(FormDefinition)(
      defaultRegistrationForm,
    );
    return Schema.decodeUnknownSync(FormDefinition)(withoutParty);
  })();

  test('decodes the bare { registrants } shell with no party block', () => {
    const result = decode(legacyForm, { registrants: [exhibitor()] });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect('party' in result.success).toBe(false);
    }
  });

  test('still rejects a zero-registrant legacy submission (nonEmptyParty)', () => {
    const result = decode(legacyForm, { registrants: [] });
    expect(Result.isFailure(result)).toBe(true);
  });
});
