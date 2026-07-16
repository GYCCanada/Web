import { Schema } from 'effect';

import { FormDefinition } from './definition';

/** Bundled relational Form seeds owned by the Forms domain. */
/**
 * The contact form's field graph (Branch 6.3) — the data-driven equivalent of the
 * hand-tuned `contact.tsx` schema, proven byte-equivalent by
 * `forms/equivalence.contact.test.ts`. `email`/`phone` are `optional: true`
 * (optional-at-key, non-empty-when-present) and the `method`-gated requirement is
 * the pair of `requiredWhenEquals` rules, exactly mirroring the oracle's
 * `Schema.optional(...)` + struct-level filter (`derive-dont-sync`: this object IS
 * the contact validation now, no hand-written schema beside it).
 */
export const defaultContactForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Contact', fr: 'Contact' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'What is your name?', fr: 'Quel est votre nom?' },
      placeholder: {
        en: 'Type your full name here',
        fr: 'Entrez votre nom complet ici',
      },
      requiredMessage: 'contact.form.name.required',
    },
    {
      _tag: 'literal',
      name: 'method',
      label: {
        en: 'Preferred contact method:',
        fr: 'Méthode de contact préférée: ',
      },
      options: [
        { value: 'email', label: { en: 'Email', fr: 'Courriel' } },
        { value: 'phone', label: { en: 'Phone', fr: 'Téléphone' } },
        { value: 'both', label: { en: 'Email & Phone', fr: 'Courriel et téléphone' } },
      ],
      requiredMessage: 'contact.form.contact-method.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: {
        en: 'What is your email address?',
        fr: 'Quelle est votre adresse courriel?',
      },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      optional: true,
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: {
        en: 'What is your phone number?',
        fr: 'Quel est votre numéro de téléphone?',
      },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      optional: true,
      requiredMessage: 'contact.form.phone.required',
    },
    {
      _tag: 'requiredText',
      name: 'message',
      label: {
        en: 'What can we help you with?',
        fr: 'Comment pouvons-nous vous aider?',
      },
      placeholder: {
        en: 'Type your message here...',
        fr: 'Entrez votre message ici...',
      },
      multiline: true,
      requiredMessage: 'contact.form.message.required',
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

/**
 * The volunteer form's field graph (Branch 6.4) — the data-driven equivalent of
 * the hand-tuned `volunteer.tsx` schema, proven byte-equivalent by
 * `forms/equivalence.volunteer.test.ts`. Like contact it carries the `method`
 * discriminator as a `literal` + the pair of `requiredWhenEquals` rules gating
 * `email`/`phone`; volunteer adds the always-required `age`/`location`/
 * `background`/`why` free-text fields (the latter two `multiline`). The fields
 * are listed in their rendered order (`volunteer.tsx` view order: name, method,
 * email/phone, age, location, background, why) so the migrated `<FormFields>`
 * draws the identical sequence.
 *
 * `email` is `optional: true` (optional-at-key, non-empty-when-present) gated by
 * a `requiredWhenEquals` rule; `phone` is an `optional: true` `requiredText`
 * (the oracle's `Schema.optional(Phone)` where `Phone` is a bare non-empty
 * string with no email/url format check) gated by the second rule — exactly the
 * contact shape (`derive-dont-sync`: this object IS the volunteer validation
 * now, no hand-written schema beside it).
 *
 * The oracle's vestigial `positions` multi-checkbox is intentionally NOT a field
 * here: the volunteer route never populated `data.positions` (a hardcoded `[]`),
 * so its checkbox block never rendered and the field was never submitted — its
 * options are dynamic loader data, never a closed `OptionList`, so it does not
 * fit the closed `FieldKind` set (`subtract-before-you-add`,
 * `make-impossible-states-unrepresentable`). The harness pins this one decoded-
 * default delta (oracle emits `positions: []`, the engine omits it) and the
 * migrated `notify` preserves the email's always-empty `Positions:` line.
 */
export const defaultVolunteerForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Volunteer', fr: 'Bénévolat' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'What is your name?', fr: 'Quel est votre nom?' },
      placeholder: {
        en: 'Type your full name here',
        fr: 'Entrez votre nom complet ici',
      },
      requiredMessage: 'volunteer.form.name.required',
    },
    {
      _tag: 'literal',
      name: 'method',
      label: {
        en: 'Preferred contact method:',
        fr: 'Préférez-vous le téléphone ou le courriel?',
      },
      options: [
        { value: 'phone', label: { en: 'Phone', fr: 'Téléphone' } },
        { value: 'email', label: { en: 'Email', fr: 'Courriel' } },
        {
          value: 'both',
          label: { en: 'Email & Phone', fr: 'Courriel et téléphone' },
        },
      ],
      requiredMessage: 'volunteer.form.method.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: {
        en: 'What is your email address?',
        fr: 'Quelle est votre adresse courriel?',
      },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      optional: true,
      requiredMessage: 'volunteer.form.email.required',
      invalidMessage: 'volunteer.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: {
        en: 'What is your phone number?',
        fr: 'Quel est votre numéro de téléphone?',
      },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      optional: true,
      requiredMessage: 'volunteer.form.phone.required',
    },
    {
      _tag: 'requiredText',
      name: 'age',
      label: { en: 'What is your age?', fr: 'Quel est votre âge?' },
      placeholder: { en: 'Enter your age here', fr: 'Entrez votre âge ici' },
      requiredMessage: 'volunteer.form.age.required',
    },
    {
      _tag: 'requiredText',
      name: 'location',
      label: {
        en: 'Where are you located?',
        fr: 'Où êtes-vous situé?',
      },
      placeholder: {
        en: 'Enter your location here',
        fr: 'Entrez votre emplacement ici',
      },
      requiredMessage: 'volunteer.form.location.required',
    },
    {
      _tag: 'requiredText',
      name: 'background',
      label: {
        en: 'Please tell us more about yourself and your background.',
        fr: "S'il-vous-plait, dites-nous en davantage sur vous et votre parcours?",
      },
      placeholder: {
        en: 'Enter your background here',
        fr: 'Entrez votre parcours ici',
      },
      multiline: true,
      requiredMessage: 'volunteer.form.background.required',
    },
    {
      _tag: 'requiredText',
      name: 'why',
      label: {
        en: 'What motivates you to volunteer with us?',
        fr: "Qu'est-ce qui vous motive à faire du bénévolat avec nous?",
      },
      placeholder: {
        en: 'Enter your reason here',
        fr: 'Entrez votre raison ici',
      },
      multiline: true,
      requiredMessage: 'volunteer.form.why.required',
    },
  ],
  rules: [
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['email', 'both'],
      target: 'email',
      message: 'volunteer.form.email.required',
    },
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['phone', 'both'],
      target: 'phone',
      message: 'volunteer.form.phone.required',
    },
  ],
});

