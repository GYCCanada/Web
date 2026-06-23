import { Effect, Option, Schema } from 'effect';
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';
import { Auth } from '~/lib/auth.server';
import {
  DraftEditor,
  formScope,
  type IssueError,
} from '~/lib/content/draft-editor.server';
import { assembleOverrides, type Json } from '~/lib/content/admin-form';
import { fieldName } from '~/lib/content/list-edit';
import { FORM_SPECS, FormId } from '~/lib/content/pages/registry';
import { ListItemId } from '~/lib/content/schema';
import { Env } from '~/lib/env.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import {
  Bilingual,
  type ActionResult,
  Section,
  Text as TextInput,
} from './controls';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The per-Form `/admin/forms/:form` editor (registrar plan C9). ONE dynamic route
 * edits any of the three `forms/<form>.json` definitions — its `form` param is
 * decoded to the closed `FormId`, and every read/write routes through the SAME
 * deep `DraftEditor` the page editor uses (Branch 5.5), scoped to a form via
 * `formScope`. No new storage path: a form is just a third `ContentScope` family
 * (ADR 0008), so "Save draft" / "Publish" / per-object cache-bust all come for
 * free — the route adds only the form-specific editable FIELDS.
 *
 * What it edits is the CMS-authorable copy + the PRICING dimension (Decision 1/3):
 * the form `title`/`intro`, and — when the form authors a `pricing` sibling — its
 * form-level `base` fee and `currency`, plus each non-overlapping `TimingWindow`
 * (early-bird/late) by its stable `id`. It also extends the party authoring inputs
 * (Decision 2b): the billing-mode option labels and the payer chrome are plain
 * `Text` leaves that merge natively through `deepMerge`'s object branch
 * (`party.billingMode.options.group.en`, `party.payer.nameField.label.en`).
 *
 * The pricing/window numeric leaves (`base`/`amount`/`unit`/`delta`/`min`/`max`)
 * post as strings; `assembleOverrides` coerces them to numbers so the override
 * decodes at the `PricingRules` / `number`-kind boundary (C9 leaf-coercion) — and
 * an EMPTY numeric input is dropped so an `optionalKey` bound stays absent rather
 * than decoding as `0`. The field GRAPH itself (the closed `FieldKind` list, the
 * variant bijection, the cross-field rules) is structural and not hand-edited
 * here; a legacy `forms/*.json` with no pricing/party still decodes unchanged
 * (`pricing`/`party` are `optionalKey` — no backfill needed, Decision 3).
 */

/** Decode the `:form` route param to a `FormId`, or `Option.none` if unknown. */
const decodeFormId = Schema.decodeUnknownOption(FormId);

/** A human label per `FormId` (the editor heading). */
const FORM_LABELS: { readonly [F in FormId]: string } = {
  contact: 'Contact',
  volunteer: 'Volunteer',
  registration: 'Registration',
};

type ActionResponse = ActionResult;

/** Map a `DraftEditor` `IssueError` to the editor's JSON action response. */
const issueResponse = (error: IssueError): Response =>
  Response.json(
    { ok: false, error: error.message, issues: error.issues },
    { status: error.status },
  );

/** Auth gate shared by the loader + action (404 when admin is disabled). */
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

/** Resolve the `:form` param to a `FormId` or 404 the route. */
const requireFormId = Effect.fn('admin/forms.requireFormId')(function* () {
  const { params } = yield* ReactRouterContext;
  const id = decodeFormId(params['form']);
  if (Option.isNone(id)) {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }
  return id.value;
});

export const loader = routeHandler(function* () {
  yield* requireAdmin();
  const form = yield* requireFormId();

  const editor = yield* DraftEditor.Service;
  const env = yield* Env.Service;
  const { content, source } = yield* editor.load(formScope(form));
  // Encode the decoded DRAFT definition to the JSON the form renders from — the
  // same encoded shape `DraftEditor.editDocument` merges the form override onto.
  const encode = Schema.encodeUnknownEffect(FORM_SPECS[form].draftSchema);
  const encoded = (yield* encode(content)) as Json;
  const bucketConfigured = Option.isSome(env.bucket);

  return { form, encoded, source, bucketConfigured };
});

