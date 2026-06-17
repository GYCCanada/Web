import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { formatSchemaResult } from '~/lib/effect/form-schema';

import { decodeForm } from './decode';
import type { FormDefinition } from './definition';
import { FormDefinition as FormDefinitionSchema } from './definition';

/**
 * Branch 6.2 — the generic decoder.
 *
 * The decoder compiles a `FormDefinition` into the Effect Schema codec that
 * validates its submissions, reproducing the hand-tuned contact/volunteer/
 * registration validation (`contact.tsx`, `registration-schema.ts`). These tests
 * pin the load-bearing guarantees the equivalence harness (Branch 6.5) will lean
 * on (`prove-it-works`):
 *   - each `FieldKind` decodes its valid form-input value and rejects its invalid
 *     ones with a real `TranslationKey` (not a default Schema message);
 *   - failures attach to the FIELD path conform renders (`formatSchemaResult`
 *     buckets them by `formatPath`), so an error displays on its own field;
 *   - the `checkboxBoolean` three-token codec (`true` / `false` / `on`) matches
 *     `registration-schema.ts`'s `StringToBoolean`;
 *   - a discriminated `variant` requires the selected branch's fields at their own
 *     paths and ignores the unselected branch's;
 *   - a `requiredWhenEquals` cross-field rule fires its `target` requirement only
 *     when the `when` field equals a trigger value, at the target's path.
 *
 * Definitions are built from raw JSON (the on-bucket shape) and decoded through
 * the `FormDefinition` schema first, so the decoder is exercised on the same
 * branded values a real `forms/<form>.json` produces.
 */

const text = (en: string, fr: string) => ({ en, fr });

/** Decode a raw JSON definition through the schema (as `Content.getForm` would). */
const asDefinition = (json: unknown): FormDefinition =>
  Schema.decodeUnknownSync(FormDefinitionSchema)(json);

/** The field/form error buckets for a payload, or `null` when it decodes. */
const errorsFor = (
  definition: FormDefinition,
  payload: unknown,
): { formErrors: string[]; fieldErrors: Record<string, string[]> } | null => {
  const result = decodeForm(definition, payload);
  return formatSchemaResult(result) as never;
};

const requiredTextDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name', 'Nom'),
      requiredMessage: 'contact.form.name.required',
    },
  ],
});

describe('requiredText', () => {
  test('a non-empty value decodes', () => {
    const result = decodeForm(requiredTextDef, { name: 'Ada' });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success['name']).toBe('Ada');
  });

  test('empty / absent / array all emit the required key on the field', () => {
    for (const payload of [{ name: '' }, {}, { name: ['a', 'b'] }]) {
      const errors = errorsFor(requiredTextDef, payload);
      expect(errors?.fieldErrors['name']).toEqual(['contact.form.name.required']);
    }
  });
});

const optionalTextDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'optionalText',
      name: 'other',
      label: text('Other', 'Autre'),
      invalidMessage: 'registration.form.other.required',
    },
  ],
});

describe('optionalText', () => {
  test('empty and absent are both valid', () => {
    expect(Result.isSuccess(decodeForm(optionalTextDef, { other: '' }))).toBe(
      true,
    );
    expect(Result.isSuccess(decodeForm(optionalTextDef, {}))).toBe(true);
  });

  test('a present non-string emits the invalid key', () => {
    const errors = errorsFor(optionalTextDef, { other: ['x'] });
    expect(errors?.fieldErrors['other']).toEqual([
      'registration.form.other.required',
    ]);
  });
});

const emailDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
  ],
});

describe('email', () => {
  test('a well-formed address decodes', () => {
    expect(
      Result.isSuccess(decodeForm(emailDef, { email: 'a@b.co' })),
    ).toBe(true);
  });

  test('empty emits the required key, malformed emits the invalid key', () => {
    expect(errorsFor(emailDef, { email: '' })?.fieldErrors['email']).toEqual([
      'contact.form.email.required',
    ]);
    expect(
      errorsFor(emailDef, { email: 'not-an-email' })?.fieldErrors['email'],
    ).toEqual(['contact.form.email.error']);
  });
});

const urlDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'url',
      name: 'website',
      label: text('Website', 'Site'),
      requiredMessage: 'registration.form.website.required',
      invalidMessage: 'registration.form.website.required',
    },
  ],
});

