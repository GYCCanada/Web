import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';

import { FormDefinition } from './definition';
import { priceGroup, priceRegistrant } from './price';
import { Cents } from './pricing';

const text = (en: string, fr: string) => ({ en, fr });

const definition = Schema.decodeUnknownSync(FormDefinition)({
  title: text('Registration', 'Inscription'),
  fields: [
    {
      _tag: 'literal',
      name: 'ticket',
      label: text('Ticket', 'Billet'),
      requiredMessage: 'registration.form.type.required',
      options: [
        { value: 'adult', label: text('Adult', 'Adulte') },
        { value: 'student', label: text('Student', 'Étudiant') },
      ],
    },
    {
      _tag: 'arrayOfLiteral',
      name: 'extras',
      label: text('Extras', 'Extras'),
      requiredMessage: 'registration.form.merch.required',
      options: [
        { value: 'meal', label: text('Meal', 'Repas') },
        { value: 'shirt', label: text('Shirt', 'Chandail') },
      ],
    },
    {
      _tag: 'checkboxBoolean',
      name: 'donation',
      label: text('Donation', 'Don'),
      requiredMessage: 'registration.form.tos.required',
    },
    {
      _tag: 'number',
      name: 'guests',
      label: text('Guests', 'Invités'),
      min: 0,
      max: 10,
      requiredMessage: 'registration.form.gender.required',
      invalidMessage: 'registration.form.merch.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'literalEquals',
        when: 'ticket',
        equals: ['adult'],
      },
      target: 'guests',
    },
  ],
  pricing: {
    currency: 'cad',
    base: 5_000,
    registrationClosesAt: '2026-12-01T05:00:00.000Z',
    rules: [
      {
        _tag: 'choice',
        field: 'ticket',
        prices: [{ option: 'student', amount: 1_000 }],
      },
      {
        _tag: 'multiChoice',
        field: 'extras',
        prices: [
          { option: 'meal', amount: 1_500 },
          { option: 'shirt', amount: 2_000 },
        ],
      },
      { _tag: 'toggle', field: 'donation', amount: 500 },
      { _tag: 'quantity', field: 'guests', unit: 750, max: 4 },
    ],
    windows: [
      {
        id: 'abcdefghijklmnopqrstu',
        startsAt: '2026-01-01T05:00:00.000Z',
        endsAt: '2026-03-01T05:00:00.000Z',
        delta: -1_000,
      },
    ],
  },
});

const registrant = (overrides: Record<string, unknown> = {}) => ({
  ticket: 'adult',
  extras: [],
  donation: false,
  guests: 0,
  ...overrides,
});

describe('priceRegistrant', () => {
  test('folds every rule over decoded values', () => {
    expect(
      priceRegistrant(
        definition,
        registrant({
          extras: ['meal', 'shirt'],
          donation: true,
          guests: 3,
        }),
        Date.parse('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(Cents.make(11_250));
  });

  test('uses half-open exact windows and skips inactive prices', () => {
    expect(
      priceRegistrant(
        definition,
        registrant(),
        Date.parse('2026-01-01T05:00:00.000Z'),
      ),
    ).toBe(Cents.make(4_000));
    expect(
      priceRegistrant(
        definition,
        registrant({ ticket: 'student', guests: 4 }),
        Date.parse('2026-03-01T05:00:00.000Z'),
      ),
    ).toBe(Cents.make(6_000));
  });

  test('caps quantity pricing and group pricing shares one instant', () => {
    expect(
      priceRegistrant(
        definition,
        registrant({ guests: 9 }),
        Date.parse('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(Cents.make(8_000));
    expect(
      priceGroup(
        definition,
        [registrant(), registrant({ donation: true })],
        Date.parse('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(Cents.make(10_500));
  });
});
