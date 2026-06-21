import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';

import { activationIndex, isActiveByName } from './activation';
import type { FormDefinition } from './definition';
import { FormDefinition as FormDefinitionSchema } from './definition';

/**
 * C4a — the ONE shared pure activation evaluator (registrar plan Decision 5).
 * `activation.ts` owns the law `isActive(field, scope)` that all three
 * consumers (price, decode, render) read, never re-implement. These tests pin
 * the evaluator against each `ActiveWhen` predicate kind and the
 * no-rule-⇒-always-active default; the four DECODE rows that ride on it are
 * pinned in `decode.test.ts`, the integrity guard in `definition.test.ts`.
 */

const text = (en: string, fr: string) => ({ en, fr });

/** Decode a raw JSON definition through the schema (as `Content.getForm` would). */
const asDefinition = (json: unknown): FormDefinition =>
  Schema.decodeUnknownSync(FormDefinitionSchema)(json);

/**
 * A form whose `banquetSeats` (text) is gated by a `literal` (`addBanquet`), its
 * `dietaryNotes` (text) by an `arrayOfLiteral` (`workshops`), and its `guestName`
 * (text) by a `checkboxBoolean` (`bringingGuest`) — one rule per predicate kind.
 */
const gatedDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'literal',
      name: 'addBanquet',
      label: text('Banquet?', 'Banquet?'),
      requiredMessage: 'registration.form.gender.required',
      options: [
        { value: 'yes', label: text('Yes', 'Oui') },
        { value: 'no', label: text('No', 'Non') },
      ],
    },
    {
      _tag: 'arrayOfLiteral',
      name: 'workshops',
      label: text('Workshops', 'Ateliers'),
      requiredMessage: 'registration.form.merch.required',
      options: [
        { value: 'music', label: text('Music', 'Musique') },
        { value: 'photo', label: text('Photo', 'Photo') },
      ],
    },
    {
      _tag: 'checkboxBoolean',
      name: 'bringingGuest',
      label: text('Bringing a guest?', 'Amener un invité?'),
      requiredMessage: 'registration.form.tos.required',
    },
    {
      _tag: 'requiredText',
      name: 'banquetSeats',
      label: text('Seats', 'Places'),
      requiredMessage: 'registration.form.church.required',
    },
    {
      _tag: 'requiredText',
      name: 'dietaryNotes',
      label: text('Diet', 'Régime'),
      requiredMessage: 'registration.form.dietary-restrictions.required',
    },
    {
      _tag: 'requiredText',
      name: 'guestName',
      label: text('Guest name', "Nom de l'invité"),
      requiredMessage: 'registration.form.name.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: { _tag: 'literalEquals', when: 'addBanquet', equals: ['yes'] },
      target: 'banquetSeats',
    },
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'arrayIncludesAny',
        when: 'workshops',
        values: ['music'],
      },
      target: 'dietaryNotes',
    },
    {
      _tag: 'activeWhenEquals',
      predicate: { _tag: 'checkboxChecked', when: 'bringingGuest' },
      target: 'guestName',
    },
  ],
});

describe('activationIndex', () => {
  test('indexes only activeWhenEquals rules, keyed by target', () => {
    const index = activationIndex(gatedDef);
    expect([...index.keys()].sort()).toEqual([
      'banquetSeats',
      'dietaryNotes',
      'guestName',
    ]);
    expect(index.get('banquetSeats')?.predicate._tag).toBe('literalEquals');
  });

  test('a definition with no rules indexes to empty', () => {
    const bare = asDefinition({ title: text('F', 'F'), fields: [] });
    expect(activationIndex(bare).size).toBe(0);
  });
});

describe('isActiveByName — no rule ⇒ always active', () => {
  test('a field no rule targets is active regardless of scope', () => {
    const index = activationIndex(gatedDef);
    expect(isActiveByName('addBanquet', index, {})).toBe(true);
    expect(isActiveByName('addBanquet', index, { addBanquet: 'no' })).toBe(true);
  });
});

describe('isActiveByName — literalEquals', () => {
  const index = activationIndex(gatedDef);

  test('active when the literal sibling equals a trigger value', () => {
    expect(isActiveByName('banquetSeats', index, { addBanquet: 'yes' })).toBe(
      true,
    );
  });

  test('inactive when the sibling is off-trigger, absent, or non-string', () => {
    expect(isActiveByName('banquetSeats', index, { addBanquet: 'no' })).toBe(
      false,
    );
    expect(isActiveByName('banquetSeats', index, {})).toBe(false);
    expect(isActiveByName('banquetSeats', index, { addBanquet: 3 })).toBe(false);
  });
});

describe('isActiveByName — arrayIncludesAny', () => {
  const index = activationIndex(gatedDef);

  test('active when the array sibling includes one of the trigger values', () => {
    expect(
      isActiveByName('dietaryNotes', index, { workshops: ['photo', 'music'] }),
    ).toBe(true);
  });

  test('inactive when the array excludes every trigger, is empty, or absent', () => {
    expect(isActiveByName('dietaryNotes', index, { workshops: ['photo'] })).toBe(
      false,
    );
    expect(isActiveByName('dietaryNotes', index, { workshops: [] })).toBe(false);
    expect(isActiveByName('dietaryNotes', index, {})).toBe(false);
  });
});

describe('isActiveByName — checkboxChecked', () => {
  const index = activationIndex(gatedDef);

  test('active only when the checkbox sibling is the decoded boolean true', () => {
    expect(isActiveByName('guestName', index, { bringingGuest: true })).toBe(
      true,
    );
  });

  test('inactive when false, absent, or the raw "on"/"true" string', () => {
    expect(isActiveByName('guestName', index, { bringingGuest: false })).toBe(
      false,
    );
    expect(isActiveByName('guestName', index, {})).toBe(false);
    // checkboxBoolean decodes to a real boolean — a raw token never activates.
    expect(isActiveByName('guestName', index, { bringingGuest: 'on' })).toBe(
      false,
    );
  });
});