describe('url', () => {
  test('a parseable absolute URL decodes', () => {
    expect(
      Result.isSuccess(decodeForm(urlDef, { website: 'https://gyccanada.org' })),
    ).toBe(true);
  });

  test('an unparseable value emits the invalid key', () => {
    expect(
      errorsFor(urlDef, { website: 'not a url' })?.fieldErrors['website'],
    ).toEqual(['registration.form.website.required']);
  });
});

const literalDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'literal',
      name: 'gender',
      label: text('Gender', 'Genre'),
      requiredMessage: 'registration.form.gender.required',
      options: [
        { value: 'male', label: text('Male', 'Homme') },
        { value: 'female', label: text('Female', 'Femme') },
      ],
    },
  ],
});

describe('literal', () => {
  test('an on-list value decodes', () => {
    const result = decodeForm(literalDef, { gender: 'female' });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success['gender']).toBe('female');
  });

  test('an off-list / absent value emits the required key', () => {
    expect(
      errorsFor(literalDef, { gender: 'other' })?.fieldErrors['gender'],
    ).toEqual(['registration.form.gender.required']);
    expect(errorsFor(literalDef, {})?.fieldErrors['gender']).toEqual([
      'registration.form.gender.required',
    ]);
  });
});

const checkboxDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'checkboxBoolean',
      name: 'tos',
      label: text('Accept', 'Accepter'),
      requiredMessage: 'registration.form.tos.required',
    },
    {
      _tag: 'checkboxBoolean',
      name: 'songLeader',
      label: text('Song leader', 'Chef'),
      optional: true,
      requiredMessage: 'registration.form.volunteer.required',
    },
  ],
});

describe('checkboxBoolean (the true/false/on three-token codec)', () => {
  test('"true" and "on" decode to true, "false" decodes to false', () => {
    const t = decodeForm(checkboxDef, { tos: 'true', songLeader: 'on' });
    expect(Result.isSuccess(t)).toBe(true);
    if (Result.isSuccess(t)) {
      expect(t.success['tos']).toBe(true);
      expect(t.success['songLeader']).toBe(true);
    }
    const f = decodeForm(checkboxDef, { tos: 'false' });
    expect(Result.isSuccess(f)).toBe(true);
    if (Result.isSuccess(f)) expect(f.success['tos']).toBe(false);
  });

  test('a required checkbox absent emits the required key; an optional one absent is valid', () => {
    const errors = errorsFor(checkboxDef, {});
    expect(errors?.fieldErrors['tos']).toEqual([
      'registration.form.tos.required',
    ]);
    expect(errors?.fieldErrors['songLeader']).toBeUndefined();
  });

  test('an off-token value emits the required key', () => {
    expect(
      errorsFor(checkboxDef, { tos: 'maybe' })?.fieldErrors['tos'],
    ).toEqual(['registration.form.tos.required']);
  });
});

const arrayDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'arrayOfLiteral',
      name: 'merch',
      label: text('Merch', 'Articles'),
      requiredMessage: 'registration.form.merch.required',
      options: [
        { value: 't-shirt', label: text('Tee', 'Tee') },
        { value: 'hoodie', label: text('Hoodie', 'Pull') },
      ],
    },
  ],
});

describe('arrayOfLiteral', () => {
  test('an all-on-list array decodes', () => {
    const result = decodeForm(arrayDef, { merch: ['t-shirt', 'hoodie'] });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result))
      expect(result.success['merch']).toEqual(['t-shirt', 'hoodie']);
  });

  test('an off-list element emits the required key on the element path', () => {
    const errors = errorsFor(arrayDef, { merch: ['t-shirt', 'cap'] });
    // The bad element is at index 1.
    expect(errors?.fieldErrors['merch[1]']).toEqual([
      'registration.form.merch.required',
    ]);
  });
});

const groupDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'nestedGroup',
      name: 'parent',
      label: text('Parent', 'Parent'),
      fields: [
        {
          _tag: 'requiredText',
          name: 'parentName',
          label: text('Parent name', 'Nom'),
          requiredMessage: 'registration.form.parent.required',
        },
      ],
    },
  ],
});