export const action = routeAction(function* () {
  yield* requireAdmin();
  const form = yield* requireFormId();
  const scope = formScope(form);

  const editor = yield* DraftEditor.Service;
  const { request } = yield* ReactRouterContext;
  const formData = yield* Effect.promise(() => request.formData());
  const intent = String(formData.get('intent') ?? 'save-draft');

  if (intent !== 'save-draft' && intent !== 'publish') {
    return Response.json(
      { ok: false, error: 'Unknown submit intent.', issues: [] },
      { status: 400 },
    );
  }

  // The form editor carries only dotted-path fields (form copy lives in the typed
  // definition); `assembleOverrides` is the whole override (with the C9 numeric
  // leaf-coercion). `DraftEditor.editDocument` merges it onto the current form,
  // decodes at the form's DRAFT boundary (= `FormDefinition`), and stores `…draft`.
  const override = assembleOverrides(formData.entries());
  const edited = yield* editor.editDocument(scope, override).pipe(Effect.result);
  if (edited._tag === 'Failure') return issueResponse(edited.failure);

  if (intent === 'save-draft') {
    return redirect(`/admin/forms/${form}?status=Draft%20saved.`);
  }

  const published = yield* editor.publish(scope).pipe(Effect.result);
  if (published._tag === 'Failure') return issueResponse(published.failure);
  return redirect(
    `/admin/forms/${form}?status=Published.%20Live%20on%20the%20next%20page%20load.`,
  );
});

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** A bilingual `Text` value the form renders, tolerating an absent half. */
type DraftText = { readonly en?: string; readonly fr?: string } | undefined;

/** Coerce a (possibly-absent-half) bilingual value to a full `{ en, fr }`. */
const text = (value: DraftText): { readonly en: string; readonly fr: string } => ({
  en: value?.en ?? '',
  fr: value?.fr ?? '',
});

/** Read the (object) value at a dotted path off the encoded draft, or `{}`. */
const objectAt = (
  root: Record<string, unknown>,
  ...path: readonly string[]
): Record<string, unknown> => {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') {
      return {};
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor && typeof cursor === 'object'
    ? (cursor as Record<string, unknown>)
    : {};
};

/** One encoded `TimingWindow` the editor reads off `pricing.windows`. */
type DraftWindow = {
  readonly id: string;
  readonly from?: string;
  readonly to?: string;
  readonly delta?: number;
};

/**
 * Render the pricing surface for a form that authors one: the form-level `base`
 * fee + `currency`, and each `TimingWindow` keyed by its stable `id` (so a
 * `deepMerge` from/to/delta edit lands on the right window even if the list
 * reordered, ADR 0006). A form with no `pricing` shows nothing here.
 */
function PricingEditor({
  pricing,
}: {
  readonly pricing: Record<string, unknown>;
}): React.ReactNode {
  if (Object.keys(pricing).length === 0) return null;
  const windows = (pricing['windows'] ?? []) as readonly DraftWindow[];
  return (
    <>
      <TextInput
        label="Base fee (cents)"
        name="pricing.base"
        defaultValue={String(pricing['base'] ?? '')}
      />
      <TextInput
        label="Currency (cad)"
        name="pricing.currency"
        defaultValue={String(pricing['currency'] ?? '')}
      />
      {windows.map((window) => {
        const id = ListItemId.make(window.id);
        return (
          <fieldset
            key={window.id}
            className="space-y-2 rounded-md bg-neutral-50 p-3"
          >
            <legend className="text-xs font-medium text-neutral-600">
              Window {window.id}
            </legend>
            <TextInput
              label="From (YYYY-MM-DD)"
              name={fieldName('pricing.windows', id, 'from')}
              defaultValue={window.from ?? ''}
            />
            <TextInput
              label="To (YYYY-MM-DD, exclusive)"
              name={fieldName('pricing.windows', id, 'to')}
              defaultValue={window.to ?? ''}
            />
            <TextInput
              label="Delta (cents, signed)"
              name={fieldName('pricing.windows', id, 'delta')}
              defaultValue={
                window.delta === undefined ? '' : String(window.delta)
              }
            />
          </fieldset>
        );
      })}
    </>
  );
}

