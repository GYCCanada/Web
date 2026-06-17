import { Cause, Clock, Effect, Option, Schema } from 'effect';
import { useRef } from 'react';
import {
  Form,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';
import { Auth } from '~/lib/auth.server';
import { Env } from '~/lib/env.server';
import {
  DraftEditor,
  siteScope,
  type IssueError,
} from '~/lib/content/draft-editor.server';
import {
  assembleOverrides,
  collectTranslations,
  deepMerge,
  imageUploadTarget,
  isAcceptedImageType,
  translationFieldName,
  uploadedImageKey,
  type Json,
} from '~/lib/content/admin-form';
import {
  collectListOps,
  fieldName,
  listOpFieldName,
} from '~/lib/content/list-edit';
import {
  DraftSiteContent,
  ListItemId,
  newListItemId,
  TeamPosition,
} from '~/lib/content/schema';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import { Storage } from '~/lib/storage.server';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The `/admin/content` editor (CMS plan sub-commit C5).
 *
 * It edits the one bilingual `SiteContent` document over three sections —
 * conferences, team, translations — and persists via `Storage`:
 *   - **Save draft** writes `content/site.draft.json` (private to admin);
 *   - **Publish** writes `content/site.json`, removes the draft, and **busts the
 *     `Content` read cache** so the change is live on the next public read with
 *     NO redeploy (D3);
 *   - per-image **Upload** stores the raw bytes under `images/uploads/…` and
 *     rewrites the targeted `…key` field to the new bucket object key (the
 *     resize/WebP/thumbnail pipeline is deferred — CMS plan §"Non-goals").
 *
 * The merge-onto-current-document strategy (`~/lib/content/admin-form`) means the
 * form only carries the fields it renders; every unedited deep field (long bios,
 * `Option` registration windows, image keys) survives, and the merged result is
 * Schema-decoded at the single boundary before it is stored
 * (`boundary-discipline`, `make-impossible-states-unrepresentable`).
 */

// `encodeDocument` yields the encoded object the React view renders from the
// loader's `AdminContent`. It encodes the DRAFT shape (`DraftSiteContent`): a
// reopened draft may carry a freshly-added list item holding only its `id`
// (ADR 0006), so the view must render partial items. The merge/decode/re-encode/
// store choreography lives in `DraftEditor`; the route only encodes for display.
const encodeDocument = Schema.encodeUnknownEffect(DraftSiteContent);

type EncodedDocument = typeof DraftSiteContent.Encoded;

type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly issues: readonly string[] };

/** Map a `DraftEditor` `IssueError` to the editor's JSON action response. */
const issueResponse = (error: IssueError): Response =>
  Response.json(
    { ok: false, error: error.message, issues: error.issues },
    { status: error.status },
  );

export const loader = routeHandler(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  // 404 the whole area when disabled; the layout guard already redirected an
  // unauthenticated visitor, but re-checking keeps this route safe on its own.
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );

  const editor = yield* DraftEditor.Service;
  const env = yield* Env.Service;
  const { content: document, source } = yield* editor.load(siteScope);
  const encoded = yield* encodeDocument(document);

  // The bucket is "configured" exactly when `Env.bucket` is present — the single
  // source of truth (a bucket-less editor still renders so the admin can preview,
  // but saving/publishing would fail, which we warn about up front).
  const bucketConfigured = Option.isSome(env.bucket);

  return { document: encoded as EncodedDocument, source, bucketConfigured };
});

