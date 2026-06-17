import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import { FieldKind, FormDefinition } from './definition';

/**
 * Branch 6.1 — the structural `FormDefinition` schema + closed kind-set.
 *
 * These tests pin the two load-bearing guarantees the engine (Branch 6.2+) builds
 * on:
 *   - the encoded form IS the JSON stored at `forms/<form>.json`, so a definition
 *     exercising every `FieldKind`, a discriminated `variant`, and a cross-field
 *     `rule` round-trips losslessly through `encode → JSON → decode`
 *     (`prove-it-works`);
 *   - the kind-set is CLOSED and every boundary is watertight — an unknown
 *     `_tag`, an off-list `MessageKey`, a dotted `FieldName`, a whitespace
 *     `OptionValue`, an empty option list, duplicate field names, or a one-member
 *     variant set are all hard decode errors
 *     (`make-impossible-states-unrepresentable`, `boundary-discipline`).
 */

const roundTrips = <A, I>(
  schema: Schema.Codec<A, I>,
  value: A,
): Effect.Effect<A, Schema.SchemaError> => {
  const codec = Schema.fromJsonString(schema);
  return Schema.encodeUnknownEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(codec)),
  );
};

const decode = Schema.decodeUnknownResult(FormDefinition);
const succeeds = (value: unknown): boolean => decode(value)._tag === 'Success';
const fails = (value: unknown): boolean => decode(value)._tag === 'Failure';

const text = (en: string, fr: string) => ({ en, fr });

/**
 * A definition exercising EVERY field kind, a nested group, a discriminated
 * variant set, and a cross-field rule — the full structural surface in one value.
 * Built from raw JSON (the on-bucket shape) and decoded, so the round-trip proves
 * the brands survive `encode → JSON → decode`.
 */
const fullDefinitionJson = {
  title: text('Registration', 'Inscription'),
  intro: text('Sign up', 'Inscrivez-vous'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name', 'Nom'),
      placeholder: text('Your name', 'Votre nom'),
      requiredMessage: 'registration.form.name.required',
    },
    {
      _tag: 'optionalText',
      name: 'other',
      label: text('Other', 'Autre'),
      invalidMessage: 'registration.form.other.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      requiredMessage: 'registration.form.email.required',
      invalidMessage: 'registration.form.email.error',
    },
    {
      _tag: 'url',
      name: 'website',
      label: text('Website', 'Site web'),
      requiredMessage: 'registration.form.website.required',
      invalidMessage: 'registration.form.website.required',
    },
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
    {
      _tag: 'checkboxBoolean',
      name: 'tos',
      label: text('Accept terms', 'Accepter les conditions'),
      requiredMessage: 'registration.form.tos.required',
    },
    {
      _tag: 'checkboxBoolean',
      name: 'songLeader',
      label: text('Song leader', 'Chef de chant'),
      optional: true,
      requiredMessage: 'registration.form.volunteer.required',
    },
    {
      _tag: 'arrayOfLiteral',
      name: 'merch',
      label: text('Merch', 'Articles'),
      requiredMessage: 'registration.form.merch.required',
      options: [
        { value: 't-shirt', label: text('T-shirt', 'T-shirt') },
        { value: 'hoodie', label: text('Hoodie', 'Pull') },
      ],
    },
    {
      _tag: 'nestedGroup',
      name: 'parent',
      label: text('Parent', 'Parent'),
      // Exercise the `presenceAnchor` key in the lossless round-trip (the
      // declared inner field an absent group's presence error anchors at).
      presenceAnchor: 'parentName',
      fields: [
        {
          _tag: 'requiredText',
          name: 'parentName',
          label: text('Parent name', 'Nom du parent'),
          requiredMessage: 'registration.form.parent.required',
        },
        {
          _tag: 'email',
          name: 'parentEmail',
          label: text('Parent email', 'Courriel du parent'),
          requiredMessage: 'registration.form.parent-email.required',
          invalidMessage: 'registration.form.parent-email.required',
        },
      ],
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
            label: text('Date of birth', 'Date de naissance'),
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
  rules: [
    {
      _tag: 'requiredWhenEquals',
      when: 'type',
      equals: ['attendee'],
      target: 'dateOfBirth',
      message: 'registration.form.date-of-birth.required',
    },
  ],
} as const;

describe('FormDefinition round-trip (encoded form IS the on-bucket JSON)', () => {
  it.effect(
    'a definition exercising every kind, a variant, and a rule round-trips losslessly',
    () =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(FormDefinition)(
          fullDefinitionJson,
        );
        const restored = yield* roundTrips(FormDefinition, decoded);
        expect(restored).toEqual(decoded);
      }),
  );

  test('an empty field graph is valid (the post-migration default shape)', () => {
    expect(succeeds({ title: text('Contact', 'Contact'), fields: [] })).toBe(
      true,
    );
  });

  test('the optional intro / variant / rules may all be omitted', () => {
    const minimal = Schema.decodeUnknownSync(FormDefinition)({
      title: text('Contact', 'Contact'),
      fields: [],
    });
    expect(minimal.intro).toBeUndefined();
    expect(minimal.variant).toBeUndefined();
    expect(minimal.rules).toBeUndefined();
  });
});

