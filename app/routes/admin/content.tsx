import { Cause, Clock, Effect, Option, Schema, SchemaIssue } from 'effect';
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
  Content,
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
} from '~/lib/content.server';
import {
  assembleOverrides,
  collectTranslations,
  deepMerge,
  imageUploadTarget,
  isAcceptedImageType,
  setAtPath,
  translationFieldName,
  uploadedImageKey,
  type Json,
} from '~/lib/content/admin-form';
import { SiteContent } from '~/lib/content/schema';
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

// `encodeDocument` yields the encoded object (handed to the React view via the
// loader); `encodeDocumentJson` yields the JSON STRING stored in the bucket
// (Effect-Schema's JSON codec, not `JSON.stringify`, per the project lint rule).
const encodeDocument = Schema.encodeUnknownEffect(SiteContent);
const encodeDocumentJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(SiteContent),
);
const decodeDocument = Schema.decodeUnknownEffect(SiteContent);
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

type EncodedDocument = typeof SiteContent.Encoded;

type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly issues: readonly string[] };

/**
 * Walk a decode failure cause for its `SchemaIssue` and flatten it to dotted-path
 * messages, so the editor can show *which* field a publish/save was rejected on
 * rather than a raw cause dump.
 */
const issueMessages = (cause: Cause.Cause<unknown>): readonly string[] => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const error = reason.error as { readonly issue?: unknown };
      if (error && SchemaIssue.isIssue(error.issue)) {
        return formatIssue(error.issue).issues.map((entry) => {
          const path = entry.path?.map((segment) => String(segment)).join('.');
          return path ? `${path}: ${entry.message}` : entry.message;
        });
      }
    }
  }
  return [];
};

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

  const content = yield* Content.Service;
  const env = yield* Env.Service;
  const { content: document, source } = yield* content.getAdminContent();
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

  const content = yield* Content.Service;
  const storage = yield* Storage.Service;
  const form = yield* Effect.promise(() => request.formData());
  const intent = String(form.get('intent') ?? 'save-draft');

  // ---- image upload --------------------------------------------------------
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

    // Point the targeted `…key` field at the new object on the current draft and
    // persist it, so the new image survives the reload and a later publish.
    const { content: current } = yield* content.getAdminContent();
    const encoded = (yield* encodeDocument(current)) as Json;
    const next = setAtPath(encoded, uploadTarget, key);
    const decodeExit = yield* Effect.exit(decodeDocument(next));
    if (decodeExit._tag !== 'Success') {
      return Response.json(
        {
          ok: false,
          error: 'Uploaded image, but the document no longer decodes.',
          issues: issueMessages(decodeExit.cause),
        },
        { status: 400 },
      );
    }
    const json = yield* encodeDocumentJson(decodeExit.value);
    const saveExit = yield* Effect.exit(
      storage.put(SITE_CONTENT_DRAFT_KEY, json, 'application/json'),
    );
    if (saveExit._tag === 'Failure') {
      return Response.json(
        {
          ok: false,
          error: `Image stored, but saving the draft failed: ${Cause.pretty(saveExit.cause)}`,
          issues: [],
        },
        { status: 502 },
      );
    }
    return redirect(
      `/admin/content?status=${encodeURIComponent(`Image uploaded: ${key}`)}`,
    );
  }

  if (intent !== 'save-draft' && intent !== 'publish') {
    return Response.json(
      { ok: false, error: 'Unknown submit intent.', issues: [] },
      { status: 400 },
    );
  }

  // ---- save / publish ------------------------------------------------------
  const { content: current } = yield* content.getAdminContent();
  const base = (yield* encodeDocument(current)) as Json;
  const overrides = assembleOverrides(form.entries());
  // Translation fields are named `t:<locale>:<key>` (their keys carry dots, so
  // they can't ride the dotted-path convention); fold them in as a flat-map
  // override on `translations` before merging onto the current document.
  const translations = collectTranslations(form.entries());
  const merged = deepMerge(deepMerge(base, overrides), {
    translations,
  } as Json);

  const decodeExit = yield* Effect.exit(decodeDocument(merged));
  if (decodeExit._tag !== 'Success') {
    return Response.json(
      {
        ok: false,
        error: 'Validation failed — fix the fields below and resubmit.',
        issues: issueMessages(decodeExit.cause),
      },
      { status: 400 },
    );
  }

  // Re-encode the decoded value so what we store is exactly what the schema
  // produces (drops any stray override keys, normalises `Option` shapes).
  const json = yield* encodeDocumentJson(decodeExit.value);

  if (intent === 'save-draft') {
    const saveExit = yield* Effect.exit(
      storage.put(SITE_CONTENT_DRAFT_KEY, json, 'application/json'),
    );
    if (saveExit._tag === 'Failure') {
      return Response.json(
        {
          ok: false,
          error: `Saving the draft failed — is the bucket configured? ${Cause.pretty(saveExit.cause)}`,
          issues: [],
        },
        { status: 502 },
      );
    }
    return redirect('/admin/content?status=Draft%20saved.');
  }

  // publish: write the live document, drop the draft, bust the read cache.
  const publishExit = yield* Effect.exit(
    storage.put(SITE_CONTENT_KEY, json, 'application/json'),
  );
  if (publishExit._tag === 'Failure') {
    return Response.json(
      {
        ok: false,
        error: `Publishing failed — is the bucket configured? ${Cause.pretty(publishExit.cause)}`,
        issues: [],
      },
      { status: 502 },
    );
  }
  // Best-effort cleanup so the bucket stays tidy. Correctness does NOT depend on
  // it: `Content.getAdminContent` reconciles draft-vs-published by `lastModified`
  // and only reopens a draft that is strictly newer than the just-published
  // document, so a leftover draft from a failed delete (now older-or-equal to the
  // live doc) can never reopen stale content. Hence this must not fail the
  // publish — the live document is already written.
  yield* storage.delete(SITE_CONTENT_DRAFT_KEY).pipe(Effect.ignore);
  yield* content.bust();
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

