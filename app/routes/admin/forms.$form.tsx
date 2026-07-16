import { Effect, Option, Result, Schema } from "effect";
import { useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminRequest } from "~/lib/admin-auth.server";
import {
  adminFlashStatus,
  adminMeta,
  adminRedirectWithStatus,
  adminSecurityHeaders,
} from "~/lib/admin-headers";
import { ConferenceSlug } from "~/lib/content/schema";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { routeAction, routeHandler } from "~/lib/effect/route";
import { applyCommand } from "~/lib/forms/form-authoring";
import { parseAuthoringCommand } from "~/lib/forms/form-authoring-http";
import { FormDefinition, FormId } from "~/lib/forms/definition";
import { Forms } from "~/lib/forms/forms.server";
import { Registrar } from "~/lib/registration/registrar.server";
import {
  AdminFormAuthoring,
  type AdminFormAuthoringAction,
} from "~/ui/admin-form-authoring";

export const meta = adminMeta;
export const headers = adminSecurityHeaders;

const DEFAULT_TIME_ZONE = "America/Toronto";
const decodeFormId = Schema.decodeUnknownOption(FormId);
const decodeVersion = Schema.decodeUnknownResult(Forms.FormDefinitionVersionId);
const encodeDefinition = Schema.encodeUnknownEffect(FormDefinition);

const failure = (status: number, error: string, issues: readonly string[] = []): Response =>
  Response.json({ ok: false, error, issues }, { status });

const requireFormId = Effect.fn("admin/forms.requireFormId")(function* () {
  const { params } = yield* ReactRouterContext;
  const form = decodeFormId(params["form"]);
  if (Option.isNone(form)) {
    return yield* Effect.fail(new Response("Not Found", { status: 404 }));
  }
  return form.value;
});

export const loader = routeHandler(function* () {
  yield* requireAdminRequest();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const published = yield* (yield* Forms.Service).current(form);
  const definition = yield* encodeDefinition(published.definition);
  let timeZone = DEFAULT_TIME_ZONE;
  if (form === "registration") {
    const channel = yield* (yield* Registrar.Service)
      .get(ConferenceSlug.make("/2026"))
      .pipe(Effect.result);
    if (
      Result.isSuccess(channel) &&
      (channel.success.state === "preview" ||
        channel.success.state === "open" ||
        channel.success.state === "draining")
    ) {
      timeZone = channel.success.timeZone;
    }
  }
  return {
    form,
    version: published.version,
    definition,
    timeZone,
    status: adminFlashStatus(request),
  };
});

export const action = routeAction(function* () {
  yield* requireAdminRequest();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const submitted = yield* Effect.promise(() => request.formData());
  const expected = decodeVersion(submitted.get("expectedCurrentVersion"));
  if (Result.isFailure(expected)) {
    return failure(400, "The loaded Form version is missing or invalid. Reload and try again.");
  }
  const parsed = parseAuthoringCommand(submitted, form);
  if (Result.isFailure(parsed)) {
    return failure(400, "The Form authoring command is invalid.", parsed.failure);
  }
  const forms = yield* Forms.Service;
  const current = yield* forms.current(form);
  const applied = applyCommand(current.definition, parsed.success);
  if (Result.isFailure(applied)) {
    return failure(400, "The Form definition is not publishable.", applied.failure);
  }
  const published = yield* forms
    .publish({
      form,
      expectedCurrentVersion: Option.some(expected.success),
      definition: applied.success,
    })
    .pipe(Effect.result);
  if (Result.isSuccess(published)) {
    return adminRedirectWithStatus(
      `/admin/forms/${form}`,
      `Published version ${published.success.version}.`,
    );
  }
  const error = published.failure;
  if (Forms.DefinitionRejected.is(error)) {
    return failure(400, "The Form definition is not publishable.", error.issues);
  }
  if (Forms.PublishConflict.is(error)) {
    return failure(
      409,
      "This Form changed after you opened it. Reload before publishing your edits.",
    );
  }
  return failure(500, "The Form could not be published.");
});

export default function AdminFormEditor() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<AdminFormAuthoringAction>();
  return (
    <AdminFormAuthoring
      {...data}
      actionData={actionData}
      publishing={useNavigation().state === "submitting"}
    />
  );
}
