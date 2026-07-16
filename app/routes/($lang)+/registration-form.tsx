import type { SubmissionResult } from '@conform-to/react/future';
import { Schema } from 'effect';
import * as React from 'react';
import { Form } from 'react-router';

import { FormProvider, useForm, useFormData } from '~/lib/conform';
import { FormDefinition } from '~/lib/forms/definition';
import { compileForm } from '~/lib/forms/compiled-form';
import { FormFields } from '~/lib/forms/render';
import {
  SubmissionCommandInputs,
  type SubmissionCommandFields,
} from '~/lib/forms/submission-command';
import { useLocale, useTranslate } from '~/lib/localization/context';
import { Button } from '~/ui/button';
import { FieldErrors } from '~/ui/field-error';
import { HoneypotField } from '~/ui/honeypot-field';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

const PartyInput = Schema.Struct({
  _tag: Schema.optional(Schema.Literals(['group', 'perRegistrant'])),
  payer: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
    }),
  ),
});

const DynamicRegistrantInput = Schema.Record(Schema.String, Schema.Unknown);

const RegistrationFormShape = Schema.Struct({
  party: Schema.optional(PartyInput),
  registrants: Schema.mutable(Schema.Array(DynamicRegistrantInput)),
});

const makeRegistrationStandardSchema = (definition: FormDefinition) => {
  const schema = Schema.Struct({
    party: Schema.optional(PartyInput),
    registrants: Schema.mutable(
      Schema.Array(compileForm(definition).codec),
    ).annotateKey({ messageMissingKey: 'registration.form.type.required' }),
  });
  return Schema.toStandardSchemaV1(schema) as unknown as ReturnType<
    typeof Schema.toStandardSchemaV1<typeof RegistrationFormShape>
  >;
};

/** A new Registrant starts empty; the published Form definition owns every field. */
export const makeDefaultRegistrant = (): Record<string, unknown> => ({});

export function RegistrationForm({
  year,
  definition: encodedDefinition,
  command,
  initialRegistrants,
  actionData,
  preview = false,
}: {
  year: number;
  definition: typeof FormDefinition.Encoded;
  command: SubmissionCommandFields;
  initialRegistrants?: ReadonlyArray<Record<string, unknown>>;
  actionData?: SubmissionResult<string[]> | null;
  preview?: boolean;
}) {
  const translate = useTranslate();
  const locale = useLocale();
  const definition = React.useMemo(
    () => Schema.decodeUnknownSync(FormDefinition)(encodedDefinition),
    [encodedDefinition],
  );
  const standardSchema = React.useMemo(
    () => makeRegistrationStandardSchema(definition),
    [definition],
  );
  const seedRegistrants = initialRegistrants ?? [makeDefaultRegistrant()];
  const billingModes = definition.party
    ? (Object.keys(definition.party.billingMode.options) as Array<
        'group' | 'perRegistrant'
      >)
    : [];
  const defaultBillingMode = billingModes[0];
  const { form, fields, intent } = useForm(standardSchema, {
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    defaultValue: {
      party:
        defaultBillingMode === undefined
          ? undefined
          : {
              _tag: defaultBillingMode,
              payer:
                defaultBillingMode === 'group'
                  ? { name: '', email: '' }
                  : undefined,
            },
      registrants: [...seedRegistrants],
    },
    lastResult: actionData,
  });
  const registrants = fields.registrants.getFieldList();
  const party = fields.party.getFieldset();
  const payer = party.payer.getFieldset();
  const billingMode = useFormData(
    form.id,
    (formData) => formData.get(party._tag.name),
    { fallback: defaultBillingMode ?? null },
  );

  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1>{definition.title[locale] || translate('registration.form.title', { year })}</h1>
      {definition.intro ? (
        <p className="text-base leading-7 text-neutral-700">{definition.intro[locale]}</p>
      ) : null}
      {preview ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-base font-medium text-amber-950">
          Preview only — submissions and payments are disabled until the channel is open.
        </p>
      ) : null}
      <FormProvider context={form.context}>
        <Form method="POST" className="flex flex-col gap-6" {...form.props}>
          <SubmissionCommandInputs {...command} />
          <HoneypotField />
          {definition.party === undefined ? null : (
            <fieldset className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4">
              <legend className="px-2 text-xl font-semibold">
                {definition.party.billingMode.label[locale]}
              </legend>
              {definition.party.intro ? (
                <p className="text-base text-neutral-700">{definition.party.intro[locale]}</p>
              ) : null}
              <RadioGroup name={party._tag.name}>
                <Radios>
                  {billingModes.map((mode) => (
                    <Radio key={mode} value={mode}>
                      {definition.party?.billingMode.options[mode]?.[locale]}
                    </Radio>
                  ))}
                </Radios>
                <FieldErrors />
              </RadioGroup>
              {billingMode === 'group' && definition.party.payer ? (
                <fieldset className="flex flex-col gap-4">
                  <legend className="text-lg font-semibold">
                    {definition.party.payer.label[locale]}
                  </legend>
                  <TextField name={payer.name.name}>
                    <Label>{definition.party.payer.nameField.label[locale]}</Label>
                    <TextField.Input />
                    <FieldErrors />
                  </TextField>
                  <TextField name={payer.email.name}>
                    <Label>{definition.party.payer.emailField.label[locale]}</Label>
                    <TextField.Input type="email" />
                    <FieldErrors />
                  </TextField>
                </fieldset>
              ) : null}
            </fieldset>
          )}
          {registrants.map((registrant, index) => (
            <fieldset
              key={registrant.key}
              className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4"
            >
              <legend className="px-2 text-lg font-semibold">
                Registrant {index + 1}
              </legend>
              <FormFields
                definition={definition}
                formId={form.id}
                namePrefix={`${registrant.name}.`}
                includeHoneypot={false}
              />
              {registrants.length > 1 ? (
                <div>
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => intent.remove({ name: fields.registrants.name, index })}
                  >
                    Remove registrant
                  </Button>
                </div>
              ) : null}
            </fieldset>
          ))}
          <div>
            <Button
              type="button"
              onClick={() => intent.insert({ name: fields.registrants.name })}
            >
              {translate('registration.form.add-registrant')}
            </Button>
          </div>
          <div>
            <Button type="submit" disabled={preview}>
              {preview ? 'PREVIEW ONLY' : translate('registration.form.submit')}
            </Button>
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
