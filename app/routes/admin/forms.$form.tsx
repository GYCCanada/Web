import { Effect, Option, Result, Schema } from 'effect';
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';

import {
  adminFlashStatus,
  adminMeta,
  adminRedirectWithStatus,
  adminSecurityHeaders,
} from '~/lib/admin-headers';
import { Auth } from '~/lib/auth.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import { FormDefinition, FormId } from '~/lib/forms/definition';
import { Forms } from '~/lib/forms/forms.server';

export const meta = adminMeta;
export const headers = adminSecurityHeaders;

const FORM_LABELS = {
  contact: 'Contact',
  volunteer: 'Volunteer',
  registration: 'Registration',
} as const satisfies Record<FormId, string>;

const decodeFormId = Schema.decodeUnknownOption(FormId);
const decodeVersion = Schema.decodeUnknownResult(Forms.FormDefinitionVersionId);
const decodeJson = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Unknown),
);
const encodeDefinition = Schema.encodeUnknownEffect(FormDefinition);

type ActionResponse =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues: readonly string[];
    };

const failure = (
  status: number,
  error: string,
  issues: readonly string[] = [],
): Response => Response.json({ ok: false, error, issues }, { status });

/** Keep this route independently safe even when called outside its guard layout. */
const requireAdmin = Effect.fn('admin/forms.requireAdmin')(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );
});

const requireFormId = Effect.fn('admin/forms.requireFormId')(function* () {
  const { params } = yield* ReactRouterContext;
  const form = decodeFormId(params['form']);
  if (Option.isNone(form)) {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }
  return form.value;
});

export const loader = routeHandler(function* () {
  yield* requireAdmin();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const published = yield* (yield* Forms.Service).current(form);
  const encoded = yield* encodeDefinition(published.definition);

  return {
    form,
    version: published.version,
    definitionJson: JSON.stringify(encoded, null, 2),
    status: adminFlashStatus(request),
  };
});

export const action = routeAction(function* () {
  yield* requireAdmin();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const submitted = yield* Effect.promise(() => request.formData());

  const expected = decodeVersion(submitted.get('expectedCurrentVersion'));
  if (Result.isFailure(expected)) {
    return failure(400, 'The loaded Form version is missing or invalid. Reload and try again.');
  }

  const definition = decodeJson(submitted.get('definition'));
  if (Result.isFailure(definition)) {
    return failure(400, 'The Form definition must be valid JSON.');
  }

  const published = yield* (yield* Forms.Service)
    .publish({
      form,
      expectedCurrentVersion: Option.some(expected.success),
      definition: definition.success,
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
    return failure(400, 'The Form definition is not publishable.', error.issues);
  }
  if (Forms.PublishConflict.is(error)) {
    return failure(
      409,
      'This Form changed after you opened it. Reload before publishing your edits.',
    );
  }
  return failure(500, 'The Form could not be published.');
});

export default function AdminFormEditor() {
  const { form, version, definitionJson, status } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const publishing = navigation.state === 'submitting';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{FORM_LABELS[form]} Form</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Edit the complete bilingual definition. Publishing validates the closed
          field model and makes a new immutable version live immediately.
        </p>
        <p className="mt-2 inline-block rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-700">
          Current version: {version}
        </p>
      </div>

      {status && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {status}
        </div>
      )}

      {actionData && !actionData.ok && (
        <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>{actionData.error}</strong>
          {actionData.issues.length > 0 && (
            <ul className="space-y-1 font-mono text-xs">
              {actionData.issues.map((issue, index) => (
                <li key={index}>• {issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Form method="post" className="space-y-4">
        <input
          type="hidden"
          name="expectedCurrentVersion"
          value={version}
        />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-800">
            FormDefinition JSON
          </span>
          <textarea
            name="definition"
            defaultValue={definitionJson}
            rows={32}
            spellCheck={false}
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs leading-5 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
          />
        </label>
        <div className="flex justify-end border-t border-neutral-200 pt-4">
          <button
            type="submit"
            disabled={publishing}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : 'Publish Form'}
          </button>
        </div>
      </Form>
    </div>
  );
}
