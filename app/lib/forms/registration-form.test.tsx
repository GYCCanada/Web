import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { defaultRegistrationForm } from '~/lib/forms/defaults';
import { FormDefinition } from '~/lib/forms/definition';
import { Forms } from '~/lib/forms/forms.server';
import { newSubmissionCommandFields } from '~/lib/forms/submission-command';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import { RegistrationForm } from '~/routes/($lang)+/registration-form';

const command = newSubmissionCommandFields(
  Forms.FormDefinitionVersionId.make(`sha256:${'0'.repeat(64)}`),
);

const renderRegistration = (
  definition: FormDefinition,
  options: {
    readonly initialRegistrants?: ReadonlyArray<Record<string, unknown>>;
    readonly preview?: boolean;
  } = {},
): string => {
  const encoded = Schema.encodeSync(FormDefinition)(definition);
  const Stub = createRoutesStub([
    {
      path: ':lang?',
      Component: () => (
        <LocalizationProvider translation={root.en}>
          <RegistrationForm
            year={2026}
            definition={encoded}
            command={command}
            initialRegistrants={options.initialRegistrants}
            preview={options.preview}
          />
        </LocalizationProvider>
      ),
    },
  ]);
  return renderToString(<Stub initialEntries={['/']} />);
};

const names = (html: string): ReadonlySet<string> =>
  new Set([...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1] ?? ''));

describe('definition-driven Registration Form module', () => {
  test('renders a CMS-added field without a Registration route edit', () => {
    const definition = Schema.decodeUnknownSync(FormDefinition)({
      ...Schema.encodeSync(FormDefinition)(defaultRegistrationForm),
      fields: [
        ...Schema.encodeSync(FormDefinition)(defaultRegistrationForm).fields,
        {
          _tag: 'requiredText',
          name: 'emergencyContact',
          label: { en: 'Emergency contact', fr: "Contact d'urgence" },
          requiredMessage: 'registration.form.name.required',
        },
      ],
    });

    const html = renderRegistration(definition);
    expect(html).toContain('Emergency contact');
    expect(names(html).has('registrants[0].emergencyContact')).toBe(true);
  });

  test('prefixes the selected CMS variant under each Registrant', () => {
    const html = renderRegistration(defaultRegistrationForm, {
      initialRegistrants: [{ type: 'exhibitor' }],
    });
    const rendered = names(html);
    expect(rendered.has('registrants[0].type')).toBe(true);
    expect(rendered.has('registrants[0].company')).toBe(true);
    expect(rendered.has('registrants[0].synopsis')).toBe(true);
    expect(rendered.has('registrants[0].website')).toBe(true);
    expect(rendered.has('registrants[0].extra.tos')).toBe(false);
  });

  test('renders CMS-authored billing controls from the commerce shell', () => {
    const definition = Schema.decodeUnknownSync(FormDefinition)({
      ...Schema.encodeSync(FormDefinition)(defaultRegistrationForm),
      pricing: {
        currency: 'cad',
        base: 5000,
        registrationClosesAt: '2026-08-01T04:00:00.000Z',
        rules: [],
        windows: [],
      },
      party: {
        billingMode: {
          label: { en: 'How would you like to pay?', fr: 'Mode de paiement' },
          requiredMessage: 'registration.form.type.required',
          options: {
            group: { en: 'Pay for the group', fr: 'Payer le groupe' },
            perRegistrant: { en: 'Each registrant pays', fr: 'Paiement individuel' },
          },
        },
        payer: {
          label: { en: 'Group payer', fr: 'Payeur du groupe' },
          nameField: {
            label: { en: 'Payer name', fr: 'Nom du payeur' },
            requiredMessage: 'registration.form.name.required',
          },
          emailField: {
            label: { en: 'Payer email', fr: 'Courriel du payeur' },
            requiredMessage: 'registration.form.email.required',
            invalidMessage: 'registration.form.email.error',
          },
        },
      },
    });

    const html = renderRegistration(definition);
    expect(html).toContain('How would you like to pay?');
    expect(html).toContain('Pay for the group');
    expect(html).toContain('Each registrant pays');
  });

  test('preview renders the pinned definition but cannot submit', () => {
    const html = renderRegistration(defaultRegistrationForm, { preview: true });
    expect(html).toContain('Preview only');
    expect(html).toContain('disabled=""');
    expect(html).toContain('PREVIEW ONLY');
  });
});
