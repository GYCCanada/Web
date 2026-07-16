import { describe, expect, test } from 'bun:test';
import { DateTime, Result, Schema } from 'effect';

import { compileForm } from './compiled-form';
import { FormDefinition } from './definition';
import { Cents } from './pricing';

const text = (value: string) => ({ en: value, fr: value });

const rawDefinition = (base = 5_000) => ({
  title: text('Registration'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name'),
      requiredMessage: 'registration.form.name.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: text('Email'),
      requiredMessage: 'registration.form.email.required',
      invalidMessage: 'registration.form.email.error',
    },
    {
      _tag: 'literal',
      name: 'ticket',
      label: text('Ticket'),
      requiredMessage: 'registration.form.type.required',
      options: [{ value: 'adult', label: text('Adult') }],
    },
  ],
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
    base,
    registrationClosesAt: '2026-08-10T04:00:00.000Z',
    rules: [
      {
        _tag: 'choice',
        field: 'ticket',
        prices: [{ option: 'adult', amount: 1_000 }],
      },
    ],
    windows: [],
  },
});

const definition = (base = 5_000) =>
  Schema.decodeUnknownSync(FormDefinition)(rawDefinition(base));

const at = (iso: string): DateTime.Utc => DateTime.makeUnsafe(Date.parse(iso));

const registrant = (name: string, email: string) => ({
  name,
  email,
  ticket: 'adult',
});

describe('compiled registration shell', () => {
  test('group billing accepts a nominated non-attendee payer', () => {
    const compiled = compileForm(definition());
    const decoded = compiled.decodeRegistration({
      party: {
        _tag: 'group',
        payer: { name: 'Treasurer', email: 'payer@example.com' },
      },
      registrants: [registrant('Ada', ''), registrant('Grace', 'g@example.com')],
    });

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded) && 'party' in decoded.success) {
      expect(decoded.success.party).toEqual({
        _tag: 'group',
        payer: { name: 'Treasurer', email: 'payer@example.com' },
      });
      expect(decoded.success.registrants[0]?.['email']).toBeUndefined();
    }
  });

  test('per-registrant billing requires every email and forbids a payer', () => {
    const compiled = compileForm(definition());
    const valid = compiled.decodeRegistration({
      party: { _tag: 'perRegistrant' },
      registrants: [registrant('Ada', 'ada@example.com')],
    });
    const missingEmail = compiled.decodeRegistration({
      party: { _tag: 'perRegistrant' },
      registrants: [registrant('Ada', '')],
    });
    const smuggledPayer = compiled.decodeRegistration({
      party: {
        _tag: 'perRegistrant',
        payer: { name: 'Treasurer', email: 'payer@example.com' },
      },
      registrants: [registrant('Ada', 'ada@example.com')],
    });

    expect(Result.isSuccess(valid)).toBe(true);
    expect(Result.isFailure(missingEmail)).toBe(true);
    expect(Result.isFailure(smuggledPayer)).toBe(true);
  });

  test('rejects empty parties and off-list billing modes', () => {
    const compiled = compileForm(definition());
    expect(
      Result.isFailure(
        compiled.decodeRegistration({
          party: { _tag: 'group', payer: registrant('Pay', 'p@example.com') },
          registrants: [],
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        compiled.decodeRegistration({
          party: { _tag: 'invoice' },
          registrants: [registrant('Ada', 'ada@example.com')],
        }),
      ),
    ).toBe(true);
  });
});

describe('compiled registration quotes', () => {
  test('creates one atomic group order at a single pricing instant', () => {
    const compiled = compileForm(definition());
    const decoded = compiled.decodeRegistration({
      party: {
        _tag: 'group',
        payer: { name: 'Treasurer', email: 'payer@example.com' },
      },
      registrants: [registrant('Ada', ''), registrant('Grace', 'g@example.com')],
    });
    if (Result.isFailure(decoded)) throw new Error('fixture did not decode');

    const result = compiled.quoteRegistration(
      decoded.success,
      at('2026-08-01T12:00:00.000Z'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.mode).toBe('group');
    expect(result.quote.orders).toEqual([
      {
        _tag: 'group',
        amount: Cents.make(12_000),
        receiptEmail: 'payer@example.com',
      },
    ]);
    expect(result.quote.total).toBe(Cents.make(12_000));
    expect(DateTime.formatIso(result.quote.expiresAt)).toBe(
      '2026-08-02T12:00:00.000Z',
    );
  });

  test('creates independent per-registrant orders and keeps zero-dollar orders', () => {
    const compiled = compileForm(definition(0));
    const decoded = compiled.decodeRegistration({
      party: { _tag: 'perRegistrant' },
      registrants: [
        registrant('Ada', 'ada@example.com'),
        registrant('Grace', 'grace@example.com'),
      ],
    });
    if (Result.isFailure(decoded)) throw new Error('fixture did not decode');

    const result = compiled.quoteRegistration(
      decoded.success,
      at('2026-08-01T12:00:00.000Z'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.orders).toHaveLength(2);
    expect(result.quote.orders.map((order) => order.amount)).toEqual([
      Cents.make(1_000),
      Cents.make(1_000),
    ]);

    const freeDefinition = rawDefinition(0);
    freeDefinition.pricing.rules = [];
    const free = compileForm(
      Schema.decodeUnknownSync(FormDefinition)(freeDefinition),
    );
    const freeDecoded = free.decodeRegistration({
      party: { _tag: 'perRegistrant' },
      registrants: [registrant('Ada', 'ada@example.com')],
    });
    if (Result.isFailure(freeDecoded)) throw new Error('fixture did not decode');
    const freeQuote = free.quoteRegistration(
      freeDecoded.success,
      at('2026-08-01T12:00:00.000Z'),
    );
    expect(freeQuote.ok).toBe(true);
    if (freeQuote.ok) {
      expect(freeQuote.quote.orders).toHaveLength(1);
      expect(freeQuote.quote.orders[0]?.amount).toBe(Cents.make(0));
    }
  });

  test('caps quote expiry at the deadline and refuses pricing at the deadline', () => {
    const compiled = compileForm(definition());
    const decoded = compiled.decodeRegistration({
      party: { _tag: 'perRegistrant' },
      registrants: [registrant('Ada', 'ada@example.com')],
    });
    if (Result.isFailure(decoded)) throw new Error('fixture did not decode');

    const before = compiled.quoteRegistration(
      decoded.success,
      at('2026-08-09T12:00:00.000Z'),
    );
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(DateTime.formatIso(before.quote.expiresAt)).toBe(
        '2026-08-10T04:00:00.000Z',
      );
    }
    const closed = compiled.quoteRegistration(
      decoded.success,
      at('2026-08-10T04:00:00.000Z'),
    );
    expect(closed).toEqual({
      ok: false,
      issues: [
        {
          code: 'registration-closed',
          message: 'The registration deadline has passed.',
        },
      ],
    });
  });

  test('reports missing commerce configuration before opening', () => {
    const legacy = Schema.decodeUnknownSync(FormDefinition)({
      title: text('Legacy registration'),
      fields: [],
    });
    expect(
      compileForm(legacy).readiness(at('2026-08-01T12:00:00.000Z')),
    ).toEqual([
      {
        code: 'registration-party-missing',
        message: 'Registration billing modes are not configured.',
      },
      {
        code: 'registration-pricing-missing',
        message: 'Registration pricing and its deadline are not configured.',
      },
    ]);
  });
});