export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );

  const editor = yield* DraftEditor.Service;
  const storage = yield* Storage.Service;
  const form = yield* Effect.promise(() => request.formData());
  const intent = String(form.get('intent') ?? 'save-draft');

  // ---- image upload --------------------------------------------------------
  // The route owns the FormData side: validate the file and store its raw bytes;
  // `DraftEditor.applyImageUpload` then rewrites the targeted `…key` field on the
  // draft so the new image survives a reload and a later publish.
  const uploadTarget = imageUploadTarget(intent);
  if (uploadTarget !== null) {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { ok: false, error: 'Choose an image before uploading.', issues: [] },
        { status: 400 },
      );
    }
    if (!isAcceptedImageType(file.type)) {
      return Response.json(
        {
          ok: false,
          error: 'Upload a JPEG, PNG, WebP, GIF, or AVIF image.',
          issues: [],
        },
        { status: 400 },
      );
    }

    const now = yield* Clock.currentTimeMillis;
    const key = uploadedImageKey(uploadTarget, file.type, now);
    const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));

    const putExit = yield* Effect.exit(storage.put(key, bytes, file.type));
    if (putExit._tag === 'Failure') {
      return Response.json(
        {
          ok: false,
          error:
            'Image upload failed — is the bucket configured? ' +
            Cause.pretty(putExit.cause),
          issues: [],
        },
        { status: 502 },
      );
    }

    const applied = yield* editor
      .applyImageUpload(siteScope, uploadTarget, key)
      .pipe(Effect.result);
    if (applied._tag === 'Failure') return issueResponse(applied.failure);
    return redirect(
      `/admin/content?status=${encodeURIComponent(`Image uploaded: ${key}`)}`,
    );
  }

  // ---- list op (add / remove / reorder) ------------------------------------
  // A per-list Add / Remove / reorder control submits `list:<path>:<kind>` fields
  // (ADR 0006). The route parses them into `ListOp`s; `DraftEditor.applyListOps`
  // performs the id-keyed structural edit on the draft and auto-saves it (settled
  // #10) so a freshly-added item's id exists server-side before a photo upload /
  // field edit targets it. An "Add" appends an item carrying only its id — draft-
  // valid, publish-invalid until its bilingual fields are filled (ADR 0006).
  if (intent === 'list-op') {
    const ops = collectListOps(form.entries());
    if (ops.length === 0) {
      return Response.json(
        { ok: false, error: 'No list change to apply.', issues: [] },
        { status: 400 },
      );
    }
    const applied = yield* editor.applyListOps(siteScope, ops).pipe(Effect.result);
    if (applied._tag === 'Failure') return issueResponse(applied.failure);
    return redirect('/admin/content?status=List%20updated.');
  }

  if (intent !== 'save-draft' && intent !== 'publish') {
    return Response.json(
      { ok: false, error: 'Unknown submit intent.', issues: [] },
      { status: 400 },
    );
  }

  // ---- save / publish ------------------------------------------------------
  // Parse the form into ONE override: dotted-path fields via `assembleOverrides`,
  // plus the `t:<locale>:<key>` translation fields folded onto `translations`
  // (their keys carry dots, so they can't ride the dotted-path convention).
  // `DraftEditor.editDocument` merges it onto the current document, decodes at
  // the single boundary, and stores the draft.
  const override = deepMerge(assembleOverrides(form.entries()), {
    translations: collectTranslations(form.entries()),
  } as Json);

  const edited = yield* editor
    .editDocument(siteScope, override)
    .pipe(Effect.result);
  if (edited._tag === 'Failure') return issueResponse(edited.failure);

  if (intent === 'save-draft') {
    return redirect('/admin/content?status=Draft%20saved.');
  }

  // publish: promote the just-saved draft to the live document, drop the draft,
  // and bust the read cache so the change is live on the next public read.
  const published = yield* editor.publish(siteScope).pipe(Effect.result);
  if (published._tag === 'Failure') return issueResponse(published.failure);
  return redirect(
    '/admin/content?status=Published.%20Live%20on%20the%20next%20page%20load.',
  );
});

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function Text({
  label,
  name,
  defaultValue,
  multiline = false,
}: {
  readonly label: string;
  readonly name: string;
  readonly defaultValue: string;
  readonly multiline?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-neutral-600">{label}</span>
      {multiline ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          rows={4}
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        />
      ) : (
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        />
      )}
    </label>
  );
}

/**
 * The board-position picker for a team member. A `TeamMember.position` is a
 * required `TeamPosition` literal (`schema.ts`), so a freshly-added member (which
 * arrives carrying only its `id`) needs a fill surface or it can never reach the
 * strict-publishable state from the UI. The options are the closed
 * `TeamPosition.literals` set (`derive-dont-sync` — the picker can never offer a
 * value the schema rejects); the leading empty option keeps the field unset on a
 * stub member (draft-valid, publish-invalid until chosen — ADR 0006).
 */
function PositionSelect({
  name,
  defaultValue,
}: {
  readonly name: string;
  readonly defaultValue: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-neutral-600">Position</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
      >
        <option value="">— select a position —</option>
        {TeamPosition.literals.map((position) => (
          <option key={position} value={position}>
            {position}
          </option>
        ))}
      </select>
    </label>
  );
}

function Bilingual({
  label,
  name,
  value,
  multiline = false,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: { readonly en: string; readonly fr: string };
  readonly multiline?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-neutral-800">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Text label="EN" name={`${name}.en`} defaultValue={value.en} multiline={multiline} />
        <Text label="FR" name={`${name}.fr`} defaultValue={value.fr} multiline={multiline} />
      </div>
    </fieldset>
  );
}