export default function AdminContentEditor() {
  const { document, source, bucketConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';

  const status =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('status');

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
      name: { en: string; fr: string };
      activity: { en: string; fr: string };
      bio: { en: string; fr: string };
      photo: { key: string; alt: { en: string; fr: string } };
    }>;
  }>;
  const team = (document.team ?? []) as ReadonlyArray<{
    name: string;
    position: string;
    photo: { key: string; alt: { en: string; fr: string } };
  }>;
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
        {conferences.map((conference, ci) => (
          <Section key={conference.slug} title={`Conference ${conference.slug}`}>
            <Bilingual
              label="Theme name"
              name={`conferences.${ci}.themeName`}
              value={conference.themeName}
            />
            <Text
              label="Accent colour (#rrggbb)"
              name={`conferences.${ci}.accentColor`}
              defaultValue={conference.accentColor}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Text
                label="Start date (YYYY-MM-DD)"
                name={`conferences.${ci}.dates.start`}
                defaultValue={conference.dates.start}
              />
              <Text
                label="End date (YYYY-MM-DD)"
                name={`conferences.${ci}.dates.end`}
                defaultValue={conference.dates.end}
              />
            </div>
            <Bilingual
              label="Location"
              name={`conferences.${ci}.location`}
              value={conference.location}
            />
            <Bilingual
              label="Tagline"
              name={`conferences.${ci}.tagline`}
              value={conference.tagline}
              multiline
            />
            <Bilingual
              label="Bible book"
              name={`conferences.${ci}.bible.book`}
              value={conference.bible.book}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Text
                label="Chapter"
                name={`conferences.${ci}.bible.chapter`}
                defaultValue={String(conference.bible.chapter)}
              />
              <Text
                label="Verse"
                name={`conferences.${ci}.bible.verse`}
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
                    name={`conferences.${ci}.hero.${crop}.alt`}
                    value={conference.hero[crop].alt}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(['en', 'fr'] as const).map((locale) => (
                      <ImageUpload
                        key={locale}
                        keyPath={`conferences.${ci}.hero.${crop}.key.${locale}`}
                        currentKey={conference.hero[crop].key[locale]}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            {conference.speakers.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-neutral-800">
                  Speakers
                </legend>
                {conference.speakers.map((speaker, si) => (
                  <div key={si} className="space-y-2 rounded-md bg-neutral-50 p-3">
                    <Bilingual
                      label="Name"
                      name={`conferences.${ci}.speakers.${si}.name`}
                      value={speaker.name}
                    />
                    <Bilingual
                      label="Activity"
                      name={`conferences.${ci}.speakers.${si}.activity`}
                      value={speaker.activity}
                    />
                    <Bilingual
                      label="Bio"
                      name={`conferences.${ci}.speakers.${si}.bio`}
                      value={speaker.bio}
                      multiline
                    />
                    <ImageUpload
                      keyPath={`conferences.${ci}.speakers.${si}.photo.key`}
                      currentKey={speaker.photo.key}
                    />
                  </div>
                ))}
              </fieldset>
            )}
          </Section>
        ))}

        <Section title="Team">
          {team.map((member, ti) => (
            <div key={ti} className="space-y-2 rounded-md bg-neutral-50 p-3">
              <Text
                label="Name"
                name={`team.${ti}.name`}
                defaultValue={member.name}
              />
              <ImageUpload
                keyPath={`team.${ti}.photo.key`}
                currentKey={member.photo.key}
              />
            </div>
          ))}
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
