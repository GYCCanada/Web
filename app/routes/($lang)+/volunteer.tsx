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
import { compileForm } from "~/lib/forms/compiled-form";
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
  const forms = yield* Forms.Service;
  // 404 when the volunteer page is disabled (Feature C); else project + load form.
  const page = yield* readPageView("volunteer", locale);
  const published = yield* forms.current("volunteer");
  return {
    page,
    definition: published.definition,
    command: newSubmissionCommandFields(published.version),
  };
});

export const action = formAction({
  form: "volunteer",
  page: "volunteer",
  success: {
    title: "volunteer.form.success.title",
    description: "volunteer.form.success.description",
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
  const compiled = React.useMemo(() => compileForm(definition), [definition]);
  const clientSchema = React.useMemo(
    () => Schema.toStandardSchemaV1(compiled.codec),
    [compiled],
  );

  const actionData = useActionData<typeof action>();
  const submissionCommand = resolveSubmissionCommandFields(
    command,
    actionData?.command,
  );
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
          <SubmissionCommandInputs {...submissionCommand} />
          <FormFields definition={compiled.renderModel} formId={f.id} />

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
