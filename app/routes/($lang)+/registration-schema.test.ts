import { describe, expect, it } from 'bun:test';
import { Result } from 'effect';

import { formatSchemaResult, parseSchema } from '~/lib/effect/form-schema';

import { RegistrationSchema } from './registration-schema';

/** A minimal valid attendee payload as the form submits it (all strings). */
const attendee = (overrides: Record<string, unknown> = {}) => ({
  type: 'attendee',
  name: 'Ada',
  email: 'ada@example.com',
  phone: '555-0100',
  dateOfBirth: '2000-01-01',
  gender: 'female',
  meals: 'true',
  outreach: ['laws-of-health'],
  extra: {
    howDidYouHear: 'friend',
    whyAreYouAttending: 'growth',
    whatAreYouExcitedAbout: 'seminars',
    firstTimeAttending: 'false',
    merch: ['t-shirt'],
    other: '',
    tos: 'true',
  },
  volunteer: {
    // unchecked volunteer boxes submit nothing; checked ones submit "on".
    songLeader: 'on',
  },
  ...overrides,
});

describe('RegistrationSchema (form-data codec)', () => {
  it('decodes a valid attendee, coercing string booleans', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [attendee()],
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const r = result.success.registrants[0];
      expect(r?.type).toBe('attendee');
      if (r?.type === 'attendee') {
        // radio "true"/"false" → boolean
        expect(r.meals).toBe(true);
        expect(r.extra.firstTimeAttending).toBe(false);
        expect(r.extra.tos).toBe(true);
        // attribute-less checkbox submits "on" → boolean true
        expect(r.volunteer.songLeader).toBe(true);
        // unchecked volunteer flags are absent (valid, undefined)
        expect(r.volunteer.musician).toBeUndefined();
      }
    }
  });

  it('decodes a valid exhibitor', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [
        {
          type: 'exhibitor',
          name: 'Acme',
          email: 'sales@acme.com',
          phone: '555-0101',
          synopsis: 'We sell things',
          website: 'https://acme.com',
          company: 'Acme Inc',
        },
      ],
    });

    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects an invalid email with a nested-array conform field name', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [attendee({ email: 'not-an-email' })],
    });

    const formatted = formatSchemaResult(result);
    expect(formatted).not.toBeNull();
    // bracket-notation conform name, never dotted `registrants.0.email`.
    expect(formatted?.fieldErrors?.['registrants[0].email']).toEqual([
      'registration.form.email.error',
    ]);
    expect(formatted?.fieldErrors?.['registrants.0.email']).toBeUndefined();
  });

  it('rejects an exhibitor with an unparseable website url', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [
        {
          type: 'exhibitor',
          name: 'Acme',
          email: 'sales@acme.com',
          phone: '555-0101',
          synopsis: 'We sell things',
          website: 'not a url',
          company: 'Acme Inc',
        },
      ],
    });

    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['registrants[0].website']).toEqual([
      'registration.form.website.required',
    ]);
  });
});