describe('nestedGroup', () => {
  test('a present group with valid inner fields decodes nested', () => {
    const result = decodeForm(groupDef, { parent: { parentName: 'Eve' } });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result))
      expect(result.success['parent']).toEqual({ parentName: 'Eve' });
  });

  test('a missing inner required field emits its key on the nested path', () => {
    const errors = errorsFor(groupDef, { parent: { parentName: '' } });
    expect(errors?.fieldErrors['parent.parentName']).toEqual([
      'registration.form.parent.required',
    ]);
  });
});

const variantDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name', 'Nom'),
      requiredMessage: 'registration.form.name.required',
    },
  ],
  variant: {
    discriminator: 'type',
    requiredMessage: 'registration.form.type.required',
    options: [
      { value: 'attendee', label: text('Attendee', 'Participant') },
      { value: 'exhibitor', label: text('Exhibitor', 'Exposant') },
    ],
    variants: [
      {
        value: 'attendee',
        label: text('Attendee', 'Participant'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'dateOfBirth',
            label: text('DOB', 'DOB'),
            requiredMessage: 'registration.form.date-of-birth.required',
          },
        ],
      },
      {
        value: 'exhibitor',
        label: text('Exhibitor', 'Exposant'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'company',
            label: text('Company', 'Entreprise'),
            requiredMessage: 'registration.form.company.required',
          },
        ],
      },
    ],
  },
});

describe('variant (discriminated-union presence)', () => {
  test('the selected branch requires its fields; the other branch is ignored', () => {
    // attendee selected, dateOfBirth missing → its key fires; company NOT demanded
    const attendee = errorsFor(variantDef, { name: 'Ada', type: 'attendee' });
    expect(attendee?.fieldErrors['dateOfBirth']).toEqual([
      'registration.form.date-of-birth.required',
    ]);
    expect(attendee?.fieldErrors['company']).toBeUndefined();

    // exhibitor selected, company missing → its key fires; dateOfBirth NOT demanded
    const exhibitor = errorsFor(variantDef, { name: 'Ada', type: 'exhibitor' });
    expect(exhibitor?.fieldErrors['company']).toEqual([
      'registration.form.company.required',
    ]);
    expect(exhibitor?.fieldErrors['dateOfBirth']).toBeUndefined();
  });

  test('a complete attendee decodes', () => {
    expect(
      Result.isSuccess(
        decodeForm(variantDef, {
          name: 'Ada',
          type: 'attendee',
          dateOfBirth: '2000-01-01',
        }),
      ),
    ).toBe(true);
  });

  test('an absent / off-list discriminator emits the discriminator key', () => {
    expect(
      errorsFor(variantDef, { name: 'Ada' })?.fieldErrors['type'],
    ).toEqual(['registration.form.type.required']);
    expect(
      errorsFor(variantDef, { name: 'Ada', type: 'speaker' })?.fieldErrors[
        'type'
      ],
    ).toEqual(['registration.form.type.required']);
  });
});

const ruleDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'literal',
      name: 'method',
      label: text('Method', 'Méthode'),
      requiredMessage: 'contact.form.contact-method.required',
      options: [
        { value: 'email', label: text('Email', 'Courriel') },
        { value: 'phone', label: text('Phone', 'Tél') },
        { value: 'both', label: text('Both', 'Les deux') },
      ],
    },
    {
      _tag: 'optionalText',
      name: 'email',
      label: text('Email', 'Courriel'),
      invalidMessage: 'contact.form.email.error',
    },
  ],
  rules: [
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['email', 'both'],
      target: 'email',
      message: 'contact.form.email.required',
    },
  ],
});

describe('requiredWhenEquals cross-field rule', () => {
  test('the target is required when the trigger field equals a trigger value', () => {
    const errors = errorsFor(ruleDef, { method: 'email' });
    expect(errors?.fieldErrors['email']).toEqual([
      'contact.form.email.required',
    ]);
  });

  test('the target is not required when the trigger field does not match', () => {
    expect(
      Result.isSuccess(decodeForm(ruleDef, { method: 'phone' })),
    ).toBe(true);
  });

  test('a present target with the trigger active decodes', () => {
    expect(
      Result.isSuccess(
        decodeForm(ruleDef, { method: 'both', email: 'a@b.co' }),
      ),
    ).toBe(true);
  });
});
