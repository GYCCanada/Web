import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Result, Schema } from 'effect';

import { deepMerge } from '../content/admin-form';
import { FieldKind, FormDefinition, MessageKey } from './definition';
import { PartySection } from './party';

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

/**
 * C4a — `ActiveWhen` + the `activeWhenEquals` `CrossFieldRule` member + the
 * `rulesReferToExistingFields` integrity filter (registrar plan Decision 5). The
 * filter closes BOTH rule kinds' reference drift at the decode boundary — a
 * dangling `when`/`target`, a wrong `when` kind, an off-list trigger value, a
 * cross-scope reference, a self-reference, and an activation cycle are all hard
 * decode errors — and now also closes the PRE-EXISTING `requiredWhenEquals` gap.
 */
describe('cross-field rule integrity filter (Decision 5)', () => {
  /** A small form with one literal, one array, one checkbox, and three text targets. */
  const gatedFields = [
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
      label: text('Guest?', 'Invité?'),
      requiredMessage: 'registration.form.tos.required',
    },
    {
      _tag: 'requiredText',
      name: 'seats',
      label: text('Seats', 'Places'),
      requiredMessage: 'registration.form.church.required',
    },
  ] as const;

  const withRules = (rules: ReadonlyArray<unknown>) => ({
    title: text('F', 'F'),
    fields: gatedFields,
    rules,
  });

  test('a well-formed rule of each predicate kind decodes', () => {
    expect(
      succeeds(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['yes'],
            },
            target: 'seats',
          },
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'arrayIncludesAny',
              when: 'workshops',
              values: ['music'],
            },
            target: 'addBanquet',
          },
          {
            _tag: 'activeWhenEquals',
            predicate: { _tag: 'checkboxChecked', when: 'bringingGuest' },
            target: 'workshops',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a dangling activeWhenEquals target fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['yes'],
            },
            target: 'doesNotExist',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a dangling activeWhenEquals "when" fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'doesNotExist',
              equals: ['yes'],
            },
            target: 'seats',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('an off-option literalEquals trigger value fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['maybe'], // not an addBanquet option
            },
            target: 'seats',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a literalEquals predicate over a non-literal "when" fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'bringingGuest', // a checkboxBoolean, not a literal
              equals: ['yes'],
            },
            target: 'seats',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('an arrayIncludesAny predicate over a non-array "when" fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'arrayIncludesAny',
              when: 'addBanquet', // a literal, not an arrayOfLiteral
              values: ['yes'],
            },
            target: 'seats',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a checkboxChecked predicate over a non-checkbox "when" fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: { _tag: 'checkboxChecked', when: 'addBanquet' }, // a literal
            target: 'seats',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a self-referential rule (when === target) fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['yes'],
            },
            target: 'addBanquet',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('an activation cycle (A gates B gates A) fails decode', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['yes'],
            },
            target: 'workshops',
          },
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'arrayIncludesAny',
              when: 'workshops',
              values: ['music'],
            },
            target: 'addBanquet',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('the PRE-EXISTING requiredWhenEquals gap is now closed (dangling target rejected)', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'requiredWhenEquals',
            when: 'addBanquet',
            equals: ['yes'],
            target: 'doesNotExist',
            message: 'registration.form.church.required',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a requiredWhenEquals naming an off-option trigger value is rejected', () => {
    expect(
      fails(
        withRules([
          {
            _tag: 'requiredWhenEquals',
            when: 'addBanquet',
            equals: ['maybe'], // not an addBanquet option
            target: 'seats',
            message: 'registration.form.church.required',
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a requiredWhenEquals over the discriminator → a variant-branch target is same-scope (decodes)', () => {
    // The decoder flattens the discriminator + every variant branch's fields
    // into ONE struct, so the registration `type` → `dateOfBirth` rule IS
    // same-scope. The full fixture exercises exactly this — it must still decode.
    expect(succeeds(fullDefinitionJson)).toBe(true);
  });

  test('a rule whose "when" and "target" live in different scopes is rejected', () => {
    // `when` is a top-level field; `target` is inside a nestedGroup — different
    // decoded namespaces, so cross-scope activation is deferred (rejected in v1).
    expect(
      fails({
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
            _tag: 'nestedGroup',
            name: 'extras',
            label: text('Extras', 'Extras'),
            fields: [
              {
                _tag: 'requiredText',
                name: 'seats',
                label: text('Seats', 'Places'),
                requiredMessage: 'registration.form.church.required',
              },
            ],
          },
        ],
        rules: [
          {
            _tag: 'activeWhenEquals',
            predicate: {
              _tag: 'literalEquals',
              when: 'addBanquet',
              equals: ['yes'],
            },
            target: 'seats', // lives in `extras`, not the top-level scope
          },
        ],
      }),
    ).toBe(true);
  });
});

