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

// The registration email relaxation (registrar plan 2b.3 / C7a authoring half):
// the registration `email` instance flips to `optional: true` (optional-at-key,
// non-empty-WHEN-present). This is the decode-LEVEL contract C7a establishes —
// an ABSENT key is valid, but a PRESENT blank still rejects. The shell
// blank-drop that makes the real rendered `email: ''` payload pass in `group`
// (and the per-registrant re-imposition for `perRegistrant`) live in C7/C7.5;
// C7a alone makes *absent* valid, NOT *present-blank*.
const optionalEmailDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      optional: true,
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
  ],
});

describe('email (optional: true) — the C7a registrant relaxation', () => {
  test('an ABSENT email decodes valid (optional-at-key)', () => {
    expect(Result.isSuccess(decodeForm(optionalEmailDef, {}))).toBe(true);
  });

  test('a present blank STILL rejects with the required key (the shell drop is C7)', () => {
    expect(
      errorsFor(optionalEmailDef, { email: '' })?.fieldErrors['email'],
    ).toEqual(['contact.form.email.required']);
  });

  test('a present malformed value rejects with the invalid key', () => {
    expect(
      errorsFor(optionalEmailDef, { email: 'not-an-email' })?.fieldErrors[
        'email'
      ],
    ).toEqual(['contact.form.email.error']);
  });

  test('a present well-formed value decodes', () => {
    expect(
      Result.isSuccess(decodeForm(optionalEmailDef, { email: 'a@b.co' })),
    ).toBe(true);
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

// A selected variant branch carrying a `nestedGroup` (registration's attendee-
// only `extra` group): the WHOLE group can be omitted from the payload, and the
// engine must still demand it — surfacing a real key at the group's declared
// `presenceAnchor` inner field (registration's `extra` anchors at `tos`),
// mirroring the oracle's `['extra', 'tos']` requirement
// (`registration-schema.ts:268-279`). Without this, a selected attendee that
// omits `extra` would decode SUCCESS — a behaviour divergence.
const variantGroupDef = asDefinition({
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
            _tag: 'nestedGroup',
            name: 'extra',
            label: text('Extra', 'Extra'),
            presenceAnchor: 'tos',
            fields: [
              {
                _tag: 'requiredText',
                name: 'howDidYouHear',
                label: text('How', 'Comment'),
                requiredMessage:
                  'registration.form.how-did-you-hear.required',
              },
              {
                _tag: 'checkboxBoolean',
                name: 'tos',
                label: text('Accept', 'Accepter'),
                requiredMessage: 'registration.form.tos.required',
              },
            ],
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

describe('variant nestedGroup presence', () => {
  test('a selected branch with the whole group omitted emits a real key at the declared presenceAnchor', () => {
    const errors = errorsFor(variantGroupDef, { name: 'Ada', type: 'attendee' });
    // Anchored at `tos` (the declared `presenceAnchor`), matching the oracle's
    // `['extra','tos']` — NOT the group's first field (`howDidYouHear`).
    expect(errors?.fieldErrors['extra.tos']).toEqual([
      'registration.form.tos.required',
    ]);
    expect(errors?.fieldErrors['extra.howDidYouHear']).toBeUndefined();
  });

  test('without a presenceAnchor, an absent group falls back to the first presence-requirable inner field', () => {
    const noAnchorDef = asDefinition({
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
                _tag: 'nestedGroup',
                name: 'extra',
                label: text('Extra', 'Extra'),
                fields: [
                  {
                    _tag: 'requiredText',
                    name: 'howDidYouHear',
                    label: text('How', 'Comment'),
                    requiredMessage:
                      'registration.form.how-did-you-hear.required',
                  },
                  {
                    _tag: 'checkboxBoolean',
                    name: 'tos',
                    label: text('Accept', 'Accepter'),
                    requiredMessage: 'registration.form.tos.required',
                  },
                ],
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
    const errors = errorsFor(noAnchorDef, { name: 'Ada', type: 'attendee' });
    expect(errors?.fieldErrors['extra.howDidYouHear']).toEqual([
      'registration.form.how-did-you-hear.required',
    ]);
  });

  test('a present, valid group decodes', () => {
    expect(
      Result.isSuccess(
        decodeForm(variantGroupDef, {
          name: 'Ada',
          type: 'attendee',
          extra: { howDidYouHear: 'web', tos: 'true' },
        }),
      ),
    ).toBe(true);
  });

  test('a present group with a missing inner required field emits its key on the nested path', () => {
    const errors = errorsFor(variantGroupDef, {
      name: 'Ada',
      type: 'attendee',
      extra: { howDidYouHear: '', tos: 'true' },
    });
    expect(errors?.fieldErrors['extra.howDidYouHear']).toEqual([
      'registration.form.how-did-you-hear.required',
    ]);
  });

  test('the OTHER branch never demands the group', () => {
    expect(
      Result.isSuccess(
        decodeForm(variantGroupDef, {
          name: 'Ada',
          type: 'exhibitor',
          company: 'Acme',
        }),
      ),
    ).toBe(true);
  });
});

// Mirrors contact/volunteer: the `method`-gated `email`/`phone` are
// `optional: true` (optional-at-key, NON-EMPTY-when-present) — the oracle's
// `Schema.optional(Email)` where `Email` enforces `isMinLength(1)`. Two rules,
// like the real forms, so the "multiple unsatisfied rules surface at once" path
// is exercised.
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
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      optional: true,
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: text('Phone', 'Tél'),
      optional: true,
      requiredMessage: 'contact.form.phone.required',
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
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['phone', 'both'],
      target: 'phone',
      message: 'contact.form.phone.required',
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

  test('an empty (present-but-blank) target with the trigger active emits the required key', () => {
    // The oracle gates `email` as `Schema.optional(Email)`, and `Email` enforces
    // `isMinLength(1)`, so `{ method: 'email', email: '' }` is a decode error —
    // a visibly-blank required field must never decode SUCCESS. The empty present
    // value is rejected by the field codec (the `optional: true` email is
    // non-empty-when-present), surfacing exactly one error on the field.
    const errors = errorsFor(ruleDef, { method: 'email', email: '' });
    expect(errors?.fieldErrors['email']).toEqual([
      'contact.form.email.required',
    ]);
  });

  test('an empty present target with the trigger INACTIVE still rejects (non-empty-when-present)', () => {
    // Even when `method` is `phone` (so the email rule is not triggered), a
    // present `email: ''` is a blank value the field codec rejects, matching the
    // oracle's always-on `isMinLength(1)`.
    const errors = errorsFor(ruleDef, { method: 'phone', email: '', phone: '5' });
    expect(errors?.fieldErrors['email']).toEqual([
      'contact.form.email.required',
    ]);
  });

  test('two unsatisfied rules both surface (the accumulating presence filter)', () => {
    // `both` triggers both the email and phone rules; with neither present, BOTH
    // keys must fire — a chained-`.check` composition would abort after the first.
    const errors = errorsFor(ruleDef, { method: 'both' });
    expect(errors?.fieldErrors['email']).toEqual([
      'contact.form.email.required',
    ]);
    expect(errors?.fieldErrors['phone']).toEqual([
      'contact.form.phone.required',
    ]);
  });

  test('the target is not required when the trigger field does not match', () => {
    expect(
      Result.isSuccess(decodeForm(ruleDef, { method: 'phone', phone: '5' })),
    ).toBe(true);
  });

  test('a present target with the trigger active decodes', () => {
    expect(
      Result.isSuccess(
        decodeForm(ruleDef, { method: 'both', email: 'a@b.co', phone: '5' }),
      ),
    ).toBe(true);
  });
});

// C4a — the four ACTIVATION decode rows (registrar plan Decision 5). An
// `activeWhenEquals` target is optional-at-key so an INACTIVE-absent value
// decodes; the presence filter re-imposes the rest: active+absent ⇒ required,
// present+inactive ⇒ rejected (out-of-form payload), active+present ⇒ runs the
// kind codec. One gated target per predicate kind.
const activationDef = asDefinition({
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
      _tag: 'requiredText',
      name: 'seats',
      label: text('Seats', 'Places'),
      requiredMessage: 'registration.form.church.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: { _tag: 'literalEquals', when: 'addBanquet', equals: ['yes'] },
      target: 'seats',
    },
  ],
});

describe('activeWhenEquals decode rows — literalEquals', () => {
  test('absent + inactive ⇒ valid (optional-at-key, no requirement)', () => {
    expect(
      Result.isSuccess(decodeForm(activationDef, { addBanquet: 'no' })),
    ).toBe(true);
  });

  test('absent + active ⇒ REJECT, emits the target required key', () => {
    const errors = errorsFor(activationDef, { addBanquet: 'yes' });
    expect(errors?.fieldErrors['seats']).toEqual([
      'registration.form.church.required',
    ]);
  });

  test('present + inactive ⇒ REJECT (out-of-form payload) at the target', () => {
    const errors = errorsFor(activationDef, { addBanquet: 'no', seats: '4' });
    expect(errors?.fieldErrors['seats']).toEqual([
      'registration.form.church.required',
    ]);
  });

  test('present + active ⇒ valid (the kind codec runs)', () => {
    const result = decodeForm(activationDef, { addBanquet: 'yes', seats: '4' });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success['seats']).toBe('4');
  });
});

const arrayGatedDef = asDefinition({
  title: text('F', 'F'),
  fields: [
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
      _tag: 'requiredText',
      name: 'instrument',
      label: text('Instrument', 'Instrument'),
      requiredMessage: 'registration.form.instrument.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'arrayIncludesAny',
        when: 'workshops',
        values: ['music'],
      },
      target: 'instrument',
    },
  ],
});

describe('activeWhenEquals decode rows — arrayIncludesAny', () => {
  test('inactive (array excludes trigger) ⇒ absent target valid, present rejected', () => {
    expect(
      Result.isSuccess(decodeForm(arrayGatedDef, { workshops: ['photo'] })),
    ).toBe(true);
    const errors = errorsFor(arrayGatedDef, {
      workshops: ['photo'],
      instrument: 'piano',
    });
    expect(errors?.fieldErrors['instrument']).toEqual([
      'registration.form.instrument.required',
    ]);
  });

  test('active (array includes trigger) ⇒ absent target required, present valid', () => {
    const errors = errorsFor(arrayGatedDef, { workshops: ['music'] });
    expect(errors?.fieldErrors['instrument']).toEqual([
      'registration.form.instrument.required',
    ]);
    expect(
      Result.isSuccess(
        decodeForm(arrayGatedDef, {
          workshops: ['music'],
          instrument: 'piano',
        }),
      ),
    ).toBe(true);
  });
});

const checkboxGatedDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'checkboxBoolean',
      name: 'bringingGuest',
      label: text('Guest?', 'Invité?'),
      requiredMessage: 'registration.form.tos.required',
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
      predicate: { _tag: 'checkboxChecked', when: 'bringingGuest' },
      target: 'guestName',
    },
  ],
});