/**
 * The registration form's PER-REGISTRANT field graph (Branch 6) — the data-driven
 * equivalent of the former hand-tuned `Registrant` struct, proven byte-equivalent
 * by the registration equivalence harness against the hand-tuned oracle before both
 * were retired in Branch 6.6 (ADR 0007: "the oracle is removed once registration is
 * fully migrated"). The live form's field-name contract is now pinned by the
 * render-parity tests in `forms/registration-form.test.tsx`. See
 * `docs/forms/registration-spec.md` for the field-for-field transcription.
 *
 * SCOPE: this `FormDefinition` describes ONE registrant. The registration form is
 * `{ registrants: Registrant[] }` — a repeating array of these, which is NOT in
 * the closed `FieldKind` set (the brief's non-goal: the kind-set is closed, not an
 * arbitrary builder). So the engine owns the registrant VALIDATION GRAPH (the
 * attendee/exhibitor discriminator, the per-type requirements, the nested groups,
 * the boolean codecs — the riskiest part the harness pins); the registration route
 * keeps the multi-registrant SHELL (the `registrants` array, the
 * `registrants[n].` field prefix, the minors-only `parent` client gating, the
 * boolean-RADIO rendering of `meals` / `firstTimeAttending`) and derives its
 * validation from `Schema.Array(definitionToSchema(this))`
 * (`derive-dont-sync`).
 *
 * Two oracle subtleties faithfully transcribed:
 *   - `parent.email` is a bare `requiredText`, NOT an `email` kind — the oracle's
 *     `Parent.email` is a `RequiredString` with no `/@/` pattern check, so the
 *     engine must not tighten it (the harness would flag a divergence).
 *   - `parent` / `volunteer` are `optional: true` `nestedGroup`s — the oracle's
 *     attendee filter never REQUIRES them (they are conditionally rendered:
 *     `parent` only for minors, `volunteer` opt-in). The always-rendered `extra`
 *     group is a non-optional `nestedGroup`, so an attendee that omits it is an
 *     error anchored at `extra.tos` (the oracle's `['extra','tos']` anchor).
 */
