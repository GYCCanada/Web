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
import { toVolunteerView } from "~/lib/content/pages/project";
import { Mailer } from "~/lib/mailer.server";
import { Button } from "~/ui/button";
import { fieldErrorStyle } from "~/ui/field-error";
import { Main } from "~/ui/main";
import { RichText } from "~/ui/rich-text";

export const meta: MetaFunction = ({ params }) => {
  const local = getLocale(params);

  if (local === "fr") {
    return [
      { title: "Bénévolat | GYCC" },
      { name: "description", content: "Bénévolez avec GYCC" },
    ];
  }

  return [
    { title: "Volunteer | GYCC" },
    { name: "description", content: "Volunteer with GYCC" },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  return {
    page: toVolunteerView(yield* content.getPage("volunteer"), locale),
    definition: yield* content.getForm("volunteer"),
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

/**
 * The vestigial `positions` line: the pre-migration form never populated
 * `data.positions` (a hardcoded `[]`), so its checkbox block never rendered and
 * the field was never submitted. The engine definition therefore carries no
 * `positions` field; this reads it defensively off the decoded payload (always
 * absent → `[]`) so the notification's `Positions:` line stays byte-identical to
 * the old action's always-empty output.
 */
const positionsLine = (decoded: DecodedForm): string => {
  const value = decoded["positions"];
  const positions = Array.isArray(value) ? value : [];
  return positions.join(", ");
};

// The volunteer action is the generic skeleton (Branch 6.2): `Content.getForm` →
// `decodeForm` → `notify` → `toast.redirect`. The form-specific part is the
// notification — the same mailer body the hand-tuned action built, now over the
// engine's decoded payload.
export const action = formAction({
  form: "volunteer",
  notify: (decoded) =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service;
      const name = str(decoded, "name");
      const result = yield* Effect.exit(
        mailer.send({
          subject: `[!] Volunteer Request from ${name}`,
          content: `Name: ${name}\n${contactLine(decoded)}
        \nMessage: ${str(decoded, "why")}
        \nBackground: ${str(decoded, "background")}
        \nAge: ${str(decoded, "age")}
        \nLocation: ${str(decoded, "location")}
        \nPositions: ${positionsLine(decoded)}
        `,
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
    title: "volunteer.form.success.title",
    description: "volunteer.form.success.description",
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
    id: "volunteer",
    shouldValidate: "onSubmit",
    shouldRevalidate: "onInput",
    lastResult: actionData?.result,
    defaultValue: {
      name: "",
      method: "email",
      email: undefined,
      phone: undefined,
      age: "",
      location: "",
      background: "",
      why: "",
    },
  });

  return (
    <Main className="gap-10 px-4 py-12 text-2xl md:gap-16 md:px-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">
          <RichText runs={page.title} />
        </h1>
        <p>{page.subtitle}</p>
      </div>

      <FormProvider context={f.context}>
        <Form className="flex flex-col gap-4" method="POST" {...f.props}>
          <FormFields definition={definition} formId={f.id} />

          <div>
            <Button variant="accent" type="submit">
              {translate("volunteer.form.submit")}
            </Button>
            {f.errors && f.errors.length > 0 ? (
              <p className={fieldErrorStyle}>
                {translate("volunteer.form.error")}
              </p>
            ) : null}
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