describe('activeWhenEquals decode rows — checkboxChecked', () => {
  test('unchecked ⇒ absent target valid, present rejected', () => {
    expect(
      Result.isSuccess(decodeForm(checkboxGatedDef, { bringingGuest: 'false' })),
    ).toBe(true);
    const errors = errorsFor(checkboxGatedDef, {
      bringingGuest: 'false',
      guestName: 'Ada',
    });
    expect(errors?.fieldErrors['guestName']).toEqual([
      'registration.form.name.required',
    ]);
  });

  test('checked ⇒ absent target required, present valid', () => {
    const errors = errorsFor(checkboxGatedDef, { bringingGuest: 'on' });
    expect(errors?.fieldErrors['guestName']).toEqual([
      'registration.form.name.required',
    ]);
    expect(
      Result.isSuccess(
        decodeForm(checkboxGatedDef, {
          bringingGuest: 'on',
          guestName: 'Ada',
        }),
      ),
    ).toBe(true);
  });
});

// An `optionalText` (intrinsically-optional, empty-allowed) activation target —
// the blessed `active ∧ optional ∧ priced` authoring shape (registrar-plan.md:
// 481-482). The two activation rows are INDEPENDENT for it: active+absent is
// VALID (an optional field has no presence requirement) but present+inactive is
// an UNCONDITIONAL out-of-form reject (registrar-plan.md:548) — the smuggled
// value never reaches price(), enforced at the decode boundary, not only by the
// C4c price guard.
const optionalTargetDef = asDefinition({
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
      _tag: 'optionalText',
      name: 'note',
      label: text('Note', 'Note'),
      invalidMessage: 'registration.form.other.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: { _tag: 'literalEquals', when: 'addBanquet', equals: ['yes'] },
      target: 'note',
    },
  ],
});

describe('activeWhenEquals decode rows — optionalText target (optional ∧ priced)', () => {
  test('active + absent ⇒ VALID (an optional active target has no presence requirement)', () => {
    expect(
      Result.isSuccess(decodeForm(optionalTargetDef, { addBanquet: 'yes' })),
    ).toBe(true);
  });

  test('active + present ⇒ valid (the kind codec runs)', () => {
    const result = decodeForm(optionalTargetDef, {
      addBanquet: 'yes',
      note: 'a note',
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success['note']).toBe('a note');
  });

  test('present + inactive ⇒ REJECT (smuggled out-of-form value) at the target', () => {
    const errors = errorsFor(optionalTargetDef, {
      addBanquet: 'no',
      note: 'smuggled',
    });
    expect(errors?.fieldErrors['note']).toEqual([
      'registration.form.other.required',
    ]);
  });

  test('absent + inactive ⇒ valid (optional-at-key, no requirement)', () => {
    expect(
      Result.isSuccess(decodeForm(optionalTargetDef, { addBanquet: 'no' })),
    ).toBe(true);
  });
});
