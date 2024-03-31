import { FormProvider, FormStateInput, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Form, redirect, useActionData } from '@remix-run/react';
import { useTranslate } from '~/lib/localization/context';
import { sendMail } from '~/lib/mailer.server';
import { Button } from '~/ui/button';
import { ExternalLink } from '~/ui/external-link';
import { FieldErrors, fieldErrorStyle } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';
import { match } from 'ts-pattern';
import { z } from 'zod';

export const schema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('email', {
      invalid_type_error: 'contact.form.contact-method.required',
      required_error: 'contact.form.contact-method.required',
    }),
    email: z
      .string({
        required_error: 'contact.form.email.required',
        invalid_type_error: 'contact.form.email.error',
      })
      .email({
        message: 'contact.form.email.error',
      }),
    name: z.string({
      required_error: 'contact.form.name.required',
      invalid_type_error: 'contact.form.name.error',
    }),
    message: z.string({
      required_error: 'contact.form.message.required',
    }),
  }),
  z.object({
    method: z.literal('phone', {
      invalid_type_error: 'contact.form.contact-method.required',
      required_error: 'contact.form.contact-method.required',
    }),
    phone: z.string({
      required_error: 'contact.form.phone.required',
    }),
    name: z.string({
      required_error: 'contact.form.name.required',
      invalid_type_error: 'contact.form.name.error',
    }),
    message: z.string({
      required_error: 'contact.form.message.required',
    }),
  }),
  z.object({
    method: z.literal('both'),
    email: z
      .string({
        required_error: 'contact.form.email.required',
        invalid_type_error: 'contact.form.email.error',
      })
      .email({
        message: 'contact.form.email.error',
      }),
    phone: z.string({
      required_error: 'contact.form.phone.required',
    }),
    name: z.string({
      required_error: 'contact.form.name.required',
      invalid_type_error: 'contact.form.name.error',
    }),
    message: z.string({
      required_error: 'contact.form.message.required',
    }),
  }),
]);

export const meta: MetaFunction = () => {
  return [
    { title: 'Contact Us | GYCC' },
    { name: 'description', content: 'Contact us for more information' },
  ];
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const data = submission.payload;

  try {
    await sendMail({
      subject: `[!] Contact Inquiry from ${data.name}`,
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
}

export default function Index() {
  const translate = useTranslate();
  const lastResult = useActionData<typeof action>();
  const [f, fields] = useForm({
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema });
    },
    defaultValue: {
      method: 'email',
      name: '',
      email: undefined,
      phone: undefined,
      message: '',
    },
  });

  const method = fields.method.value as 'email' | 'phone' | 'both';

  return (
    <Main className="gap-10 px-3 py-4 md:py-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">{translate('contact.title')}</h1>
        <p>
          {translate('contact.directions', {
            email: (
              <ExternalLink href="mailto:hello@gyccanada.org">
                hello@gyccanada.org
              </ExternalLink>
            ),
          })}
        </p>
      </div>

      <FormProvider context={f.context}>
        <Form
          className="flex flex-col gap-4"
          method="POST"
          id={f.id}
          onSubmit={f.onSubmit}
        >
          <FormStateInput />
          <TextField name={fields.name.name}>
            <Label>{translate('contact.form.name')}</Label>
            <TextField.Input
              placeholder={translate('contact.form.name.placeholder') as string}
            />
            <FieldErrors errors={fields.name.errors} />
          </TextField>

          <RadioGroup name={fields.method.name} defaultValue="both">
            <Label>{translate('contact.form.contact-method')}</Label>
            <Radios>
              <Radio value="email">
                {translate('contact.form.contact-method.email')}
              </Radio>
              <Radio value="phone">
                {translate('contact.form.contact-method.phone')}
              </Radio>
              <Radio value="both">
                {translate('contact.form.contact-method.both')}
              </Radio>
            </Radios>
            <FieldErrors errors={fields.method.errors} />
          </RadioGroup>

          {method === 'email' || method === 'both' ? (
            <TextField name={fields.email.name}>
              <Label>{translate('contact.form.email')}</Label>
              <TextField.Input
                type="email"
                placeholder={
                  translate('contact.form.email.placeholder') as string
                }
              />
              <FieldErrors errors={fields.email.errors} />
            </TextField>
          ) : null}

          {method === 'phone' || method === 'both' ? (
            <TextField name={fields.phone.name}>
              <Label>{translate('contact.form.phone')}</Label>
              <TextField.Input
                type="tel"
                placeholder={
                  translate('contact.form.phone.placeholder') as string
                }
              />
              <FieldErrors errors={fields.phone.errors} />
            </TextField>
          ) : null}

          <TextField name={fields.message.name}>
            <Label>{translate('contact.form.message')}</Label>
            <TextField.TextArea
              rows={5}
              placeholder={
                translate('contact.form.message.placeholder') as string
              }
            />
            <FieldErrors errors={fields.message.errors} />
          </TextField>

          <div>
            <Button type="submit" variant="accent">
              {translate('contact.form.submit')}
            </Button>
            {f.errors && f.errors.length > 0 ? (
              <p className={fieldErrorStyle}>
                {translate('contact.form.error')}
              </p>
            ) : null}
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
