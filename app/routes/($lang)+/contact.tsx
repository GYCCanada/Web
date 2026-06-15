import { Effect, Result, Schema } from "effect";
import { Form, type MetaFunction, useActionData } from "react-router";
import { match } from "ts-pattern";

import { FormProvider, useForm, useFormData } from "~/lib/conform";
import { formValidationError } from "~/lib/effect/errors";
import { routeFormAction, SubmissionContext } from "~/lib/effect/form";
import { formatSchemaResult, parseSchema } from "~/lib/effect/form-schema";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { useTranslate } from "~/lib/localization/context";
import { getLocale } from "~/lib/localization/localization";
import type { TranslationKey } from "~/lib/localization/translations";
import { Mailer } from "~/lib/mailer.server";
import { Toast } from "~/lib/toast.server";
import { Button } from "~/ui/button";
import { ExternalLink } from "~/ui/external-link";
import { FieldErrors, fieldErrorStyle } from "~/ui/field-error";
import { Label } from "~/ui/label";
import { Main } from "~/ui/main";
import { Radio, RadioGroup, Radios } from "~/ui/radio";
import { TextField } from "~/ui/text-field";

// Match the previous zod `.email()` validation: a basic, permissive email shape.
const EMAIL_REGEXP = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `invalid_type_error` keys from the old zod schema fired when a field's
// submitted value was not a string (e.g. duplicate field names POST an array).
// Effect Schema surfaces that as an `InvalidType` issue; a node-level `message`
// annotation re-labels it with a translation key. Every message must be a real
// `TranslationKey` — `FieldErrors` renders it through `translate()`, so a key
// that is absent from `translations.ts` would render `undefined`. Fields that
// have a dedicated `.error` key use it; the rest reuse their `.required` key for
// the invalid-type case (the old zod schemas pointed those at `.error` keys that
// never existed, which rendered blank — reusing `.required` is the safe copy).
// `.annotateKey({ messageMissingKey })` covers the absent-field case (the old
// zod `required_error` fired for both empty and absent values); `.check` covers
// the empty-string case; the node-level `message` covers the invalid-type case.
const Name = Schema.String.annotate({ message: "contact.form.name.error" })
  .check(Schema.isMinLength(1, { message: "contact.form.name.required" }))
  .annotateKey({ messageMissingKey: "contact.form.name.required" });
const Message = Schema.String.annotate({
  message: "contact.form.message.required",
})
  .check(Schema.isMinLength(1, { message: "contact.form.message.required" }))
  .annotateKey({ messageMissingKey: "contact.form.message.required" });
const Email = Schema.String.check(
  Schema.isMinLength(1, { message: "contact.form.email.required" }),
  Schema.isPattern(EMAIL_REGEXP, { message: "contact.form.email.error" }),
);
const Phone = Schema.String.check(
  Schema.isMinLength(1, { message: "contact.form.phone.required" }),
);

// The discriminator. Modeled as a single `Literals` field rather than per-member
// `Schema.Literal`s inside a `Schema.Union`: a union whose members all fail
// reports one top-level union-mismatch message (Effect v4 behavior), so the
// discriminator error could not attach to the `method` field. As a struct field
// with `message` (invalid value) + `messageMissingKey` (absent) annotations, a
// missing or invalid `method` attributes cleanly to the `method` path — matching
// the old zod `discriminatedUnion` behavior that surfaced
// `contact.form.contact-method.required` on the method field.
const Method = Schema.Literals(["email", "phone", "both"])
  .annotate({ message: "contact.form.contact-method.required" })
  .annotateKey({ messageMissingKey: "contact.form.contact-method.required" });

// Per-method requirements (email when email/both, phone when phone/both) are
// expressed as a struct-level filter that attaches each issue to the relevant
// field path, replacing the per-member required fields the union encoded.
export const schema = Schema.Struct({
  method: Method,
  name: Name,
  message: Message,
  // Re-annotate the optional wrapper so a non-string (array) value still maps to
  // a translation key instead of the wrapper's union-mismatch text. `phone` has
  // no `.error` key, so reuse `.required` to keep real copy on screen.
  email: Schema.optional(Email).annotate({
    message: "contact.form.email.error",
  }),
  phone: Schema.optional(Phone).annotate({
    message: "contact.form.phone.required",
  }),
}).check(
  Schema.makeFilter((value) => {
    const issues: Array<{ path: ReadonlyArray<PropertyKey>; issue: string }> =
      [];
    if (
      (value.method === "email" || value.method === "both") &&
      value.email === undefined
    ) {
      issues.push({ path: ["email"], issue: "contact.form.email.required" });
    }
    if (
      (value.method === "phone" || value.method === "both") &&
      value.phone === undefined
    ) {
      issues.push({ path: ["phone"], issue: "contact.form.phone.required" });
    }
    return issues.length === 0 ? undefined : issues;
  }),
);

