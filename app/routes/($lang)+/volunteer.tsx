import { Effect, Result, Schema } from 'effect';
import { InfoIcon } from 'lucide-react';
import { Form, type MetaFunction, useActionData, useLoaderData } from 'react-router';
import { match } from 'ts-pattern';

import { FormProvider, useForm, useFormData } from '~/lib/conform';
import { formValidationError } from '~/lib/effect/errors';
import { routeFormAction, SubmissionContext } from '~/lib/effect/form';
import { formatSchemaResult, parseSchema } from '~/lib/effect/form-schema';
import { routeHandler } from '~/lib/effect/route';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import type { TranslationKey } from '~/lib/localization/translations';
import { Mailer } from '~/lib/mailer.server';
import { Toast } from '~/lib/toast.server';
import { Button } from '~/ui/button';
import { FieldErrors, fieldErrorStyle } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

const Name = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.name.required' }),
);
const Email = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.email.required' }),
);
const Phone = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.phone.required' }),
);
const Age = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.age.required' }),
);
const Location = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.location.required' }),
);
const Background = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.background.required' }),
);
const Why = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.why.required' }),
);
// `positions` is a multi-checkbox group: when nothing is selected the form
// submits no `positions` field at all (unchecked checkboxes do not submit).
// Classic `parseWithZod` coerced that absent field to `[]`; replicate it with a
// decode-time default so an empty selection stays a valid submission.
const Positions = Schema.optionalKey(Schema.Array(Schema.String)).pipe(
  Schema.withDecodingDefault(Effect.succeed([] as string[])),
);

const schema = Schema.Union([
  Schema.Struct({
    name: Name,
    method: Schema.Literal('phone'),
    phone: Phone,
    age: Age,
    location: Location,
    background: Background,
    why: Why,
    positions: Positions,
  }),
  Schema.Struct({
    name: Name,
    method: Schema.Literal('email'),
    email: Email,
    age: Age,
    location: Location,
    background: Background,
    why: Why,
    positions: Positions,
  }),
  Schema.Struct({
    name: Name,
    method: Schema.Literal('both'),
    email: Email,
    phone: Phone,
    age: Age,
    location: Location,
    background: Background,
    why: Why,
    positions: Positions,
  }),
]);

const clientSchema = Schema.toStandardSchemaV1(schema);

export const meta: MetaFunction = ({ params }) => {
  const local = getLocale(params);

  if (local === 'fr') {
    return [
      { title: 'Bénévolat | GYCC' },
      { name: 'description', content: 'Bénévolez avec GYCC' },
    ];
  }

  return [
    { title: 'Volunteer | GYCC' },
    { name: 'description', content: 'Volunteer with GYCC' },
  ];
};

type Position = {
  title: string;
  tasks: string[];
  team: string;
};

export const loader = routeHandler(function* () {
  // No request-scoped data; `positions` is a static empty list.
  yield* Effect.void;
  return {
    positions: [] as Position[],
  };
});

export const action = routeFormAction(function* () {
  const { url } = yield* ReactRouterContext;
  const submission = yield* SubmissionContext;
  const mailer = yield* Mailer;
  const toast = yield* Toast;

  const parsed = parseSchema(schema, submission.payload);
  if (Result.isFailure(parsed)) {
    return yield* formValidationError(formatSchemaResult(parsed) ?? {});
  }
  const data = parsed.success;

  const result = yield* Effect.exit(
    mailer.send({
      subject: `[!] Volunteer Request from ${data.name}`,
      content: `Name: ${data.name}\n${match(data)
        .with({ method: 'email' }, (d) => `Email: ${d.email}`)
        .with({ method: 'phone' }, (d) => `Phone: ${d.phone}`)
        .with({ method: 'both' }, (d) => `Email: ${d.email}\nPhone: ${d.phone}`)
        .exhaustive()}
        \nMessage: ${data.why}
        \nBackground: ${data.background}
        \nAge: ${data.age}
        \nLocation: ${data.location}
        \nPositions: ${(data.positions ?? []).join(', ')}
        `,
    }),
  );
  if (result._tag === 'Failure') {
    yield* Effect.logError('Error sending email', result.cause);
    return yield* formValidationError({
      formErrors: ['contact.form.error'],
    });
  }

  return yield* toast.redirect(url.pathname, {
    description: 'volunteer.form.success.description' satisfies TranslationKey,
    title: 'volunteer.form.success.title' satisfies TranslationKey,
    type: 'success',
    form: 'volunteer',
  });
});

