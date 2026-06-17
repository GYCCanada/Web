import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { FormProvider, useForm } from '~/lib/conform';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root as translations } from '~/lib/localization/translations';

import { FormFields } from './render';
import type { FormDefinition } from './definition';
import { FormDefinition as FormDefinitionSchema } from './definition';

/**
 * Branch 6.2 — the generic renderer.
 *
 * `<FormFields definition={def} />` renders the closed `FieldKind` set into form
 * controls. These render-to-string tests pin the load-bearing behaviour the
 * route migration (Branches 6.3–6.5) and the render-parity half of the
 * equivalence harness (Branch 6.5) depend on (`prove-it-works`):
 *   - each field kind renders a control carrying the field's submit-`name`
 *     (so the browser POSTs the name the decoder addresses);
 *   - bilingual `label` copy projects to the active locale (`/fr` → French);
 *   - a `nestedGroup`'s inner fields render under dotted `group.field` names (the
 *     shape `parseSubmission` nests for the decoder);
 *   - a discriminated `variant` renders its discriminator options, and the
 *     selected branch's fields render while the unselected branch's do not
 *     (the client-driven conditional the hand-tuned `method` forms run).
 *
 * The renderer uses conform field hooks, so it is mounted inside a real
 * `useForm` + `FormProvider` (a `defaultValue` selects the variant branch to
 * exercise), under a router stub (`useLocale` reads `params.lang`) and a
 * `LocalizationProvider`.
 */

const text = (en: string, fr: string) => ({ en, fr });

/**
 * A permissive client schema for the harness — `useForm` requires a validation
 * source, but these tests exercise render output, not validation (decode is
 * covered in `decode.test.ts`). An open record accepts any field shape.
 */
const permissiveSchema = Schema.toStandardSchemaV1(
  Schema.Record(Schema.String, Schema.Unknown),
);

const asDefinition = (json: unknown): FormDefinition =>
  Schema.decodeUnknownSync(FormDefinitionSchema)(json);

/** Render `<FormFields>` for a definition, optionally in French or with a default value. */
const render = (
  definition: FormDefinition,
  {
    lang,
    defaultValue,
  }: { lang?: 'fr'; defaultValue?: Record<string, unknown> } = {},
): string => {
  function Harness() {
    const { form } = useForm(permissiveSchema, {
      id: 'test',
      defaultValue: defaultValue ?? {},
    });
    return (
      <FormProvider context={form.context}>
        <form {...form.props}>
          <FormFields definition={definition} formId={form.id} />
        </form>
      </FormProvider>
    );
  }

  const Stub = createRoutesStub([
    {
      id: 'root',
      path: ':lang?',
      Component: () => (
        <LocalizationProvider
          translation={translations[lang === 'fr' ? 'fr' : 'en']}
        >
          <Harness />
        </LocalizationProvider>
      ),
    },
  ]);

  return renderToString(
    <Stub initialEntries={[lang === 'fr' ? '/fr' : '/']} />,
  );
};

const everyKindDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'fullName',
      label: text('Full name', 'Nom complet'),
      placeholder: text('Your name', 'Votre nom'),
      requiredMessage: 'contact.form.name.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: text('Email', 'Courriel'),
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
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
      label: text('Accept terms', 'Accepter'),
      requiredMessage: 'registration.form.tos.required',
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
      fields: [
        {
          _tag: 'requiredText',
          name: 'parentName',
          label: text('Parent name', 'Nom du parent'),
          requiredMessage: 'registration.form.parent.required',
        },
      ],
    },
  ],
});

describe('FormFields renders each field kind', () => {
  test('every leaf control carries its submit-name', () => {
    const html = render(everyKindDef);
    for (const name of [
      'fullName',
      'email',
      'website',
      'gender',
      'tos',
      'merch',
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  test('the email and url inputs carry their input types', () => {
    const html = render(everyKindDef);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="url"');
  });

  test('literal / arrayOfLiteral render each option label', () => {
    const html = render(everyKindDef);
    for (const label of ['Male', 'Female', 'T-shirt', 'Hoodie']) {
      expect(html).toContain(label);
    }
  });

  test('a nestedGroup renders its inner field under a dotted group.field name', () => {
    const html = render(everyKindDef);
    expect(html).toContain('name="parent.parentName"');
    expect(html).toContain('Parent name');
  });

  test('labels project to the active locale (French)', () => {
    const html = render(everyKindDef, { lang: 'fr' });
    expect(html).toContain('Nom complet');
    expect(html).toContain('Genre');
    expect(html).not.toContain('Full name');
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
});

describe('FormFields renders a discriminated variant', () => {
  test('the discriminator renders both option labels', () => {
    const html = render(variantDef);
    expect(html).toContain('Attendee');
    expect(html).toContain('Exhibitor');
  });

  test('the selected branch renders its fields; the unselected branch does not', () => {
    const attendee = render(variantDef, { defaultValue: { type: 'attendee' } });
    expect(attendee).toContain('name="dateOfBirth"');
    expect(attendee).not.toContain('name="company"');

    const exhibitor = render(variantDef, {
      defaultValue: { type: 'exhibitor' },
    });
    expect(exhibitor).toContain('name="company"');
    expect(exhibitor).not.toContain('name="dateOfBirth"');
  });

  test('with no branch selected, neither branch field renders', () => {
    const html = render(variantDef);
    expect(html).not.toContain('name="dateOfBirth"');
    expect(html).not.toContain('name="company"');
  });
});

// The contact/volunteer `method`-gated `email`/`phone` (registration-launch
// BLOCKER 1): both fields are `optional: true` and a pair of `requiredWhenEquals`
// rules makes each required only when `method` is one of its trigger values. The
// hand-tuned forms rendered the gated field CONDITIONALLY, so an inactive field
// was ABSENT from the POST and its `optional: true` codec accepted the absence.
// The generic renderer must reproduce that conditional VISIBILITY — otherwise the
// always-rendered field POSTs a present blank (`phone=''`) its codec rejects as
// `requiredMessage`. These tests pin that a gated field appears only when its
// `when` value is active.
const methodGatedDef = asDefinition({
  title: text('F', 'F'),
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: text('Name', 'Nom'),
      requiredMessage: 'contact.form.name.required',
    },
    {
      _tag: 'literal',
      name: 'method',
      label: text('Method', 'Méthode'),
      options: [
        { value: 'email', label: text('Email', 'Courriel') },
        { value: 'phone', label: text('Phone', 'Téléphone') },
        { value: 'both', label: text('Both', 'Les deux') },
      ],
      requiredMessage: 'contact.form.contact-method.required',
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
      label: text('Phone', 'Téléphone'),
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

describe('FormFields gates requiredWhenEquals targets on their when-field', () => {
  test('method=email renders email, hides phone (so phone is absent from the POST)', () => {
    const html = render(methodGatedDef, { defaultValue: { method: 'email' } });
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="phone"');
  });

  test('method=phone renders phone, hides email', () => {
    const html = render(methodGatedDef, { defaultValue: { method: 'phone' } });
    expect(html).toContain('name="phone"');
    expect(html).not.toContain('name="email"');
  });

  test('method=both renders both gated fields', () => {
    const html = render(methodGatedDef, { defaultValue: { method: 'both' } });
    expect(html).toContain('name="email"');
    expect(html).toContain('name="phone"');
  });

  test('the always-present, ungated fields render regardless of method', () => {
    const html = render(methodGatedDef, { defaultValue: { method: 'phone' } });
    expect(html).toContain('name="name"');
    expect(html).toContain('name="method"');
  });
});
