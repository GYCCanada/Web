import * as React from "react";
import { Schema } from "effect";
import {
  Form,
  type MetaFunction,
  useActionData,
  useLoaderData,
} from "react-router";

import { readPageView } from "~/lib/content/pages/pages.server";
import { FormProvider, useForm } from "~/lib/conform";
import { definitionToSchema } from "~/lib/forms/decode";
import { FormDefinition } from "~/lib/forms/definition";
import { Forms } from "~/lib/forms/forms.server";
import { FormFields } from "~/lib/forms/render";
import {
  newSubmissionCommandFields,
  resolveSubmissionCommandFields,
  SubmissionCommandInputs,
} from "~/lib/forms/submission-command";
import { formAction } from "~/lib/forms/action";
import { routeHandler } from "~/lib/effect/route";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { useTranslate } from "~/lib/localization/context";
import { getLocale } from "~/lib/localization/localization";
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
  const forms = yield* Forms.Service;
  // 404 when the contact page is disabled (Feature C); else project + load the form.
  const page = yield* readPageView("contact", locale);
  const published = yield* forms.current("contact");
  return {
    page,
    definition: published.definition,
    command: newSubmissionCommandFields(published.version),
  };
});

export const action = formAction({
  form: "contact",
  page: "contact",
  success: {
    title: "contact.form.success.title",
    description: "contact.form.success.description",
  },
});

export default function Index() {
  const translate = useTranslate();
  const { page, definition: encodedDefinition, command } =
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
  const submissionCommand = resolveSubmissionCommandFields(
    command,
    actionData?.command,
  );
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
          <SubmissionCommandInputs {...submissionCommand} />
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
