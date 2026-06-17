import * as React from "react";
import { Effect, Schema } from "effect";
import {
  Form,
  type MetaFunction,
  useActionData,
  useLoaderData,
} from "react-router";

import { Content } from "~/lib/content.server";
import { FormProvider, useForm } from "~/lib/conform";
import { definitionToSchema, type DecodedForm } from "~/lib/forms/decode";
import { FormDefinition } from "~/lib/forms/definition";
import { FormFields } from "~/lib/forms/render";
import { formAction } from "~/lib/forms/action";
import { formValidationError } from "~/lib/effect/errors";
import { routeHandler } from "~/lib/effect/route";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { useTranslate } from "~/lib/localization/context";
import { getLocale } from "~/lib/localization/localization";
import { toContactView } from "~/lib/content/pages/project";
import { Mailer } from "~/lib/mailer.server";
import { Button } from "~/ui/button";
import { fieldErrorStyle } from "~/ui/field-error";
import { Main } from "~/ui/main";
import { RichText } from "~/ui/rich-text";

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

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  return {
    page: toContactView(yield* content.getPage("contact"), locale),
    definition: yield* content.getForm("contact"),
  };
});

// The string value of one decoded field, or `''` when absent — the decoder has
// already proven these fields' types, so reading them off the generic
// `DecodedForm` record is a projection, not re-validation (`boundary-discipline`).
const str = (decoded: DecodedForm, name: string): string => {
  const value = decoded[name];
  return typeof value === "string" ? value : "";
};

/**
 * The method-specific contact line — email, phone, or both — mirroring the
 * hand-tuned action's `ts-pattern` match. The cross-field rules guarantee the
 * gated field is present, so the omitted branches never produce a blank line in
 * practice; a defensive empty string keeps the body well-formed either way.
 */
const contactLine = (decoded: DecodedForm): string => {
  const method = str(decoded, "method");
  const email = `Email: ${str(decoded, "email")}`;
  const phone = `Phone: ${str(decoded, "phone")}`;
  if (method === "phone") return phone;
  if (method === "both") return `${email}\n${phone}`;
  return email;
};

// The contact action is the generic skeleton (Branch 6.2; persist-then-notify
// wired in Branch 7.3): `Content.getForm` → `decodeForm` → `Submissions.persist`
// → `notify` → `toast.redirect`. The form-specific part is the notification — the
// same mailer body the hand-tuned action built, now over the PERSISTED record's
// payload (the durable `submissions/contact/<id>.json` object is already written
// when `notify` runs, so a mailer failure cannot lose the record).
export const action = formAction({
  form: "contact",
  notify: (submission) =>
    Effect.gen(function* () {
      const decoded = submission.payload;
      const mailer = yield* Mailer.Service;
      const name = str(decoded, "name");
      const result = yield* Effect.exit(
        mailer.send({
          subject: `[!] Contact Inquiry from ${name}`,
          content: `Name: ${name}\n${contactLine(decoded)}\nMessage: ${str(
            decoded,
            "message",
          )}`,
        }),
      );
      if (result._tag === "Failure") {
        yield* Effect.logError("Error sending email", result.cause);
        return yield* formValidationError({
          formErrors: ["contact.form.error"],
        });
      }
    }),
  success: {
    title: "contact.form.success.title",
    description: "contact.form.success.description",
  },
});

export default function Index() {
  const translate = useTranslate();
  const { page, definition: encodedDefinition } =
    useLoaderData<typeof loader>();

  // The loader JSON crossed a boundary; re-decode it through `FormDefinition` so
  // the client schema is built from a branded definition (`boundary-discipline`).
  const definition = React.useMemo(
    () => Schema.decodeUnknownSync(FormDefinition)(encodedDefinition),
    [encodedDefinition],
  );
  const clientSchema = React.useMemo(
    () => Schema.toStandardSchemaV1(definitionToSchema(definition)),
    [definition],
  );

  const actionData = useActionData<typeof action>();
  const { form: f } = useForm(clientSchema, {
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

  return (
    <Main className="gap-10 px-3 py-4 text-2xl md:py-16 md:px-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">{page.title}</h1>
        <p>
          <RichText runs={page.directions} />
        </p>
      </div>

      <FormProvider context={f.context}>
        <Form className="flex flex-col gap-4" method="POST" {...f.props}>
          <FormFields definition={definition} formId={f.id} />

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
