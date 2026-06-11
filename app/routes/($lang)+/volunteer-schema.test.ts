import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';

import { formatSchemaResult, parseSchema } from '~/lib/effect/form-schema';
import { root } from '~/lib/localization/translations';

import { schema } from './volunteer';

const isTranslationKey = (key: string): boolean => key in root.en;

/** A minimal valid email-method payload as the form submits it (all strings). */
const valid = (overrides: Record<string, unknown> = {}) => ({
  method: 'email',
  name: 'Ada',
  email: 'ada@example.com',
  age: '30',
  location: 'Toronto',
  background: 'engineer',
  why: 'to help',
  ...overrides,
});

/** Issue messages the client Standard Schema reports for a payload. */
const clientMessages = (payload: unknown): string[] => {
  const std = Schema.toStandardSchemaV1(schema);
  const result = std['~standard'].validate(payload) as {
    issues?: ReadonlyArray<{ message: string }>;
  };
  return (result.issues ?? []).map((i) => i.message);
};

describe('volunteer schema (discriminated method)', () => {
  it('decodes a valid email-method payload (positions defaults to [])', () => {
    const result = parseSchema(schema, valid());
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.positions).toEqual([]);
    }
  });

  it('attaches the method translation key when method is missing (server)', () => {
    const result = parseSchema(schema, {
      name: 'Ada',
      email: 'ada@example.com',
      age: '30',
      location: 'Toronto',
      background: 'engineer',
      why: 'to help',
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['method']).toEqual([
      'volunteer.form.method.required',
    ]);
    expect(formatted?.formErrors).toEqual([]);
  });

  it('attaches the method translation key when method is invalid (server)', () => {
    const result = parseSchema(schema, valid({ method: 'bogus' }));
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['method']).toEqual([
      'volunteer.form.method.required',
    ]);
    expect(formatted?.formErrors).toEqual([]);
  });

  it('attaches the method translation key when method is missing (client)', () => {
    expect(
      clientMessages({
        name: 'Ada',
        email: 'ada@example.com',
        age: '30',
        location: 'Toronto',
        background: 'engineer',
        why: 'to help',
      }),
    ).toContain('volunteer.form.method.required');
  });

  it('attaches the method translation key when method is invalid (client)', () => {
    expect(clientMessages(valid({ method: 'bogus' }))).toContain(
      'volunteer.form.method.required',
    );
  });

  // A duplicate field name in the POST body yields an array value for that one
  // field. Each invalid-type message must be a REAL translation key (rendered via
  // `translate()`); fields without a `.error` key fall back to `.required`.
  it.each([
    ['name', 'volunteer.form.name.required'],
    ['age', 'volunteer.form.age.required'],
    ['location', 'volunteer.form.location.required'],
    ['background', 'volunteer.form.background.required'],
    ['why', 'volunteer.form.why.required'],
    ['email', 'volunteer.form.email.error'],
    ['phone', 'volunteer.form.phone.required'],
  ])('surfaces a real translation key when %s is an array', (field, key) => {
    const result = parseSchema(schema, valid({ method: 'both', [field]: ['a', 'b'] }));
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.[field]).toEqual([key]);
  });

  // Guards against emitting a message that `FieldErrors` would render as
  // `undefined`: every validation message must be a real `en` translation key.
  it('only ever emits real translation keys for representative failures', () => {
    const payloads: unknown[] = [
      {}, // everything missing
      valid({ method: 'bogus' }),
      valid({ method: 'both', email: undefined, phone: undefined }),
      valid({ name: ['a', 'b'] }),
      valid({ method: 'both', age: ['a', 'b'] }),
      valid({ method: 'both', location: ['a', 'b'] }),
      valid({ method: 'both', background: ['a', 'b'] }),
      valid({ method: 'both', why: ['a', 'b'] }),
      valid({ method: 'both', phone: ['a', 'b'] }),
    ];
    for (const payload of payloads) {
      const formatted = formatSchemaResult(parseSchema(schema, payload));
      const messages = [
        ...(formatted?.formErrors ?? []),
        ...Object.values(formatted?.fieldErrors ?? {}).flat(),
      ];
      for (const message of messages) {
        expect({ message, isKey: isTranslationKey(message) }).toEqual({
          message,
          isKey: true,
        });
      }
    }
  });

  it('requires email/phone at their field paths when method needs them', () => {
    const result = parseSchema(schema, {
      method: 'both',
      name: 'Ada',
      age: '30',
      location: 'Toronto',
      background: 'engineer',
      why: 'to help',
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['email']).toEqual([
      'volunteer.form.email.required',
    ]);
    expect(formatted?.fieldErrors?.['phone']).toEqual([
      'volunteer.form.phone.required',
    ]);
  });
});