export default function Index() {
  const translate = useTranslate();
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { form, fields } = useForm(clientSchema, {
    id: 'volunteer',
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    defaultValue: {
      name: '',
      method: 'email',
      email: undefined,
      phone: undefined,
      age: '',
      location: '',
      positions: [] as string[],
      background: '',
      why: '',
    },
    lastResult: actionData?.result,
  });

  const method = useFormData(
    form.id,
    (formData) => formData.get(fields.method.name) ?? 'email',
    { fallback: 'email' },
  ) as 'email' | 'phone' | 'both';

  return (
    <Main className="gap-10 px-4 py-12 text-2xl md:gap-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">
          {translate('volunteer.title', {
            movement: (
              <span className="italic">
                {translate('volunteer.title.movement')}
              </span>
            ),
          })}
        </h1>
        <p>{translate('volunteer.subtitle')}</p>
      </div>

      <FormProvider context={form.context}>
        <Form
          method="POST"
          className="flex flex-col gap-4"
          {...form.props}
        >
          {data.positions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2>{translate('volunteer.directions')}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data.positions.map((position) => (
                  <div
                    key={position.title}
                    className="has-[input[checked]]:border-accent-600 flex flex-col gap-1.5 border-2 border-transparent"
                  >
                    <input
                      className="sr-only"
                      type="checkbox"
                      aria-label={position.title}
                      name={fields.positions.name}
                      value={position.title}
                    />
                    <h3 className="font-semibold">{position.title}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {position.tasks.map((task) => (
                        <li key={task}>{task}</li>
                      ))}
                    </ul>
                    <p className="flex items-center gap-2">
                      <InfoIcon />
                      {position.team}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <TextField name={fields.name.name}>
            <Label>{translate('volunteer.form.name.label')}</Label>
            <TextField.Input
              type="text"
              placeholder={
                translate('volunteer.form.name.placeholder') as string
              }
            />
            <FieldErrors />
          </TextField>

          <RadioGroup name={fields.method.name}>
            <Label>{translate('volunteer.form.method.label')}</Label>
            <Radios>
              <Radio value="phone">
                {translate('volunteer.form.method.phone')}
              </Radio>
              <Radio value="email">
                {translate('volunteer.form.method.email')}
              </Radio>
              <Radio value="both">
                {translate('volunteer.form.method.both')}
              </Radio>
            </Radios>
            <FieldErrors />
          </RadioGroup>
          {method === 'email' || method === 'both' ? (
            <TextField name={fields.email.name}>
              <Label>{translate('volunteer.form.email.label')}</Label>
              <TextField.Input
                type="email"
                placeholder={
                  translate('volunteer.form.email.placeholder') as string
                }
              />
              <FieldErrors />
            </TextField>
          ) : null}
          {method === 'phone' || method === 'both' ? (
            <TextField name={fields.phone.name}>
              <Label>{translate('volunteer.form.phone.label')}</Label>
              <TextField.Input
                type="tel"
                placeholder={
                  translate('volunteer.form.phone.placeholder') as string
                }
              />
              <FieldErrors />
            </TextField>
          ) : null}
          <TextField name={fields.age.name}>
            <Label>{translate('volunteer.form.age.label')}</Label>
            <TextField.Input
              type="number"
              placeholder={
                translate('volunteer.form.age.placeholder') as string
              }
            />
            <FieldErrors />
          </TextField>
          <TextField name={fields.location.name}>
            <Label>{translate('volunteer.form.location.label')}</Label>
            <TextField.Input
              type="text"
              placeholder={
                translate('volunteer.form.location.placeholder') as string
              }
            />
            <FieldErrors />
          </TextField>
          <TextField name={fields.background.name}>
            <Label>{translate('volunteer.form.background.label')}</Label>
            <TextField.TextArea
              rows={5}
              placeholder={
                translate('volunteer.form.background.placeholder') as string
              }
            />
            <FieldErrors />
          </TextField>
          <TextField name={fields.why.name}>
            <Label>{translate('volunteer.form.why.label')}</Label>
            <TextField.TextArea
              rows={5}
              placeholder={
                translate('volunteer.form.why.placeholder') as string
              }
            />
            <FieldErrors />
          </TextField>
          <div>
            <Button
              variant="accent"
              type="submit"
            >
              {translate('volunteer.form.submit')}
            </Button>
            {form.errors && form.errors.length > 0 ? (
              <p className={fieldErrorStyle}>
                {translate('volunteer.form.error')}
              </p>
            ) : null}
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
