import { describe, expect, it } from 'bun:test';
import { Result } from 'effect';

import { formatSchemaResult, parseSchema } from '~/lib/effect/form-schema';
import {
  expectFieldError,
  expectOnlyTranslationKeys,
} from '~/lib/effect/form-schema.test-helper';

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
        // `extra`/`volunteer` are optional on the unified registrant struct;
        // a valid attendee always supplies them.
        expect(r.extra?.firstTimeAttending).toBe(false);
        expect(r.extra?.tos).toBe(true);
        // attribute-less checkbox submits "on" → boolean true
        expect(r.volunteer?.songLeader).toBe(true);
        // unchecked volunteer flags are absent (valid, undefined)
        expect(r.volunteer?.musician).toBeUndefined();
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

  // The `type` discriminator was a `Schema.Union([Attendee, Exhibitor])` whose
  // node-level message attached to the `registrants[0]` array element, never to
  // the `registrants[0].type` field the UI's RadioGroup renders — so the key
  // never displayed. The unified struct attributes it to the `type` field.
  it('attaches the type key at registrants[0].type when type is missing', () => {
    expectFieldError(
      RegistrationSchema,
      { registrants: [{ name: 'Ada', email: 'a@b.co', phone: '555' }] },
      'registrants[0].type',
      ['registration.form.type.required'],
    );
  });

  it('attaches the type key at registrants[0].type when type is off-list', () => {
    expectFieldError(
      RegistrationSchema,
      {
        registrants: [
          { type: 'bogus', name: 'Ada', email: 'a@b.co', phone: '555' },
        ],
      },
      'registrants[0].type',
      ['registration.form.type.required'],
    );
  });

  it('does not attach the type key to the bare registrants[0] element', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [{ name: 'Ada', email: 'a@b.co', phone: '555' }],
    });
    const formatted = formatSchemaResult(result);
    // Regression guard: the key must NOT land on the array element (where the
    // UI renders no FieldErrors), only on `registrants[0].type`.
    expect(formatted?.fieldErrors?.['registrants[0]']).toBeUndefined();
    expect(formatted?.formErrors).toEqual([]);
  });

  // Cross-variant leakage: an attendee must not be asked for exhibitor-only
  // fields (company/synopsis/website), and an exhibitor must not be asked for
  // attendee-only fields (gender/meals/outreach/dateOfBirth/extra). The filter
  // gates every per-type requirement on the discriminator.
  it('requires exhibitor-only fields at their paths, not attendee fields', () => {
    const result = parseSchema(RegistrationSchema, {
      registrants: [{ type: 'exhibitor', name: 'Acme', email: 'a@b.co', phone: '555' }],
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['registrants[0].synopsis']).toEqual([
      'registration.form.synopsis.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants[0].website']).toEqual([
      'registration.form.website.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants[0].company']).toEqual([
      'registration.form.company.required',
    ]);
    // Attendee-only requirements must NOT leak onto an exhibitor.
    expect(formatted?.fieldErrors?.['registrants[0].gender']).toBeUndefined();
    expect(formatted?.fieldErrors?.['registrants[0].meals']).toBeUndefined();
    expect(formatted?.fieldErrors?.['registrants[0].outreach']).toBeUndefined();
    expect(
      formatted?.fieldErrors?.['registrants[0].dateOfBirth'],
    ).toBeUndefined();
  });

  it('requires attendee-only fields at their paths, not exhibitor fields', () => {
    // A bare attendee (only shared fields supplied) is missing every
    // attendee-only requirement.
    const result = parseSchema(RegistrationSchema, {
      registrants: [{ type: 'attendee', name: 'Ada', email: 'a@b.co', phone: '555' }],
    });
    const formatted = formatSchemaResult(result);
    expect(formatted?.fieldErrors?.['registrants[0].dateOfBirth']).toEqual([
      'registration.form.date-of-birth.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants[0].gender']).toEqual([
      'registration.form.gender.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants[0].meals']).toEqual([
      'registration.form.meals.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants[0].outreach']).toEqual([
      'registration.form.outreach.required',
    ]);
    // Absent `extra` group surfaces a real key at a nested path (not `Missing key`).
    expect(formatted?.fieldErrors?.['registrants[0].extra.tos']).toEqual([
      'registration.form.tos.required',
    ]);
    // Exhibitor-only requirements must NOT leak onto an attendee.
    expect(formatted?.fieldErrors?.['registrants[0].synopsis']).toBeUndefined();
    expect(formatted?.fieldErrors?.['registrants[0].website']).toBeUndefined();
    expect(formatted?.fieldErrors?.['registrants[0].company']).toBeUndefined();
  });

  // When an attendee's `extra` group IS present but a required sub-field is
  // empty, the inner annotation fires at its own nested path.
  it('attaches nested extra sub-field keys at their nested paths', () => {
    expectFieldError(
      RegistrationSchema,
      { registrants: [attendee({ extra: { ...attendee().extra, tos: undefined } })] },
      'registrants[0].extra.tos',
      ['registration.form.tos.required'],
    );
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

  // Guards against emitting a message that `FieldErrors` would render as
  // `undefined`: every validation message must be a real `en` translation key,
  // on BOTH the server and client paths (the upgraded guard checks each).
  // Covers the missing/off-list discriminator, invalid-type (array),
  // pattern/url checks, the per-type filter requirements (bare attendee/
  // exhibitor), missing required literals/booleans, and a bad literal member.
  it('only ever emits real translation keys for representative failures', () => {
    expectOnlyTranslationKeys(RegistrationSchema, [
      {}, // registrants field missing
      { registrants: [{}] }, // empty registrant: missing discriminator
      // off-list `type` discriminator
      { registrants: [{ type: 'bogus', name: 'Ada', email: 'a@b.co' }] },
      // bare attendee: every attendee-only filter requirement fires
      { registrants: [{ type: 'attendee', name: 'Ada', email: 'a@b.co', phone: '555' }] },
      // bare exhibitor: every exhibitor-only filter requirement fires
      { registrants: [{ type: 'exhibitor', name: 'Acme', email: 'a@b.co', phone: '555' }] },
      // duplicate `name` field POSTs an array → invalid-type
      { registrants: [attendee({ name: ['a', 'b'] })] },
      { registrants: [attendee({ email: 'not-an-email' })] }, // pattern check
      // exhibitor with an unparseable website url
      {
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
      },
      // attendee missing tos / meals / gender (absent required fields)
      {
        registrants: [
          attendee({
            gender: undefined,
            meals: undefined,
            extra: {
              howDidYouHear: 'friend',
              whyAreYouAttending: 'growth',
              whatAreYouExcitedAbout: 'seminars',
              firstTimeAttending: 'false',
              merch: ['t-shirt'],
              other: '',
              // tos absent
            },
          }),
        ],
      },
      // attendee with a bogus outreach member
      { registrants: [attendee({ outreach: ['bogus'] })] },
    ]);
  });
});