/**
 * Render the party authoring inputs for a form that authors a `party` section
 * (Decision 2b): the billing-mode legend + each OFFERED mode's label, and the
 * payer chrome labels when a payer is authored. All are plain `Text` leaves that
 * merge through `deepMerge`'s object branch — no leaf-coercion (party leaves are
 * strings/message keys, the C8/C9 note).
 */
function PartyEditor({
  party,
}: {
  readonly party: Record<string, unknown>;
}): React.ReactNode {
  if (Object.keys(party).length === 0) return null;
  const billingMode = objectAt(party, 'billingMode');
  const options = objectAt(billingMode, 'options');
  const payer = objectAt(party, 'payer');
  const hasPayer = Object.keys(payer).length > 0;
  return (
    <>
      {'intro' in party && (
        <Bilingual
          label="Party intro"
          name="party.intro"
          value={text(party['intro'] as DraftText)}
          multiline
        />
      )}
      <Bilingual
        label="Billing-mode legend"
        name="party.billingMode.label"
        value={text(billingMode['label'] as DraftText)}
      />
      {'group' in options && (
        <Bilingual
          label="Group mode label"
          name="party.billingMode.options.group"
          value={text(options['group'] as DraftText)}
        />
      )}
      {'perRegistrant' in options && (
        <Bilingual
          label="Per-registrant mode label"
          name="party.billingMode.options.perRegistrant"
          value={text(options['perRegistrant'] as DraftText)}
        />
      )}
      {hasPayer && (
        <>
          <Bilingual
            label="Payer block heading"
            name="party.payer.label"
            value={text(payer['label'] as DraftText)}
          />
          <Bilingual
            label="Payer name label"
            name="party.payer.nameField.label"
            value={text(objectAt(payer, 'nameField')['label'] as DraftText)}
          />
          <Bilingual
            label="Payer email label"
            name="party.payer.emailField.label"
            value={text(objectAt(payer, 'emailField')['label'] as DraftText)}
          />
        </>
      )}
    </>
  );
}

export default function AdminFormEditor() {
  const { form, encoded, source, bucketConfigured } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';

  const doc = encoded as Record<string, unknown>;
  const pricing = objectAt(doc, 'pricing');
  const party = objectAt(doc, 'party');

  const status =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('status');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{FORM_LABELS[form]} form</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Edit this form&rsquo;s bilingual copy and pricing. Save a draft to keep
          it private; publish to make it live on the next page load — no redeploy.
        </p>
        <p className="mt-2 inline-block rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
          Editing source: <strong>{source}</strong>
        </p>
        {!bucketConfigured && (
          <p className="mt-2 inline-block rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
            No bucket configured — saving and publishing will fail.
          </p>
        )}
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
            <ul className="space-y-1 text-xs">
              {actionData.issues.map((issue, i) => (
                <li key={i}>• {issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Form method="post" className="space-y-4">
        <Section title="Copy" open>
          <Bilingual
            label="Title"
            name="title"
            value={text(doc['title'] as DraftText)}
          />
          <Bilingual
            label="Intro"
            name="intro"
            value={text(doc['intro'] as DraftText)}
            multiline
          />
        </Section>

        {Object.keys(pricing).length > 0 && (
          <Section title="Pricing" open>
            <PricingEditor pricing={pricing} />
          </Section>
        )}

        {Object.keys(party).length > 0 && (
          <Section title="Party (billing mode + payer)" open>
            <PartyEditor party={party} />
          </Section>
        )}

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 py-3 backdrop-blur">
          <p className="text-xs text-neutral-500">
            Draft writes <code>forms/{form}.draft.json</code>. Publish writes{' '}
            <code>forms/{form}.json</code> and busts only this form&rsquo;s read
            cache.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              name="intent"
              value="save-draft"
              disabled={submitting}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="submit"
              name="intent"
              value="publish"
              disabled={submitting}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </Form>
    </div>
  );
}