/**
 * A per-image uploader. It posts to this route's action independently of the
 * surrounding save/publish form via a `useFetcher` — *not* a nested `<form>`
 * (HTML forbids nesting forms, and the editor's main `<Form>` wraps every
 * section, so rendering an inner form here would let SSR/hydration close or drop
 * either form's tags and silently break submission). Instead the uploader is a
 * plain element tree; the "Upload" button hands a one-off `FormData` (carrying
 * `intent=upload:<keyPath>` and the chosen `file`) to `fetcher.submit` as
 * multipart. The action stores the bytes and rewrites that key on the draft,
 * then redirects, which revalidates this route's loader so the new key shows.
 */
function ImageUpload({
  keyPath,
  currentKey,
}: {
  readonly keyPath: string;
  readonly currentKey: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = fetcher.state !== 'idle';

  const upload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set('intent', `upload:${keyPath}`);
    data.set('file', file);
    void fetcher.submit(data, { method: 'post', encType: 'multipart/form-data' });
  };

  return (
    <div className="space-y-1 rounded-md border border-dashed border-neutral-300 p-2">
      <p className="text-xs text-neutral-600">
        Current: <code className="text-neutral-800">{currentKey}</code>
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="text-xs"
        />
        <button
          type="button"
          onClick={upload}
          disabled={uploading}
          className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-neutral-300 px-3 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {fetcher.data && !fetcher.data.ok && (
        <p className="text-xs text-rose-700">{fetcher.data.error}</p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  open = false,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly open?: boolean;
}) {
  return (
    <details open={open} className="rounded-lg border border-neutral-200 bg-white">
      <summary className="cursor-pointer list-none p-4 text-sm font-medium hover:bg-neutral-50">
        {title}
      </summary>
      <div className="space-y-6 border-t border-neutral-200 p-4">{children}</div>
    </details>
  );
}

/**
 * Submit a single id-keyed list op (ADR 0006) out-of-band via `useFetcher`,
 * exactly like `ImageUpload` — *not* a nested `<form>` (the editor's main
 * `<Form>` wraps every section, and HTML forbids nested forms). The button
 * builds a one-off `FormData` carrying `intent=list-op` and the
 * `list:<path>:<kind>` control field, hands it to `fetcher.submit`, and the
 * action applies the op and redirects, revalidating the loader so the changed
 * list re-renders.
 *
 * The `value` carries the op payload: an item `id` for add/remove, or the
 * comma-joined surviving ids for a reorder. An "Add" mints a fresh `ListItemId`
 * client-side so the appended item's id is known before submit; the server
 * appends an item carrying only that id (draft-valid, publish-invalid until
 * edited).
 */
function ListOpButton({
  listPath,
  kind,
  value,
  label,
  variant = 'default',
  disabled = false,
}: {
  readonly listPath: string;
  readonly kind: 'add' | 'remove' | 'reorder';
  readonly value: string;
  readonly label: string;
  readonly variant?: 'default' | 'add' | 'danger';
  readonly disabled?: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const pending = fetcher.state !== 'idle';
  const className =
    variant === 'add'
      ? 'inline-flex min-h-9 cursor-pointer items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50'
      : variant === 'danger'
        ? 'inline-flex min-h-9 cursor-pointer items-center rounded-md border border-rose-300 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50'
        : 'inline-flex min-h-9 cursor-pointer items-center rounded-md border border-neutral-300 px-2 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50';

  const submit = () => {
    const data = new FormData();
    data.set('intent', 'list-op');
    data.set(listOpFieldName(listPath, kind), value);
    void fetcher.submit(data, { method: 'post' });
  };

  return (
    <button
      type="button"
      onClick={submit}
      disabled={disabled || pending}
      className={className}
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * The per-item structural controls (ADR 0006): move up / down (a reorder
 * submitting the full new id order so a partial/stale order never drops an item)
 * and remove. Rendered next to each list item; the `ids` is the list's current
 * id order so a move computes the swapped permutation client-side.
 */
function ItemControls({
  listPath,
  ids,
  index,
}: {
  readonly listPath: string;
  readonly ids: readonly string[];
  readonly index: number;
}) {
  const id = ids[index];
  if (id === undefined) return null;
  // Swap two positions to compute the reorder permutation, guarding the bounds
  // so the disabled edge buttons (first item's "↑", last item's "↓") never
  // index past the array; out of range, the order is returned unchanged.
  const swapped = (a: number, b: number): string => {
    const aId = ids[a];
    const bId = ids[b];
    if (aId === undefined || bId === undefined) return ids.join(',');
    const next = [...ids];
    next[a] = bId;
    next[b] = aId;
    return next.join(',');
  };
  return (
    <div className="flex items-center gap-1">
      <ListOpButton
        listPath={listPath}
        kind="reorder"
        value={index > 0 ? swapped(index, index - 1) : ids.join(',')}
        label="↑"
        disabled={index === 0}
      />
      <ListOpButton
        listPath={listPath}
        kind="reorder"
        value={index < ids.length - 1 ? swapped(index, index + 1) : ids.join(',')}
        label="↓"
        disabled={index === ids.length - 1}
      />
      <ListOpButton
        listPath={listPath}
        kind="remove"
        value={id}
        label="Remove"
        variant="danger"
      />
    </div>
  );
}

/** The "Add item" control: mints a fresh id client-side and appends an empty item. */
function AddItemButton({
  listPath,
  label,
}: {
  readonly listPath: string;
  readonly label: string;
}) {
  return (
    <ListOpButton
      listPath={listPath}
      kind="add"
      value={newListItemId()}
      label={label}
      variant="add"
    />
  );
}

export default function AdminContentEditor() {
  const { document, source, bucketConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';

  const status =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('status');

  // Items carry an `id` (ADR 0006), and a freshly-added item is draft-valid with
  // only its `id` — its bilingual content fields are absent until edited. The
  // view therefore treats every per-item content field as optional and supplies
  // empty defaults so a partial item still renders (and stays editable so the
  // admin can fill it in and publish).
  const conferences = (document.conferences ?? []) as ReadonlyArray<{
    slug: string;
    themeName: { en: string; fr: string };
    accentColor: string;
    tagline: { en: string; fr: string };
    location: { en: string; fr: string };
    dates: { start: string; end: string };
    bible: { book: { en: string; fr: string }; chapter: number; verse: number };
    hero: {
      desktop: { key: { en: string; fr: string }; alt: { en: string; fr: string } };
      mobile: { key: { en: string; fr: string }; alt: { en: string; fr: string } };
    };
    speakers: ReadonlyArray<{
      id: string;
      name?: { en: string; fr: string };
      activity?: { en: string; fr: string };
      bio?: { en: string; fr: string };
      photo?: { key: string; alt: { en: string; fr: string } };
    }>;
  }>;
  const team = (document.team ?? []) as ReadonlyArray<{
    id: string;
    name?: string;
    position?: string;
    photo?: { key: string; alt: { en: string; fr: string } };
  }>;

  const teamIds = team.map((m) => m.id);
  const emptyText = { en: '', fr: '' } as const;
  const translations = (document.translations ?? { en: {}, fr: {} }) as {
    en: Readonly<Record<string, string>>;
    fr: Readonly<Record<string, string>>;
  };
  const translationKeys = Object.keys(translations.en);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Site content</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Edit bilingual copy, dates, and images. Save a draft to keep it private;
          publish to make it live on the next page load — no redeploy.
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
        {conferences.map((conference) => {
          // Conferences are addressed by their stable `slug` identity (ADR 0006),
          // not by array position — `deepMerge` / `setAtPath` reconcile the
          // override against the base's `conferences` array by matching `slug`,
          // so an edit never lands on the wrong year.
          const conf = `conferences.${conference.slug}`;
          const speakersPath = `${conf}.speakers`;
          const speakerIds = conference.speakers.map((s) => s.id);
          return (
            <Section key={conference.slug} title={`Conference ${conference.slug}`}>
              <Bilingual
                label="Theme name"
                name={`${conf}.themeName`}
                value={conference.themeName}
              />
              <Text
                label="Accent colour (#rrggbb)"
                name={`${conf}.accentColor`}
                defaultValue={conference.accentColor}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Text
                  label="Start date (YYYY-MM-DD)"
                  name={`${conf}.dates.start`}
                  defaultValue={conference.dates.start}
                />
                <Text
                  label="End date (YYYY-MM-DD)"
                  name={`${conf}.dates.end`}
                  defaultValue={conference.dates.end}
                />
              </div>
              <Bilingual
                label="Location"
                name={`${conf}.location`}
                value={conference.location}
              />
              <Bilingual
                label="Tagline"
                name={`${conf}.tagline`}
                value={conference.tagline}
                multiline
              />
              <Bilingual
                label="Bible book"
                name={`${conf}.bible.book`}
                value={conference.bible.book}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Text
                  label="Chapter"
                  name={`${conf}.bible.chapter`}
                  defaultValue={String(conference.bible.chapter)}
                />
                <Text
                  label="Verse"
                  name={`${conf}.bible.verse`}
                  defaultValue={String(conference.bible.verse)}
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-neutral-800">
                  Hero artwork
                </legend>
                {(['desktop', 'mobile'] as const).map((crop) => (
                  <div key={crop} className="space-y-2 rounded-md bg-neutral-50 p-3">
                    <p className="text-xs font-semibold uppercase text-neutral-500">
                      {crop}
                    </p>
                    <Bilingual
                      label="Alt text"
                      name={`${conf}.hero.${crop}.alt`}
                      value={conference.hero[crop].alt}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(['en', 'fr'] as const).map((locale) => (
                        <ImageUpload
                          key={locale}
                          keyPath={`${conf}.hero.${crop}.key.${locale}`}
                          currentKey={conference.hero[crop].key[locale]}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="flex items-center justify-between text-sm font-medium text-neutral-800">
                  <span>Speakers</span>
                  <AddItemButton listPath={speakersPath} label="+ Add speaker" />
                </legend>
                {conference.speakers.map((speaker, si) => {
                  // Re-assert the `ListItemId` brand at this view boundary: the
                  // encoded document carries the id as a bare `string` (encode
                  // drops the brand), but it decoded through `ListItemId`, so it
                  // matches the nanoid pattern — `make` validates rather than
                  // casts, keeping `fieldName`'s "no `.`-bearing id" guarantee
                  // load-bearing (`boundary-discipline`).
                  const speakerId = ListItemId.make(speaker.id);
                  return (
                    <div
                      key={speaker.id}
                      className="space-y-2 rounded-md bg-neutral-50 p-3"
                    >
                      <div className="flex items-center justify-end">
                        <ItemControls
                          listPath={speakersPath}
                          ids={speakerIds}
                          index={si}
                        />
                      </div>
                      <Bilingual
                        label="Name"
                        name={fieldName(speakersPath, speakerId, 'name')}
                        value={speaker.name ?? emptyText}
                      />
                      <Bilingual
                        label="Activity"
                        name={fieldName(speakersPath, speakerId, 'activity')}
                        value={speaker.activity ?? emptyText}
                      />
                      <Bilingual
                        label="Bio"
                        name={fieldName(speakersPath, speakerId, 'bio')}
                        value={speaker.bio ?? emptyText}
                        multiline
                      />
                      <ImageUpload
                        keyPath={fieldName(speakersPath, speakerId, 'photo.key')}
                        currentKey={speaker.photo?.key ?? ''}
                      />
                      <Bilingual
                        label="Photo alt text"
                        name={fieldName(speakersPath, speakerId, 'photo.alt')}
                        value={speaker.photo?.alt ?? emptyText}
                      />
                    </div>
                  );
                })}
              </fieldset>
            </Section>
          );
        })}

        <Section title="Team">
          <div className="flex items-center justify-end">
            <AddItemButton listPath="team" label="+ Add team member" />
          </div>
          {team.map((member, ti) => {
            // Re-assert the brand at this boundary (see the speakers note).
            const memberId = ListItemId.make(member.id);
            return (
              <div key={member.id} className="space-y-2 rounded-md bg-neutral-50 p-3">
                <div className="flex items-center justify-end">
                  <ItemControls listPath="team" ids={teamIds} index={ti} />
                </div>
                <Text
                  label="Name"
                  name={fieldName('team', memberId, 'name')}
                  defaultValue={member.name ?? ''}
                />
                <PositionSelect
                  name={fieldName('team', memberId, 'position')}
                  defaultValue={member.position ?? ''}
                />
                <ImageUpload
                  keyPath={fieldName('team', memberId, 'photo.key')}
                  currentKey={member.photo?.key ?? ''}
                />
                <Bilingual
                  label="Photo alt text"
                  name={fieldName('team', memberId, 'photo.alt')}
                  value={member.photo?.alt ?? emptyText}
                />
              </div>
            );
          })}
        </Section>

        <Section title={`Translations (${translationKeys.length} keys)`}>
          <p className="text-xs text-neutral-500">
            Each key has an English and French value. Empty values are allowed.
          </p>
          {translationKeys.map((key) => (
            <fieldset key={key} className="space-y-2">
              <legend className="text-xs font-medium text-neutral-800">
                {key}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Text
                  label="EN"
                  name={translationFieldName('en', key)}
                  defaultValue={translations.en[key] ?? ''}
                />
                <Text
                  label="FR"
                  name={translationFieldName('fr', key)}
                  defaultValue={translations.fr[key] ?? ''}
                />
              </div>
            </fieldset>
          ))}
        </Section>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 py-3 backdrop-blur">
          <p className="text-xs text-neutral-500">
            Draft writes <code>content/site.draft.json</code>. Publish writes{' '}
            <code>content/site.json</code> and busts the read cache.
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