describe('FieldKind is a CLOSED set (no arbitrary field type)', () => {
  test('an unknown field `_tag` is rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'richTextEditor', // not one of the eight kinds
            name: 'body',
            label: text('Body', 'Corps'),
            requiredMessage: 'contact.form.message.required',
          },
        ],
      }),
    ).toBe(true);
  });

  test('the eight kinds decode at the FieldKind boundary', () => {
    const decodeField = Schema.decodeUnknownResult(FieldKind);
    const kinds = [
      'requiredText',
      'optionalText',
      'email',
      'url',
      'literal',
      'checkboxBoolean',
      'arrayOfLiteral',
      'nestedGroup',
    ];
    const seen = new Set(
      fullDefinitionJson.fields.map((field) => field._tag as string),
    );
    // The full definition includes every leaf/structural kind at least once.
    for (const kind of kinds) {
      expect(seen.has(kind)).toBe(true);
    }
    for (const field of fullDefinitionJson.fields) {
      expect(decodeField(field)._tag).toBe('Success');
    }
  });
});

describe('MessageKey boundary (every failure path emits a real TranslationKey)', () => {
  test('an off-list message key is rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'name',
            label: text('Name', 'Nom'),
            requiredMessage: 'contact.form.name.NOPE', // not in translations
          },
        ],
      }),
    ).toBe(true);
  });

  test('a real translation key is accepted', () => {
    expect(
      succeeds({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'name',
            label: text('Name', 'Nom'),
            requiredMessage: 'contact.form.name.required',
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('FieldName / OptionValue boundaries (safe to interpolate)', () => {
  const requiredText = (name: string) => ({
    title: text('F', 'F'),
    fields: [
      {
        _tag: 'requiredText',
        name,
        label: text('N', 'N'),
        requiredMessage: 'contact.form.name.required',
      },
    ],
  });

  test('a dotted / bracketed / whitespace field name is rejected', () => {
    for (const name of ['a.b', 'a[0]', 'a b', '1abc', '']) {
      expect(fails(requiredText(name))).toBe(true);
    }
  });

  test('a plain identifier field name is accepted', () => {
    expect(succeeds(requiredText('firstTimeAttending'))).toBe(true);
  });

  test('an off-token literal option value is rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'literal',
            name: 'gender',
            label: text('G', 'G'),
            requiredMessage: 'registration.form.gender.required',
            options: [{ value: 'has space', label: text('M', 'M') }],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('structural invariants', () => {
  test('a literal field with zero options is rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'literal',
            name: 'gender',
            label: text('G', 'G'),
            requiredMessage: 'registration.form.gender.required',
            options: [],
          },
        ],
      }),
    ).toBe(true);
  });

  test('duplicate field submit-names are rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'dup',
            label: text('A', 'A'),
            requiredMessage: 'contact.form.name.required',
          },
          {
            _tag: 'email',
            name: 'dup',
            label: text('B', 'B'),
            requiredMessage: 'contact.form.email.required',
            invalidMessage: 'contact.form.email.error',
          },
        ],
      }),
    ).toBe(true);
  });

  test('a variant set with fewer than two variants is rejected', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [],
        variant: {
          discriminator: 'type',
          requiredMessage: 'registration.form.type.required',
          options: [{ value: 'attendee', label: text('A', 'A') }],
          variants: [
            { value: 'attendee', label: text('A', 'A'), fields: [] },
          ],
        },
      }),
    ).toBe(true);
  });

  /**
   * `options` and `variants` describe ONE closed value-set: a bijection over
   * the discriminator tokens. The renderer/decoder (Branch 6.2) leans on this —
   * a selectable option always branches to a field set, and every branch is
   * reachable — so the boundary rejects every way the two arrays could diverge.
   */
  const variantSet = (
    options: ReadonlyArray<{ value: string; label: { en: string; fr: string } }>,
    variants: ReadonlyArray<{
      value: string;
      label: { en: string; fr: string };
      fields: ReadonlyArray<unknown>;
    }>,
  ) => ({
    title: text('F', 'F'),
    fields: [],
    variant: {
      discriminator: 'type',
      requiredMessage: 'registration.form.type.required',
      options,
      variants,
    },
  });

  const attendeeExhibitorOptions = [
    { value: 'attendee', label: text('A', 'A') },
    { value: 'exhibitor', label: text('E', 'E') },
  ];

  test('an option with no matching variant branch is rejected', () => {
    expect(
      fails(
        variantSet(attendeeExhibitorOptions, [
          { value: 'attendee', label: text('A', 'A'), fields: [] },
          // no `exhibitor` branch — the option is a selectable dead end
          { value: 'speaker', label: text('S', 'S'), fields: [] },
        ]),
      ),
    ).toBe(true);
  });

  test('a variant branch with no matching option is rejected (unreachable branch)', () => {
    expect(
      fails(
        variantSet(attendeeExhibitorOptions, [
          { value: 'attendee', label: text('A', 'A'), fields: [] },
          { value: 'exhibitor', label: text('E', 'E'), fields: [] },
          // `staff` branch can never be selected — no option targets it
          { value: 'staff', label: text('S', 'S'), fields: [] },
        ]),
      ),
    ).toBe(true);
  });

  test('a duplicate variant value is rejected', () => {
    expect(
      fails(
        variantSet(attendeeExhibitorOptions, [
          { value: 'attendee', label: text('A', 'A'), fields: [] },
          { value: 'attendee', label: text('A2', 'A2'), fields: [] },
        ]),
      ),
    ).toBe(true);
  });

  test('a duplicate option value is rejected', () => {
    expect(
      fails(
        variantSet(
          [
            { value: 'attendee', label: text('A', 'A') },
            { value: 'attendee', label: text('A2', 'A2') },
          ],
          [
            { value: 'attendee', label: text('A', 'A'), fields: [] },
            { value: 'exhibitor', label: text('E', 'E'), fields: [] },
          ],
        ),
      ),
    ).toBe(true);
  });

  test('matching options and variant branches (a bijection) are accepted', () => {
    expect(
      succeeds(
        variantSet(attendeeExhibitorOptions, [
          { value: 'attendee', label: text('A', 'A'), fields: [] },
          { value: 'exhibitor', label: text('E', 'E'), fields: [] },
        ]),
      ),
    ).toBe(true);
  });

  test('a present-but-blank-locale label is a hard decode error (Text invariant)', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'requiredText',
            name: 'name',
            label: text('', ''),
            requiredMessage: 'contact.form.name.required',
          },
        ],
      }),
    ).toBe(true);
  });

  test('an unknown cross-field rule kind is rejected (closed rule set)', () => {
    expect(
      fails({
        title: text('F', 'F'),
        fields: [],
        rules: [
          {
            _tag: 'requiredWhenPresent', // not a known rule kind
            when: 'type',
            target: 'company',
            message: 'registration.form.company.required',
          },
        ],
      }),
    ).toBe(true);
  });
});
