import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';

import { formatSchemaResult, parseSchema } from '~/lib/effect/form-schema';
import { root } from '~/lib/localization/translations';

import { schema } from './contact';

const isTranslationKey = (key: string): boolean => key in root.en;

/** A minimal valid email-method payload as the form submits it (all strings). */
const valid = (overrides: Record<string, unknown> = {}) => ({
  method: 'email',
  name: 'Ada',
  email: 'ada@example.com',
  message: 'hello',
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

describe('contact schema (discriminated method)', () => {
  it('decodes a valid email-method payload', () => {
    const result = parseSchema(schema, valid());
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('attaches the method translation key when method is missing (server)', () => {
    const result = parseSchema(schema, {
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hello',
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['method']).toEqual([
      'contact.form.contact-method.required',
    ]);
    expect(formatted?.formErrors).toEqual([]);
  });

  it('attaches the method translation key when method is invalid (server)', () => {
    const result = parseSchema(schema, valid({ method: 'bogus' }));
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['method']).toEqual([
      'contact.form.contact-method.required',
    ]);
    expect(formatted?.formErrors).toEqual([]);
  });

  it('attaches the method translation key when method is missing (client)', () => {
    expect(
      clientMessages({
        name: 'Ada',
        email: 'ada@example.com',
        message: 'hello',
      }),
    ).toContain('contact.form.contact-method.required');
  });

  it('attaches the method translation key when method is invalid (client)', () => {
    expect(clientMessages(valid({ method: 'bogus' }))).toContain(
      'contact.form.contact-method.required',
    );
  });

  // A duplicate field name in the POST body yields an array value for that one
  // field. Each invalid-type message must be a REAL translation key (rendered via
  // `translate()`); fields without a `.error` key fall back to `.required`.
  it.each([
    ['name', 'contact.form.name.error'],
    ['email', 'contact.form.email.error'],
    ['message', 'contact.form.message.required'],
    ['phone', 'contact.form.phone.required'],
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
      valid({ method: 'both', message: ['a', 'b'] }),
      valid({ method: 'both', phone: ['a', 'b'] }),
      valid({ email: 'not-an-email' }),
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

  it('requires email at the email path when method needs it', () => {
    const result = parseSchema(schema, {
      method: 'both',
      name: 'Ada',
      message: 'hello',
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['email']).toEqual([
      'contact.form.email.required',
    ]);
    expect(formatted?.fieldErrors?.['phone']).toEqual([
      'contact.form.phone.required',
    ]);
  });
});