/**
 * C2 — the `pricing` sibling on `FormDefinition` + its reference-integrity filter.
 *
 * `pricing` is `optionalKey` (Decision 3), so the back-compat guarantee is the
 * load-bearing one: every already-published `forms/*.json` (none carry pricing)
 * keeps decoding unchanged. The `pricingReferencesResolve` filter then closes the
 * SEPARATE-pricing-structure design's only drift surface (Decision 1) at the
 * boundary — a rule naming a missing field, a kind mismatch, or an off-list option
 * is a hard decode error, exactly the way `variantsMatchOptions` closes the
 * discriminator bijection.
 */
describe('pricing sibling on FormDefinition (Decision 1/3)', () => {
  /** A small priced form: a `literal`, an `arrayOfLiteral`, and a `checkboxBoolean`. */
  const pricedFields = [
    {
      _tag: 'literal',
      name: 'tShirtSize',
      label: text('Size', 'Taille'),
      requiredMessage: 'registration.form.gender.required',
      options: [
        { value: 'small', label: text('Small', 'Petit') },
        { value: 'large', label: text('Large', 'Grand') },
      ],
    },
    {
      _tag: 'arrayOfLiteral',
      name: 'workshops',
      label: text('Workshops', 'Ateliers'),
      requiredMessage: 'registration.form.merch.required',
      options: [
        { value: 'photography', label: text('Photo', 'Photo') },
        { value: 'music', label: text('Music', 'Musique') },
      ],
    },
    {
      _tag: 'checkboxBoolean',
      name: 'addBanquet',
      label: text('Banquet', 'Banquet'),
      requiredMessage: 'registration.form.tos.required',
    },
  ] as const;

  const withPricing = (rules: ReadonlyArray<unknown>) => ({
    title: text('Registration', 'Inscription'),
    fields: pricedFields,
    pricing: { currency: 'cad', base: 5000, rules },
  });

  test('an existing no-pricing definition still decodes (back-compat)', () => {
    // The full Branch-6.1 fixture carries no `pricing` — proves optionalKey
    // leaves every already-published forms/*.json decoding unchanged.
    expect(succeeds(fullDefinitionJson)).toBe(true);
    expect(
      Schema.decodeUnknownSync(FormDefinition)(fullDefinitionJson).pricing,
    ).toBeUndefined();
  });

  test('a pricing block whose rules all resolve decodes', () => {
    expect(
      succeeds(
        withPricing([
          {
            _tag: 'choice',
            field: 'tShirtSize',
            prices: [{ option: 'large', amount: 500 }],
          },
          {
            _tag: 'multiChoice',
            field: 'workshops',
            prices: [{ option: 'photography', amount: 1500 }],
          },
          { _tag: 'toggle', field: 'addBanquet', amount: 2500 },
        ]),
      ),
    ).toBe(true);
  });

  test('a rule naming a field that does not exist fails decode', () => {
    expect(
      fails(
        withPricing([
          { _tag: 'toggle', field: 'doesNotExist', amount: 2500 },
        ]),
      ),
    ).toBe(true);
  });

  test('a choice rule pricing an option the field does not offer fails decode', () => {
    expect(
      fails(
        withPricing([
          {
            _tag: 'choice',
            field: 'tShirtSize',
            prices: [{ option: 'xxl', amount: 500 }], // not a tShirtSize option
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a choice rule targeting a non-literal field (kind mismatch) fails decode', () => {
    expect(
      fails(
        withPricing([
          {
            _tag: 'choice',
            field: 'addBanquet', // a checkboxBoolean, not a literal
            prices: [{ option: 'small', amount: 500 }],
          },
        ]),
      ),
    ).toBe(true);
  });

  test('a toggle rule targeting a non-checkbox field (kind mismatch) fails decode', () => {
    expect(
      fails(
        withPricing([
          { _tag: 'toggle', field: 'tShirtSize', amount: 2500 }, // a literal
        ]),
      ),
    ).toBe(true);
  });

  test('a rule may reference a field nested in a group', () => {
    expect(
      succeeds({
        title: text('F', 'F'),
        fields: [
          {
            _tag: 'nestedGroup',
            name: 'extras',
            label: text('Extras', 'Extras'),
            fields: [
              {
                _tag: 'checkboxBoolean',
                name: 'addBanquet',
                label: text('Banquet', 'Banquet'),
                requiredMessage: 'registration.form.tos.required',
              },
            ],
          },
        ],
        pricing: {
          currency: 'cad',
          base: 0,
          rules: [{ _tag: 'toggle', field: 'addBanquet', amount: 2500 }],
        },
      }),
    ).toBe(true);
  });

  test('a rule may reference a field inside a variant branch', () => {
    expect(
      succeeds({
        title: text('F', 'F'),
        fields: [],
        variant: {
          discriminator: 'type',
          requiredMessage: 'registration.form.type.required',
          options: [
            { value: 'attendee', label: text('A', 'A') },
            { value: 'exhibitor', label: text('E', 'E') },
          ],
          variants: [
            {
              value: 'attendee',
              label: text('A', 'A'),
              fields: [
                {
                  _tag: 'checkboxBoolean',
                  name: 'addBanquet',
                  label: text('Banquet', 'Banquet'),
                  requiredMessage: 'registration.form.tos.required',
                },
              ],
            },
            { value: 'exhibitor', label: text('E', 'E'), fields: [] },
          ],
        },
        pricing: {
          currency: 'cad',
          base: 0,
          rules: [{ _tag: 'toggle', field: 'addBanquet', amount: 2500 }],
        },
      }),
    ).toBe(true);
  });
});

describe('party section on FormDefinition (Decision 2b)', () => {
  // The new `registration.party.*` MessageKey tokens do not ship until C7a (a
  // deploy — proven absent by the party-scope spike), so these fixtures reuse
  // EXISTING valid TranslationKeys for the payer/selector message chrome. C6.5
  // proves only the schema mechanics; the authored block lands in C7a.
  const groupOptions = {
    group: text('Pay for everyone', 'Payer pour tous'),
  };
  const bothOptions = {
    group: text('Pay for everyone', 'Payer pour tous'),
    perRegistrant: text('Everyone pays their own', 'Chacun paie'),
  };
  const perRegistrantOptions = {
    perRegistrant: text('Everyone pays their own', 'Chacun paie'),
  };
  const billingMode = (options: unknown) => ({
    label: text('How are you paying?', 'Comment payez-vous ?'),
    requiredMessage: 'registration.form.email.required',
    options,
  });
  const payer = {
    label: text('Who is paying?', 'Qui paie ?'),
    nameField: {
      label: text('Name', 'Nom'),
      requiredMessage: 'registration.form.name.required',
    },
    emailField: {
      label: text('Email', 'Courriel'),
      requiredMessage: 'registration.form.email.required',
      invalidMessage: 'registration.form.email.error',
    },
  };
  const withParty = (party: unknown) => ({
    title: text('Registration', 'Inscription'),
    fields: [],
    party,
  });

  test('a group-offering party (with payer) round-trips losslessly', () => {
    const decoded = Schema.decodeUnknownSync(PartySection)({
      intro: text('Tell us how you are paying', 'Dites-nous comment vous payez'),
      billingMode: billingMode(groupOptions),
      payer,
    });
    const codec = Schema.fromJsonString(PartySection);
    const restored = Schema.decodeUnknownSync(codec)(
      Schema.encodeUnknownSync(codec)(decoded),
    );
    expect(restored).toEqual(decoded);
  });

  test('a party is optional — a definition with no party decodes (backfill-safe)', () => {
    const minimal = Schema.decodeUnknownSync(FormDefinition)({
      title: text('Contact', 'Contact'),
      fields: [],
    });
    expect(minimal.party).toBeUndefined();
  });

  test('a group-only options set (the allow-list case) decodes — no phantom perRegistrant', () => {
    const decoded = Schema.decodeUnknownSync(FormDefinition)(
      withParty({ billingMode: billingMode(groupOptions), payer }),
    );
    expect(decoded.party?.billingMode.options.group).toBeDefined();
    expect(decoded.party?.billingMode.options.perRegistrant).toBeUndefined();
  });

  test('nonEmptyOptions: a billing mode offering zero modes is rejected', () => {
    expect(fails(withParty({ billingMode: billingMode({}), payer }))).toBe(true);
    expect(fails(withParty({ billingMode: billingMode({}) }))).toBe(true);
  });

  test('biconditional: group ∈ options without a payer is rejected', () => {
    expect(fails(withParty({ billingMode: billingMode(groupOptions) }))).toBe(
      true,
    );
    expect(fails(withParty({ billingMode: billingMode(bothOptions) }))).toBe(
      true,
    );
  });

  test('biconditional: a perRegistrant-only party WITH a payer is rejected (dead authored payer)', () => {
    expect(
      fails(withParty({ billingMode: billingMode(perRegistrantOptions), payer })),
    ).toBe(true);
  });

  test('biconditional: a perRegistrant-only party with no payer decodes', () => {
    expect(
      succeeds(withParty({ billingMode: billingMode(perRegistrantOptions) })),
    ).toBe(true);
  });

  test('biconditional: a both-modes party (offers group) WITH a payer decodes', () => {
    expect(
      succeeds(withParty({ billingMode: billingMode(bothOptions), payer })),
    ).toBe(true);
  });

  // ── Graduated de-risk spikes (registrar plan C6.5 gate-green) ──────────────
  // These two mechanics are the load-bearing authoring + token constraints the
  // party-scope re-design (Decision 2b) depends on. They formerly lived in the
  // standalone party-scope-spike.test.ts against hand-built `Json` literals;
  // graduated here to drive the REAL `PartySection`/`BillingModeSelector.options`
  // encoded shape and the REAL `MessageKey`, per the spec's gate-green list.

  test('SPIKE 1 — a label edit on the REAL encoded billingMode.options round-trips through deepMerge, siblings survive (incl. group-only)', () => {
    // The base is the ACTUAL encoded shape of PartySection.billingMode.options —
    // not a hand-built literal. Edits land on `options.<mode>.<locale>`, the path
    // the /admin authoring channel walks, and object-branch recursion must keep
    // the untouched sibling locale + the other mode intact.
    const both = Schema.encodeUnknownSync(PartySection)(
      Schema.decodeUnknownSync(PartySection)({
        billingMode: billingMode(bothOptions),
        payer,
      }),
    );
    const baseOptions = both.billingMode.options;

    // edit ONLY group's English label (path billingMode.options.group.en)
    const merged = deepMerge(baseOptions, { group: { en: 'One person pays' } }) as {
      group: { en: string; fr: string };
      perRegistrant: { en: string; fr: string };
    };
    expect(merged.group.en).toBe('One person pays'); // the edit landed
    expect(merged.group.fr).toBe('Payer pour tous'); // French sibling survived
    expect(merged.perRegistrant.en).toBe('Everyone pays their own'); // other mode intact
    expect(merged.perRegistrant.fr).toBe('Chacun paie');

    // the group-ONLY allow-list case: editing the lone mode's French label lands,
    // and no phantom perRegistrant is conjured (the absent key stays absent).
    const groupOnly = Schema.encodeUnknownSync(PartySection)(
      Schema.decodeUnknownSync(PartySection)({
        billingMode: billingMode(groupOptions),
        payer,
      }),
    );
    const mergedGroupOnly = deepMerge(groupOnly.billingMode.options, {
      group: { fr: 'Payer pour le groupe' },
    }) as { group: { en: string; fr: string }; perRegistrant?: unknown };
    expect(mergedGroupOnly.group.en).toBe('Pay for everyone');
    expect(mergedGroupOnly.group.fr).toBe('Payer pour le groupe');
    expect('perRegistrant' in mergedGroupOnly).toBe(false);
  });

  test('SPIKE 2 — a new registration.party.* token is REJECTED by the REAL MessageKey until it ships in translations.ts', () => {
    // The C7a tokens are not yet registered, so the brand boundary must reject
    // them: a CMS edit cannot introduce a new key, only localize a registered one.
    const decoded = Schema.decodeUnknownResult(MessageKey)(
      'registration.party.billingMode.required',
    );
    expect(Result.isFailure(decoded)).toBe(true);
    // total boundary anchor — an already-registered token still decodes.
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(MessageKey)('registration.form.email.required'),
      ),
    ).toBe(true);
  });
});
