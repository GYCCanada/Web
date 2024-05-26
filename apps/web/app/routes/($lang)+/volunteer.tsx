import {
  FormProvider,
  FormStateInput,
  getCollectionProps,
  useForm,
} from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Form, redirect, useActionData, useLoaderData } from '@remix-run/react';
import { InfoIcon } from 'lucide-react';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { sendMail } from '~/lib/mailer.server';
import { Button } from '~/ui/button';
import { FieldErrors, fieldErrorStyle } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

const schema = z.discriminatedUnion('method', [
  z.object({
    name: z.string({
      required_error: 'volunteer.form.name.required',
      invalid_type_error: 'volunteer.form.name.error',
    }),
    method: z.literal('phone', {
      required_error: 'volunteer.form.method.required',
    }),
    phone: z.string({
      required_error: 'volunteer.form.phone.required',
    }),
    age: z.string({
      required_error: 'volunteer.form.age.required',
      invalid_type_error: 'volunteer.form.age.error',
    }),
    location: z.string({
      required_error: 'volunteer.form.location.required',
      invalid_type_error: 'volunteer.form.location.error',
    }),
    background: z.string({
      required_error: 'volunteer.form.background.required',
      invalid_type_error: 'volunteer.form.background.error',
    }),
    why: z.string({
      required_error: 'volunteer.form.why.required',
      invalid_type_error: 'volunteer.form.why.error',
    }),
    positions: z.array(z.string()),
  }),
  z.object({
    name: z.string({
      required_error: 'volunteer.form.name.required',
      invalid_type_error: 'volunteer.form.name.error',
    }),
    method: z.literal('email', {
      required_error: 'volunteer.form.method.required',
    }),
    email: z.string({
      required_error: 'volunteer.form.email.required',
      invalid_type_error: 'volunteer.form.email.error',
    }),
    age: z.string({
      required_error: 'volunteer.form.age.required',
      invalid_type_error: 'volunteer.form.age.error',
    }),
    location: z.string({
      required_error: 'volunteer.form.location.required',
      invalid_type_error: 'volunteer.form.location.error',
    }),
    background: z.string({
      required_error: 'volunteer.form.background.required',
      invalid_type_error: 'volunteer.form.background.error',
    }),
    why: z.string({
      required_error: 'volunteer.form.why.required',
      invalid_type_error: 'volunteer.form.why.error',
    }),
    positions: z.array(z.string()),
  }),
  z.object({
    name: z.string({
      required_error: 'volunteer.form.name.required',
      invalid_type_error: 'volunteer.form.name.error',
    }),
    method: z.literal('both', {
      required_error: 'volunteer.form.method.required',
    }),
    email: z.string({
      required_error: 'volunteer.form.email.required',
      invalid_type_error: 'volunteer.form.email.error',
    }),
    phone: z.string({
      required_error: 'volunteer.form.phone.required',
    }),
    age: z.string({
      required_error: 'volunteer.form.age.required',
      invalid_type_error: 'volunteer.form.age.error',
    }),
    location: z.string({
      required_error: 'volunteer.form.location.required',
      invalid_type_error: 'volunteer.form.location.error',
    }),
    background: z.string({
      required_error: 'volunteer.form.background.required',
      invalid_type_error: 'volunteer.form.background.error',
    }),
    why: z.string({
      required_error: 'volunteer.form.why.required',
      invalid_type_error: 'volunteer.form.why.error',
    }),
    positions: z.array(z.string()),
  }),
]);

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

export const loader = () => {
  return {
    positions: [] as Position[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const data = submission.payload;

  try {
    await sendMail({
      subject: `[!] Volunteer Request from ${data.name}`,
      content: `Name: ${data.name}\n${match(
        data.method as 'email' | 'phone' | 'both',
      )
        .with('email', () => `Email: ${data.email}`)
        .with('phone', () => `Phone: ${data.phone}`)
        .with(
          'both',
          () => `Email: ${data.email}\nPhone: ${data.phone}`,
        )}\nMessage: ${data.message}`,
    });
  } catch (error) {
    console.error('Error sending email', error);
    return submission.reply({
      formErrors: ['contact.form.error'],
    });
  }

  return redirect(new URL(request.url).pathname);
};

export default function Index() {
  const translate = useTranslate();
  const data = useLoaderData<typeof loader>();
  const lastResult = useActionData<typeof action>();
  const [form, fields] = useForm({
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
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema });
    },
  });

  const method = fields.method.value;

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
          id={form.id}
          onSubmit={form.onSubmit}
        >
          <FormStateInput />
          {data.positions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2>{translate('volunteer.directions')}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {getCollectionProps(fields.positions, {
                  type: 'checkbox',
                  options: data.positions.map((p) => p.title),
                }).map((props, i) => {
                  const position = data.positions[i];
                  return (
                    <div
                      key={position.title}
                      className="has-[input[checked]]:border-accent-600 flex flex-col gap-1.5 border-2 border-transparent"
                    >
                      <input
                        className="sr-only"
                        aria-label={position.title}
                        {...props}
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
                  );
                })}
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
            <Button variant="accent" type="submit">
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