const clientSchema = Schema.toStandardSchemaV1(schema);

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);

  if (locale === "fr") {
    return [
      { title: "Contactez-nous | GYCC" },
      {
        name: "description",
        content: "Contactez-nous pour plus d'informations",
      },
    ];
  }

  return [
    { title: "Contact Us | GYCC" },
    { name: "description", content: "Contact us for more information" },
  ];
};

export const action = routeFormAction(function* () {
  const { url } = yield* ReactRouterContext;
  const submission = yield* SubmissionContext;
  const mailer = yield* Mailer.Service;
  const toast = yield* Toast;

  const parsed = parseSchema(schema, submission.payload);
  if (Result.isFailure(parsed)) {
    return yield* formValidationError(formatSchemaResult(parsed) ?? {});
  }
  const data = parsed.success;

  const result = yield* Effect.exit(
    mailer.send({
      subject: `[!] Contact Inquiry from ${data.name}`,
      content: `Name: ${data.name}\n${match(data)
        .with(
          {
            method: "email",
          },
          (d) => `Email: ${d.email}`,
        )
        .with({ method: "phone" }, (d) => `Phone: ${d.phone}`)
        .with({ method: "both" }, (d) => `Email: ${d.email}\nPhone: ${d.phone}`)
        .exhaustive()}\nMessage: ${data.message}`,
    }),
  );
  if (result._tag === "Failure") {
    yield* Effect.logError("Error sending email", result.cause);
    return yield* formValidationError({
      formErrors: ["contact.form.error"],
    });
  }

  return yield* toast.redirect(url.pathname, {
    description: "contact.form.success.description" satisfies TranslationKey,
    title: "contact.form.success.title" satisfies TranslationKey,
    type: "success",
    form: "contact",
  });
});

export default function Index() {
  const translate = useTranslate();
  const actionData = useActionData<typeof action>();
  const { form: f, fields } = useForm(clientSchema, {
    id: "contact",
    shouldValidate: "onSubmit",
    shouldRevalidate: "onInput",
    lastResult: actionData?.result,
    defaultValue: {
      method: "email",
      name: "",
      email: undefined,
      phone: undefined,
      message: "",
    },
  });

  const method = useFormData(
    f.id,
    (formData) => formData.get(fields.method.name) ?? "email",
    { fallback: "email" },
  ) as "email" | "phone" | "both";

  return (
    <Main className="gap-10 px-3 py-4 text-2xl md:py-16 md:px-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">{translate("contact.title")}</h1>
        <p>
          {translate("contact.directions", {
            email: (
              <ExternalLink href="mailto:hello@gyccanada.org">
                hello@gyccanada.org
              </ExternalLink>
            ),
          })}
        </p>
      </div>

      <FormProvider context={f.context}>
        <Form className="flex flex-col gap-4" method="POST" {...f.props}>
          <TextField name={fields.name.name}>
            <Label>{translate("contact.form.name")}</Label>
            <TextField.Input
              placeholder={translate("contact.form.name.placeholder") as string}
            />
            <FieldErrors />
          </TextField>

          <RadioGroup name={fields.method.name} defaultValue="both">
            <Label>{translate("contact.form.contact-method")}</Label>
            <Radios>
              <Radio value="email">
                {translate("contact.form.contact-method.email")}
              </Radio>
              <Radio value="phone">
                {translate("contact.form.contact-method.phone")}
              </Radio>
              <Radio value="both">
                {translate("contact.form.contact-method.both")}
              </Radio>
            </Radios>
            <FieldErrors />
          </RadioGroup>

          {method === "email" || method === "both" ? (
            <TextField name={fields.email.name}>
              <Label>{translate("contact.form.email")}</Label>
              <TextField.Input
                type="email"
                placeholder={
                  translate("contact.form.email.placeholder") as string
                }
              />
              <FieldErrors />
            </TextField>
          ) : null}

          {method === "phone" || method === "both" ? (
            <TextField name={fields.phone.name}>
              <Label>{translate("contact.form.phone")}</Label>
              <TextField.Input
                type="tel"
                placeholder={
                  translate("contact.form.phone.placeholder") as string
                }
              />
              <FieldErrors />
            </TextField>
          ) : null}

          <TextField name={fields.message.name}>
            <Label>{translate("contact.form.message")}</Label>
            <TextField.TextArea
              rows={5}
              placeholder={
                translate("contact.form.message.placeholder") as string
              }
            />
            <FieldErrors />
          </TextField>

          <div>
            <Button type="submit" variant="accent">
              {translate("contact.form.submit")}
            </Button>
            {f.errors && f.errors.length > 0 ? (
              <p className={fieldErrorStyle}>
                {translate("contact.form.error")}
              </p>
            ) : null}
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