export const defaultRegistrationForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Registration', fr: 'Inscription' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'Name', fr: 'Nom' },
      placeholder: { en: 'Your full name', fr: 'Votre nom complet' },
      requiredMessage: 'registration.form.name.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: { en: 'Email', fr: 'Courriel' },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      requiredMessage: 'registration.form.email.required',
      invalidMessage: 'registration.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: { en: 'Phone', fr: 'Téléphone' },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      requiredMessage: 'registration.form.phone.required',
    },
  ],
  variant: {
    discriminator: 'type',
    requiredMessage: 'registration.form.type.required',
    options: [
      { value: 'attendee', label: { en: 'Attendee', fr: 'Participant' } },
      { value: 'exhibitor', label: { en: 'Exhibitor', fr: 'Exposant' } },
    ],
    variants: [
      {
        value: 'attendee',
        label: { en: 'Attendee', fr: 'Participant' },
        fields: [
          {
            _tag: 'literal',
            name: 'gender',
            label: { en: 'Gender', fr: 'Genre' },
            options: [
              { value: 'male', label: { en: 'Male', fr: 'Homme' } },
              { value: 'female', label: { en: 'Female', fr: 'Femme' } },
            ],
            requiredMessage: 'registration.form.gender.required',
          },
          {
            _tag: 'requiredText',
            name: 'dateOfBirth',
            label: { en: 'Date of birth', fr: 'Date de naissance' },
            requiredMessage: 'registration.form.date-of-birth.required',
          },
          {
            _tag: 'nestedGroup',
            name: 'parent',
            label: { en: 'Parent / guardian', fr: 'Parent / tuteur' },
            optional: true,
            fields: [
              {
                _tag: 'requiredText',
                name: 'name',
                label: { en: 'Parent name', fr: 'Nom du parent' },
                requiredMessage: 'registration.form.parent.required',
              },
              {
                _tag: 'requiredText',
                name: 'email',
                label: { en: 'Parent email', fr: 'Courriel du parent' },
                requiredMessage: 'registration.form.parent-email.required',
              },
              {
                _tag: 'requiredText',
                name: 'phone',
                label: { en: 'Parent phone', fr: 'Téléphone du parent' },
                requiredMessage: 'registration.form.parent-phone.required',
              },
            ],
          },
          {
            _tag: 'checkboxBoolean',
            name: 'meals',
            label: { en: 'Meals', fr: 'Repas' },
            requiredMessage: 'registration.form.meals.required',
          },
          {
            _tag: 'optionalText',
            name: 'dietaryRestrictions',
            label: {
              en: 'Dietary restrictions',
              fr: 'Restrictions alimentaires',
            },
            invalidMessage: 'registration.form.dietary-restrictions.required',
          },
          {
            _tag: 'arrayOfLiteral',
            name: 'outreach',
            label: { en: 'Outreach', fr: 'Sensibilisation' },
            options: [
              {
                value: 'laws-of-health',
                label: { en: 'Laws of Health', fr: 'Lois de la santé' },
              },
              {
                value: 'homeless-carepacks',
                label: {
                  en: 'Homeless Care Packs',
                  fr: 'Trousses pour sans-abri',
                },
              },
              {
                value: 'back-to-school',
                label: { en: 'Back to School', fr: 'Rentrée scolaire' },
              },
              {
                value: 'not-sure',
                label: { en: 'Not sure', fr: 'Pas sûr' },
              },
            ],
            requiredMessage: 'registration.form.outreach.required',
          },
          {
            _tag: 'nestedGroup',
            name: 'extra',
            label: { en: 'Extra information', fr: 'Informations supplémentaires' },
            // An absent `extra` group anchors its presence error at `tos`,
            // matching the registration oracle's `['extra','tos']` anchor
            // (registration-spec.md:78). Without this, `groupPresenceIssue` would
            // anchor at the group's first presence-requirable field
            // (`howDidYouHear`), diverging from the oracle's emitted key set.
            presenceAnchor: 'tos',
            fields: [
              {
                _tag: 'requiredText',
                name: 'howDidYouHear',
                label: { en: 'How did you hear about us?', fr: 'Comment avez-vous entendu parler de nous?' },
                requiredMessage: 'registration.form.how-did-you-hear.required',
              },
              {
                _tag: 'requiredText',
                name: 'whyAreYouAttending',
                label: { en: 'Why are you attending?', fr: 'Pourquoi participez-vous?' },
                requiredMessage:
                  'registration.form.why-are-you-attending.required',
              },
              {
                _tag: 'requiredText',
                name: 'whatAreYouExcitedAbout',
                label: { en: 'What are you excited about?', fr: 'Qu’est-ce qui vous enthousiasme?' },
                requiredMessage:
                  'registration.form.what-are-you-excited-about.required',
              },
              {
                _tag: 'checkboxBoolean',
                name: 'firstTimeAttending',
                label: { en: 'First time attending?', fr: 'Première participation?' },
                requiredMessage:
                  'registration.form.first-time-attending.required',
              },
              {
                _tag: 'optionalText',
                name: 'church',
                label: { en: 'Church', fr: 'Église' },
                invalidMessage: 'registration.form.church.required',
              },
              {
                _tag: 'arrayOfLiteral',
                name: 'merch',
                label: { en: 'Merch', fr: 'Articles' },
                options: [
                  { value: 't-shirt', label: { en: 'T-shirt', fr: 'T-shirt' } },
                  { value: 'hoodie', label: { en: 'Hoodie', fr: 'Pull' } },
                  { value: 'shirt', label: { en: 'Shirt', fr: 'Chemise' } },
                  { value: 'none', label: { en: 'None', fr: 'Aucun' } },
                ],
                requiredMessage: 'registration.form.merch.required',
              },
              {
                _tag: 'optionalText',
                name: 'other',
                label: { en: 'Other', fr: 'Autre' },
                // Realizes the former hand-tuned `OptionalText` (the registration
                // oracle's `other`, retired in 6.6): key-must-be-present,
                // empty-string-allowed — the always-rendered `extra` block POSTs an
                // empty `other`, so an absent `other` inside a present `extra` is an
                // out-of-form payload that schema rejects.
                // `church`/`instrument`/`dietaryRestrictions` are genuinely-optional
                // (the former `OptionalString`) and omit this flag.
                requirePresent: true,
                invalidMessage: 'registration.form.other.required',
              },
              {
                _tag: 'checkboxBoolean',
                name: 'tos',
                label: { en: 'I agree to the terms', fr: 'J’accepte les conditions' },
                requiredMessage: 'registration.form.tos.required',
              },
            ],
          },
          {
            _tag: 'nestedGroup',
            name: 'volunteer',
            label: { en: 'Volunteer', fr: 'Bénévolat' },
            optional: true,
            fields: [
              ...(
                [
                  'songLeader',
                  'musician',
                ] as const
              ).map((name) => ({
                _tag: 'checkboxBoolean' as const,
                name,
                label: { en: name, fr: name },
                optional: true,
                requiredMessage: 'registration.form.volunteer.required' as const,
              })),
              {
                _tag: 'optionalText' as const,
                name: 'instrument',
                label: { en: 'Instrument', fr: 'Instrument' },
                invalidMessage: 'registration.form.instrument.required' as const,
              },
              ...(
                [
                  'specialMusic',
                  'hospitality',
                  'registrationStation',
                  'usher',
                  'outreachLeader',
                  'smallGroupLeader',
                  'seminarRoomHost',
                  'cameraOperator',
                  'photographer',
                  'roamingMic',
                ] as const
              ).map((name) => ({
                _tag: 'checkboxBoolean' as const,
                name,
                label: { en: name, fr: name },
                optional: true,
                requiredMessage: 'registration.form.volunteer.required' as const,
              })),
            ],
          },
        ],
      },
      {
        value: 'exhibitor',
        label: { en: 'Exhibitor', fr: 'Exposant' },
        fields: [
          {
            _tag: 'requiredText',
            name: 'synopsis',
            label: { en: 'Synopsis', fr: 'Synopsis' },
            requiredMessage: 'registration.form.synopsis.required',
          },
          {
            _tag: 'url',
            name: 'website',
            label: { en: 'Website', fr: 'Site web' },
            requiredMessage: 'registration.form.website.required',
            invalidMessage: 'registration.form.website.required',
          },
          {
            _tag: 'requiredText',
            name: 'company',
            label: { en: 'Company', fr: 'Entreprise' },
            requiredMessage: 'registration.form.company.required',
          },
        ],
      },
    ],
  },
});

