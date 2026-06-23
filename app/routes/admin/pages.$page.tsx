import { Cause, Clock, Effect, Option, Schema } from 'effect';
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';

import { adminMeta, adminRedirectWithStatus, adminFlashStatus, adminSecurityHeaders } from '~/lib/admin-headers';
import { Auth } from '~/lib/auth.server';
import {
  DraftEditor,
  pageScope,
  type IssueError,
} from '~/lib/content/draft-editor.server';
import {
  assembleOverrides,
  imageUploadTarget,
  isAcceptedImageType,
  normalizeFaqAnswers,
  uploadedImageKey,
  type Json,
} from '~/lib/content/admin-form';
import { prepareImage } from '~/lib/content/image-optimize.server';
import { collectListOps, fieldName } from '~/lib/content/list-edit';
import { PAGE_SPECS, PageId } from '~/lib/content/pages/registry';
import { ListItemId, newListItemId } from '~/lib/content/schema';
import { Env } from '~/lib/env.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import { Storage } from '~/lib/storage.server';
import {
  AddItemButton,
  Bilingual,
  type ActionResult,
  Checkbox,
  ImageUpload,
  ItemControls,
  Section,
  Text,
} from './controls';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The per-Page `/admin` editor (registration-launch Branch 5.5, ADR 0008, settled
 * #5). ONE dynamic route edits any evergreen Page object (`content/pages/<page>.json`)
 * — its `page` param is decoded to the closed `PageId`, and every read/write routes
 * through `DraftEditor` with that page's `pageScope`. The page set is enumerated
 * once in `pages/registry`; this route adds no second list of pages
 * (`derive-dont-sync`).
 *
 * The write path is the SAME deep `DraftEditor` the site editor uses (Branch 1),
 * just scoped to a page: "Save draft" decodes the merged override at the page's
 * laxer DRAFT boundary and stores `…draft.json`; "Publish" re-decodes at the STRICT
 * boundary (re-enforcing the both-locales `Text` invariant — an empty added item
 * blocks publish, not save, per ADR 0006) and busts ONLY that page's read cache so
 * the change is live with no redeploy and no other page/form/conference cache is
 * touched (ADR 0008's per-object isolation). List add/remove/reorder reuses the
 * Branch-2 `ListEdit` machinery (`intent=list-op` → `DraftEditor.applyListOps`).
 *
 * The page schemas are heterogeneous, so the EDITABLE FIELDS are rendered per page
 * by `PageEditor` (a closed switch over `PageId`). The shared field/list controls
 * (`Bilingual`, `Section`, the id-keyed list buttons) come from `./controls`, the
 * same module the site editor uses (`subtract-before-you-add`). EXISTING `RichText`
 * fields (a filled FAQ answer, contact/volunteer rich copy) are shown read-only
 * here: the closed token model has no id-keyed nodes, so the identity-keyed merge
 * cannot target a node in place — a token-aware editor is a separate concern. The
 * one exception is a freshly-added FAQ item whose answer is still ABSENT: it gets a
 * plain-text bilingual answer input so the add→fill→publish loop completes — the
 * route's `normalizeFaqAnswers` converts that plain `{ en, fr }` into a single
 * `text`-token `RichText` on save (rich link/bold/italic answers stay read-only).
 * The structural list edits (add/remove/reorder a FAQ item) and every plain-`Text`
 * field ARE editable.
 */

/** Decode the `:page` route param to a `PageId`, or `Option.none` if unknown. */
const decodePageId = Schema.decodeUnknownOption(PageId);

/** A human label for each page (the admin nav + heading). */
const PAGE_LABELS: { readonly [P in PageId]: string } = {
  about: 'About',
  faq: 'FAQ',
  give: 'Give',
  contact: 'Contact',
  volunteer: 'Volunteer',
  archive: 'Archive',
  home: 'Home (evergreen sections)',
  team: 'Team',
};

type ActionResponse = ActionResult;

/** Map a `DraftEditor` `IssueError` to the editor's JSON action response. */
const issueResponse = (error: IssueError): Response =>
  Response.json(
    { ok: false, error: error.message, issues: error.issues },
    { status: error.status },
  );

/** Auth gate shared by the loader + action (404 when admin is disabled). */
const requireAdmin = Effect.fn('admin/pages.requireAdmin')(function* () {
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

/** Resolve the `:page` param to a `PageId` or 404 the route. */
const requirePageId = Effect.fn('admin/pages.requirePageId')(function* () {
  const { params } = yield* ReactRouterContext;
  const id = decodePageId(params['page']);
  if (Option.isNone(id)) {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }
  return id.value;
});

export const loader = routeHandler(function* () {
  yield* requireAdmin();
  const page = yield* requirePageId();
  const { request } = yield* ReactRouterContext;

  const editor = yield* DraftEditor.Service;
  const env = yield* Env.Service;
  const { content, source } = yield* editor.load(pageScope(page));
  // Encode the decoded DRAFT page to the JSON the form renders from — the same
  // encoded shape `DraftEditor.editDocument` merges the form override onto.
  const encode = Schema.encodeUnknownEffect(PAGE_SPECS[page].draftSchema);
  const encoded = (yield* encode(content)) as Json;
  const bucketConfigured = Option.isSome(env.bucket);
  const status = adminFlashStatus(request);

  return { page, encoded, source, bucketConfigured, status };
});

export const action = routeAction(function* () {
  yield* requireAdmin();
  const page = yield* requirePageId();
  const scope = pageScope(page);

  const editor = yield* DraftEditor.Service;
  const storage = yield* Storage.Service;
  const { request } = yield* ReactRouterContext;
  const form = yield* Effect.promise(() => request.formData());
  const intent = String(form.get('intent') ?? 'save-draft');

  // ---- image upload --------------------------------------------------------
  // Identical in shape to the site editor (`content.tsx`), scoped to THIS page:
  // validate the file, optimize it at the shared `prepareImage` boundary, store
  // the prepared bytes, then `DraftEditor.applyImageUpload`
  // rewrites the targeted `<image>.key` field on the page draft so the new image
  // survives a reload and a later publish. The image-upload path is REUSED, not
  // re-implemented — `applyImageUpload` is scope-generic and `setAtPath` already
  // navigates `groupPhoto.key` / `portrait.key` as plain object paths.
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

    // Shrink + re-encode at the ONE shared boundary (Feature B), identical to
    // the site editor: WebP for decodable rasters, GIF/originals passed through,
    // so the key + `storage.put` follow `prepared.contentType`, never `file.type`.
    const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
    const prepared = yield* prepareImage(bytes, file.type);
    const now = yield* Clock.currentTimeMillis;
    const key = uploadedImageKey(uploadTarget, prepared.contentType, now);

    const putExit = yield* Effect.exit(
      storage.put(key, prepared.bytes, prepared.contentType),
    );
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
      .applyImageUpload(scope, uploadTarget, key)
      .pipe(Effect.result);
    if (applied._tag === 'Failure') return issueResponse(applied.failure);
    return adminRedirectWithStatus(
      `/admin/pages/${page}`,
      `Image uploaded: ${key}`,
    );
  }

  // ---- list op (add / remove / reorder) ------------------------------------
  if (intent === 'list-op') {
    const ops = collectListOps(form.entries());
    if (ops.length === 0) {
      return Response.json(
        { ok: false, error: 'No list change to apply.', issues: [] },
        { status: 400 },
      );
    }
    const applied = yield* editor.applyListOps(scope, ops).pipe(Effect.result);
    if (applied._tag === 'Failure') return issueResponse(applied.failure);
    return adminRedirectWithStatus(`/admin/pages/${page}`, 'List updated.');
  }

  if (intent !== 'save-draft' && intent !== 'publish') {
    return Response.json(
      { ok: false, error: 'Unknown submit intent.', issues: [] },
      { status: 400 },
    );
  }

  // ---- save / publish ------------------------------------------------------
  // The page form carries only dotted-path fields (no translation god-bag — page
  // copy lives in the typed object now), so `assembleOverrides` is the whole
  // override; `DraftEditor.editDocument` merges it onto the current page, decodes
  // at the page's DRAFT boundary, and stores `…draft.json`. The FAQ answer input
  // posts a plain bilingual `items.<id>.answer` leaf, which `normalizeFaqAnswers`
  // rewrites into the encoded single-`text`-token `RichText` the `FaqPage` schema
  // decodes (a no-op for every other page — only FAQ-answer leaves are touched).
  const override = normalizeFaqAnswers(assembleOverrides(form.entries()));
  const edited = yield* editor.editDocument(scope, override).pipe(Effect.result);
  if (edited._tag === 'Failure') return issueResponse(edited.failure);

  if (intent === 'save-draft') {
    return adminRedirectWithStatus(`/admin/pages/${page}`, 'Draft saved.');
  }

  const published = yield* editor.publish(scope).pipe(Effect.result);
  if (published._tag === 'Failure') return issueResponse(published.failure);
  return adminRedirectWithStatus(
    `/admin/pages/${page}`,
    'Published. Live on the next page load.',
  );
});

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** A bilingual `Text` value the form renders, tolerating the draft's optional halves. */
type DraftText = { readonly en?: string; readonly fr?: string } | undefined;

/** Coerce a draft (possibly-absent-half) bilingual value to a full `{ en, fr }`. */
const text = (value: DraftText): { readonly en: string; readonly fr: string } => ({
  en: value?.en ?? '',
  fr: value?.fr ?? '',
});

/**
 * A read-only `RichText` preview: the closed token model has no id-keyed nodes, so
 * its runs cannot be edited in place through the identity-keyed merge (see the
 * route doc). The plain/bold/italic runs and link labels are shown so the admin can
 * see the rendered copy; editing rich copy is a separate concern (Branch 6+).
 */
function RichTextPreview({
  label,
  nodes,
}: {
  readonly label: string;
  readonly nodes: ReadonlyArray<Record<string, unknown>> | undefined;
}) {
  const runs = (nodes ?? [])
    .map((node) => {
      if (node['_tag'] === 'link') {
        const linkText = node['text'] as DraftText;
        return linkText?.en ?? '';
      }
      const value = node['value'] as DraftText;
      return value?.en ?? '';
    })
    .join('');
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-600">{label} (read-only)</p>
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        {runs || '—'}
      </p>
    </div>
  );
}

/** The list item shape the page editors read off the encoded draft. */
type DraftListItem = {
  readonly id: string;
  readonly [key: string]: unknown;
};

/** A titled list-section wrapper with an "Add" control and per-item move/remove. */
function ListSection({
  title,
  listPath,
  addLabel,
  items,
  renderItem,
}: {
  readonly title: string;
  readonly listPath: string;
  readonly addLabel: string;
  readonly items: readonly DraftListItem[];
  readonly renderItem: (item: DraftListItem, id: ListItemId) => React.ReactNode;
}) {
  const ids = items.map((item) => item.id);
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-center justify-between text-sm font-medium text-neutral-800">
        <span>{title}</span>
        <AddItemButton listPath={listPath} label={addLabel} newId={newListItemId()} />
      </legend>
      {items.map((item, index) => {
        // Re-assert the `ListItemId` brand at this view boundary: the encoded
        // draft carries the id as a bare `string` (encode drops the brand), but it
        // decoded through `ListItemId`, so it matches the nanoid pattern — `make`
        // validates rather than casts, keeping `fieldName`'s "no `.`-bearing id"
        // guarantee load-bearing (`boundary-discipline`), exactly as the site
        // editor does for speakers/team.
        const id = ListItemId.make(item.id);
        return (
          <div key={item.id} className="space-y-2 rounded-md bg-neutral-50 p-3">
            <div className="flex items-center justify-end">
              <ItemControls listPath={listPath} ids={ids} index={index} />
            </div>
            {renderItem(item, id)}
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * Render the editable fields for one page (a closed switch over `PageId`). The
 * `encoded` value is the page's DRAFT-encoded JSON; each branch reads the fields it
 * owns. Exhaustive over `PageId` so adding a Page without an editor is a type error
 * (`make-impossible-states-unrepresentable`).
 */
function PageEditor({
  page,
  encoded,
}: {
  readonly page: PageId;
  readonly encoded: Record<string, unknown>;
}): React.ReactNode {
  switch (page) {
    case 'about': {
      const paragraphs = (encoded['paragraphs'] ?? []) as readonly DraftListItem[];
      const quotes = (encoded['quotes'] ?? []) as readonly DraftListItem[];
      return (
        <>
          <Bilingual label="Title" name="title" value={text(encoded['title'] as DraftText)} />
          <Bilingual
            label="Disclaimer"
            name="disclaimer"
            value={text(encoded['disclaimer'] as DraftText)}
            multiline
          />
          <ListSection
            title="Paragraphs"
            listPath="paragraphs"
            addLabel="+ Add paragraph"
            items={paragraphs}
            renderItem={(item, id) => (
              <Bilingual
                label="Text"
                name={fieldName('paragraphs', id, 'text')}
                value={text(item['text'] as DraftText)}
                multiline
              />
            )}
          />
          <ListSection
            title="Quotes"
            listPath="quotes"
            addLabel="+ Add quote"
            items={quotes}
            renderItem={(item, id) => (
              <>
                <Bilingual
                  label="Quote"
                  name={fieldName('quotes', id, 'text')}
                  value={text(item['text'] as DraftText)}
                  multiline
                />
                <Bilingual
                  label="Attribution"
                  name={fieldName('quotes', id, 'attribution')}
                  value={text(item['attribution'] as DraftText)}
                />
              </>
            )}
          />
        </>
      );
    }
    case 'faq': {
      const items = (encoded['items'] ?? []) as readonly DraftListItem[];
      return (
        <>
          <Bilingual label="Title" name="title" value={text(encoded['title'] as DraftText)} />
          <ListSection
            title="Questions"
            listPath="items"
            addLabel="+ Add question"
            items={items}
            renderItem={(item, id) => (
              <>
                <Bilingual
                  label="Question"
                  name={fieldName('items', id, 'question')}
                  value={text(item['question'] as DraftText)}
                />
                {item['answer'] === undefined ? (
                  // A freshly-added FAQ item has no answer yet (publish-invalid until
                  // filled, ADR 0006). Render a plain-text bilingual answer input so
                  // the add→fill→publish loop completes: `normalizeFaqAnswers`
                  // converts this `{ en, fr }` to a single-`text`-token `RichText` on
                  // save. Existing answers keep their rich (link/bold/italic) tokens
                  // and stay read-only — token-aware editing is deferred (route doc).
                  <Bilingual
                    label="Answer"
                    name={fieldName('items', id, 'answer')}
                    value={text(item['answer'] as DraftText)}
                    multiline
                  />
                ) : (
                  <RichTextPreview
                    label="Answer"
                    nodes={item['answer'] as ReadonlyArray<Record<string, unknown>> | undefined}
                  />
                )}
              </>
            )}
          />
        </>
      );
    }
    case 'give': {
      const directions = (encoded['directions'] ?? []) as readonly DraftListItem[];
      return (
        <>
          <Bilingual label="Title" name="title" value={text(encoded['title'] as DraftText)} />
          <Bilingual
            label="Reason"
            name="reason"
            value={text(encoded['reason'] as DraftText)}
            multiline
          />
          <Text
            label="Donate URL (https://…)"
            name="donateUrl"
            defaultValue={String(encoded['donateUrl'] ?? '')}
          />
          <ListSection
            title="Directions"
            listPath="directions"
            addLabel="+ Add direction"
            items={directions}
            renderItem={(item, id) => (
              <Bilingual
                label="Step"
                name={fieldName('directions', id, 'text')}
                value={text(item['text'] as DraftText)}
              />
            )}
          />
        </>
      );
    }
    case 'archive': {
      const entries = (encoded['entries'] ?? []) as readonly DraftListItem[];
      return (
        <>
          <Bilingual label="Title" name="title" value={text(encoded['title'] as DraftText)} />
          <ListSection
            title="Entries"
            listPath="entries"
            addLabel="+ Add entry"
            items={entries}
            renderItem={(item, id) => (
              <>
                <Bilingual
                  label="Label"
                  name={fieldName('entries', id, 'label')}
                  value={text(item['label'] as DraftText)}
                />
                <Text
                  label="URL (https://…)"
                  name={fieldName('entries', id, 'url')}
                  defaultValue={String(item['url'] ?? '')}
                />
              </>
            )}
          />
        </>
      );
    }
    case 'contact':
      return (
        <>
          <Bilingual label="Title" name="title" value={text(encoded['title'] as DraftText)} />
          <RichTextPreview
            label="Directions"
            nodes={encoded['directions'] as ReadonlyArray<Record<string, unknown>> | undefined}
          />
        </>
      );
    case 'volunteer':
      return (
        <>
          <RichTextPreview
            label="Title"
            nodes={encoded['title'] as ReadonlyArray<Record<string, unknown>> | undefined}
          />
          <Bilingual
            label="Subtitle"
            name="subtitle"
            value={text(encoded['subtitle'] as DraftText)}
            multiline
          />
          <Bilingual
            label="Directions heading"
            name="directions"
            value={text(encoded['directions'] as DraftText)}
          />
        </>
      );
    case 'home': {
      const join = (encoded['join'] ?? {}) as Record<string, unknown>;
      const mission = (encoded['mission'] ?? {}) as Record<string, unknown>;
      const newsletter = (encoded['newsletter'] ?? {}) as Record<string, unknown>;
      return (
        <>
          <Bilingual label="Tagline" name="tagline" value={text(encoded['tagline'] as DraftText)} />
          <Bilingual
            label="Mission · read-story label"
            name="mission.readStoryLabel"
            value={text(mission['readStoryLabel'] as DraftText)}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-neutral-800">
              Mission · photo
            </legend>
            <ImageUpload
              keyPath="mission.photo.key"
              currentKey={String(
                ((mission['photo'] ?? {}) as Record<string, unknown>)['key'] ??
                  '',
              )}
            />
            <Bilingual
              label="Mission photo alt"
              name="mission.photo.alt"
              value={text(
                ((mission['photo'] ?? {}) as Record<string, unknown>)[
                  'alt'
                ] as DraftText,
              )}
            />
          </fieldset>
          <Bilingual label="Join · title" name="join.title" value={text(join['title'] as DraftText)} />
          <Bilingual
            label="Join · subtitle"
            name="join.subtitle"
            value={text(join['subtitle'] as DraftText)}
            multiline
          />
          <Bilingual
            label="Join · donate label"
            name="join.donateLabel"
            value={text(join['donateLabel'] as DraftText)}
          />
          <Bilingual
            label="Join · volunteer label"
            name="join.volunteerLabel"
            value={text(join['volunteerLabel'] as DraftText)}
          />
          <Bilingual
            label="Newsletter · title"
            name="newsletter.title"
            value={text(newsletter['title'] as DraftText)}
          />
          <Bilingual
            label="Newsletter · subtitle"
            name="newsletter.subtitle"
            value={text(newsletter['subtitle'] as DraftText)}
            multiline
          />
          <Bilingual
            label="Newsletter · socials"
            name="newsletter.socials"
            value={text(newsletter['socials'] as DraftText)}
            multiline
          />
        </>
      );
    }
    case 'team': {
      // The encoded draft carries each image slot as `{ key?, alt? }` (the lax
      // `DraftImageRef`); read the current key + alt off whichever is present.
      const groupPhoto = (encoded['groupPhoto'] ?? {}) as Record<string, unknown>;
      const portrait = (encoded['portrait'] ?? {}) as Record<string, unknown>;
      return (
        <>
          <RichTextPreview
            label="Title"
            nodes={encoded['title'] as ReadonlyArray<Record<string, unknown>> | undefined}
          />
          <Bilingual
            label="Subtitle"
            name="subtitle"
            value={text(encoded['subtitle'] as DraftText)}
            multiline
          />
          <Bilingual
            label="Board heading"
            name="boardHeading"
            value={text(encoded['boardHeading'] as DraftText)}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-neutral-800">
              Group photo
            </legend>
            <ImageUpload
              keyPath="groupPhoto.key"
              currentKey={String(groupPhoto['key'] ?? '')}
            />
            <Bilingual
              label="Group photo alt"
              name="groupPhoto.alt"
              value={text(groupPhoto['alt'] as DraftText)}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-neutral-800">
              Portrait
            </legend>
            <ImageUpload
              keyPath="portrait.key"
              currentKey={String(portrait['key'] ?? '')}
            />
            <Bilingual
              label="Portrait alt"
              name="portrait.alt"
              value={text(portrait['alt'] as DraftText)}
            />
          </fieldset>
        </>
      );
    }
    default:
      // Exhaustive over `PageId`: if a new page is added to the registry without a
      // branch here, `page` is no longer `never` and `satisfies never` fails to
      // compile — the boundary the function doc promises actually holds
      // (`make-impossible-states-unrepresentable`). The throw is unreachable today.
      return ((_: never): never => {
        throw new Error(`PageEditor: no editor for page "${String(page)}"`);
      })(page satisfies never);
  }
}

export default function AdminPageEditor() {
  const { page, encoded, source, bucketConfigured, status } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{PAGE_LABELS[page]} page</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Edit this page&rsquo;s bilingual copy. Save a draft to keep it private;
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
        <Section title="Visibility" open>
          {/* The per-page `enabled` flag (Feature C): when off, the page 404s its
              public route + action and its nav link is absent — all data-driven.
              Rendered once for EVERY page (incl. team). The hidden companion in
              `Checkbox` guarantees a deterministic boolean override every save. */}
          <Checkbox
            label="Page enabled (visible in nav + routable)"
            name="enabled"
            defaultChecked={Boolean(
              (encoded as Record<string, unknown>)['enabled'] ?? true,
            )}
          />
        </Section>
        <Section title={`${PAGE_LABELS[page]} content`} open>
          <PageEditor page={page} encoded={encoded as Record<string, unknown>} />
        </Section>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 py-3 backdrop-blur">
          <p className="text-xs text-neutral-500">
            Draft writes <code>content/pages/{page}.draft.json</code>. Publish
            writes <code>content/pages/{page}.json</code> and busts only this
            page&rsquo;s read cache.
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
