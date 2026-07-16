import { Effect, Option, Result, Schema } from 'effect';
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';

import { requireAdminRequest } from '~/lib/admin-auth.server';
import {
  adminFlashStatus,
  adminMeta,
  adminRedirectWithStatus,
  adminSecurityHeaders,
} from '~/lib/admin-headers';
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
const decodeInstant = Schema.decodeUnknownResult(Schema.DateTimeUtcFromString);

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

const requireFormId = Effect.fn('admin/forms.requireFormId')(function* () {
  const { params } = yield* ReactRouterContext;
  const form = decodeFormId(params['form']);
  if (Option.isNone(form)) {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }
  return form.value;
});

export const loader = routeHandler(function* () {
  yield* requireAdminRequest();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const published = yield* (yield* Forms.Service).current(form);
  const encoded = yield* encodeDefinition(published.definition);

  return {
    form,
    version: published.version,
    definitionJson: JSON.stringify(encoded, null, 2),
    commerce:
      form === 'registration'
        ? { pricing: encoded.pricing, party: encoded.party }
        : undefined,
    status: adminFlashStatus(request),
  };
});

export const action = routeAction(function* () {
  yield* requireAdminRequest();
  const form = yield* requireFormId();
  const { request } = yield* ReactRouterContext;
  const submitted = yield* Effect.promise(() => request.formData());

  const expected = decodeVersion(submitted.get('expectedCurrentVersion'));
  if (Result.isFailure(expected)) {
    return failure(400, 'The loaded Form version is missing or invalid. Reload and try again.');
  }

  const intent = submitted.get('intent');
  let definition: unknown;
  if (intent === 'publishCommerce' && form === 'registration') {
    const current = yield* (yield* Forms.Service).current(form);
    const currentEncoded = yield* encodeDefinition(current.definition);
    const base = Number(submitted.get('baseCents'));
    const closesAt = decodeInstant(submitted.get('registrationClosesAt'));
    const rules = decodeJson(submitted.get('rules'));
    const windows = decodeJson(submitted.get('windows'));
    const group = submitted.get('billingGroup') === 'on';
    const perRegistrant = submitted.get('billingPerRegistrant') === 'on';
    if (!Number.isInteger(base) || base < 0) {
      return failure(400, 'Base price must be a non-negative integer in cents.');
    }
    if (Result.isFailure(closesAt)) {
      return failure(400, 'Registration close must be an ISO-8601 UTC instant.');
    }
    if (
      Result.isFailure(rules) ||
      Result.isFailure(windows) ||
      !Array.isArray(rules.success) ||
      !Array.isArray(windows.success)
    ) {
      return failure(400, 'Pricing rules and windows must be valid JSON arrays.');
    }
    if (!group && !perRegistrant) {
      return failure(400, 'Enable at least one billing mode.');
    }
    const value = (name: string): string => String(submitted.get(name) ?? '').trim();
    definition = {
      ...currentEncoded,
      pricing: {
        currency: 'cad',
        base,
        registrationClosesAt: String(submitted.get('registrationClosesAt')),
        rules: rules.success,
        windows: windows.success,
      },
      party: {
        intro: {
          en: value('partyIntroEn'),
          fr: value('partyIntroFr'),
        },
        billingMode: {
          label: {
            en: value('billingLabelEn'),
            fr: value('billingLabelFr'),
          },
          requiredMessage: 'registration.form.type.required',
          options: {
            ...(group
              ? {
                  group: {
                    en: value('billingGroupEn'),
                    fr: value('billingGroupFr'),
                  },
                }
              : {}),
            ...(perRegistrant
              ? {
                  perRegistrant: {
                    en: value('billingPerRegistrantEn'),
                    fr: value('billingPerRegistrantFr'),
                  },
                }
              : {}),
          },
        },
        ...(group
          ? {
              payer: {
                label: { en: value('payerLabelEn'), fr: value('payerLabelFr') },
                nameField: {
                  label: { en: value('payerNameEn'), fr: value('payerNameFr') },
                  requiredMessage: 'registration.form.name.required',
                },
                emailField: {
                  label: { en: value('payerEmailEn'), fr: value('payerEmailFr') },
                  requiredMessage: 'registration.form.email.required',
                  invalidMessage: 'registration.form.email.error',
                },
              },
            }
          : {}),
      },
    };
  } else {
    const decoded = decodeJson(submitted.get('definition'));
    if (Result.isFailure(decoded)) {
      return failure(400, 'The Form definition must be valid JSON.');
    }
    definition = decoded.success;
  }

  const published = yield* (yield* Forms.Service)
    .publish({
      form,
      expectedCurrentVersion: Option.some(expected.success),
      definition,
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
  const { form, version, definitionJson, commerce, status } = useLoaderData<typeof loader>();
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

      {form === 'registration' && commerce !== undefined ? (
        <section className="space-y-5 border-y border-neutral-200 py-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Commerce and adaptive pricing</h2>
            <p className="max-w-2xl text-sm leading-6 text-neutral-700">
              Amounts are Canadian cents. Times are exact UTC instants. Publishing creates a new immutable Form version; the live channel keeps its pinned version until you preview it again.
            </p>
          </div>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="expectedCurrentVersion" value={version} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                <span>Base price (cents)</span>
                <input className="block min-h-11 w-full rounded-md border border-neutral-300 px-3" name="baseCents" type="number" min="0" step="1" required defaultValue={commerce.pricing?.base ?? 0} />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>Registration closes (UTC ISO-8601)</span>
                <input className="block min-h-11 w-full rounded-md border border-neutral-300 px-3 font-mono text-sm" name="registrationClosesAt" required defaultValue={commerce.pricing?.registrationClosesAt ?? ''} placeholder="2026-08-01T04:00:00.000Z" />
              </label>
            </div>

            <fieldset className="space-y-3">
              <legend className="font-semibold">Billing modes</legend>
              <div className="flex flex-wrap gap-5">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="billingGroup" defaultChecked={commerce.party?.billingMode.options.group !== undefined} /> One payer for the group
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="billingPerRegistrant" defaultChecked={commerce.party?.billingMode.options.perRegistrant !== undefined} /> One payment per registrant
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['billingLabelEn', 'Selector label (English)', commerce.party?.billingMode.label.en ?? 'How would you like to pay?'],
                  ['billingLabelFr', 'Selector label (French)', commerce.party?.billingMode.label.fr ?? 'Comment souhaitez-vous payer?'],
                  ['billingGroupEn', 'Group option (English)', commerce.party?.billingMode.options.group?.en ?? 'Pay for the group'],
                  ['billingGroupFr', 'Group option (French)', commerce.party?.billingMode.options.group?.fr ?? 'Payer pour le groupe'],
                  ['billingPerRegistrantEn', 'Individual option (English)', commerce.party?.billingMode.options.perRegistrant?.en ?? 'Each registrant pays'],
                  ['billingPerRegistrantFr', 'Individual option (French)', commerce.party?.billingMode.options.perRegistrant?.fr ?? 'Chaque participant paie'],
                ] as const).map(([name, label, value]) => (
                  <label key={name} className="space-y-1 text-sm"><span className="font-medium">{label}</span><input className="block min-h-11 w-full rounded-md border border-neutral-300 px-3" name={name} required defaultValue={value} /></label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="font-semibold">Group payer copy</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['partyIntroEn', 'Intro (English)', commerce.party?.intro?.en ?? 'Register everyone, then choose how to pay.'],
                  ['partyIntroFr', 'Intro (French)', commerce.party?.intro?.fr ?? 'Inscrivez tout le monde, puis choisissez comment payer.'],
                  ['payerLabelEn', 'Payer heading (English)', commerce.party?.payer?.label.en ?? 'Group payer'],
                  ['payerLabelFr', 'Payer heading (French)', commerce.party?.payer?.label.fr ?? 'Payeur du groupe'],
                  ['payerNameEn', 'Payer name label (English)', commerce.party?.payer?.nameField.label.en ?? 'Payer name'],
                  ['payerNameFr', 'Payer name label (French)', commerce.party?.payer?.nameField.label.fr ?? 'Nom du payeur'],
                  ['payerEmailEn', 'Payer email label (English)', commerce.party?.payer?.emailField.label.en ?? 'Payer email'],
                  ['payerEmailFr', 'Payer email label (French)', commerce.party?.payer?.emailField.label.fr ?? 'Courriel du payeur'],
                ] as const).map(([name, label, value]) => (
                  <label key={name} className="space-y-1 text-sm"><span className="font-medium">{label}</span><input className="block min-h-11 w-full rounded-md border border-neutral-300 px-3" name={name} required defaultValue={value} /></label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">
                <span>Field pricing rules</span>
                <textarea className="block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs leading-5" name="rules" rows={12} spellCheck={false} defaultValue={JSON.stringify(commerce.pricing?.rules ?? [], null, 2)} />
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>Timing windows</span>
                <textarea className="block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs leading-5" name="windows" rows={12} spellCheck={false} defaultValue={JSON.stringify(commerce.pricing?.windows ?? [], null, 2)} />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" name="intent" value="publishCommerce" disabled={publishing} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-medium text-white transition-colors hover:bg-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50">
                {publishing ? 'Publishing…' : 'Publish commerce version'}
              </button>
            </div>
          </Form>
        </section>
      ) : null}

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
            name="intent"
            value="publishDefinition"
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
