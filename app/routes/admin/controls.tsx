import { useRef } from 'react';
import { useFetcher } from 'react-router';

import { listOpFieldName } from '~/lib/content/list-edit';

/**
 * Shared `/admin` editor controls + field inputs (registration-launch Branch 5.5).
 *
 * The site editor (`content.tsx`) and the per-Page editor (`pages.$page.tsx`) both
 * build the same surface: a collapsible `Section`, bilingual / plain `Text` inputs,
 * an image uploader, and the id-keyed list controls (Add / Remove / move). They
 * used to live inline in `content.tsx`; Branch 5.5's per-page sections reuse the
 * SAME controls, so they are hoisted here once rather than copied
 * (`subtract-before-you-add`, `derive-dont-sync`). This is a plain component module
 * (no `loader` / `action`), not a route — `routes.ts` is explicit, so it is never
 * mounted as a route.
 *
 * Every list control submits out-of-band via `useFetcher` (NOT a nested `<form>`):
 * the editor's main `<Form>` wraps every section, and HTML forbids nested forms, so
 * a control posts a one-off `FormData` carrying `intent=list-op` + the
 * `list:<path>:<kind>` control field, and the action revalidates the loader so the
 * changed list re-renders.
 */

/** The shape every `/admin` editor action returns on a non-redirect failure. */
export type ActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues: readonly string[];
    };

const inputClassName =
  'block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20';

/** A single labelled text / textarea input bound to a dotted form-field `name`. */
export function Text({
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
          className={inputClassName}
        />
      ) : (
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          className={inputClassName}
        />
      )}
    </label>
  );
}

/** An EN/FR pair of `Text` inputs for one bilingual field (`<name>.en` / `<name>.fr`). */
export function Bilingual({
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
        <Text
          label="EN"
          name={`${name}.en`}
          defaultValue={value.en}
          multiline={multiline}
        />
        <Text
          label="FR"
          name={`${name}.fr`}
          defaultValue={value.fr}
          multiline={multiline}
        />
      </div>
    </fieldset>
  );
}

/** A collapsible titled section wrapping a group of fields. */
export function Section({
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
 * A per-image uploader. Posts to the editor route's action via `useFetcher` (not a
 * nested `<form>`); the "Upload" button hands a one-off `FormData` carrying
 * `intent=upload:<keyPath>` and the chosen `file` as multipart. The action stores
 * the bytes and rewrites that key on the draft, then redirects, revalidating this
 * route's loader so the new key shows.
 */
export function ImageUpload({
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

/**
 * Submit a single id-keyed list op (ADR 0006) out-of-band via `useFetcher`. The
 * `value` carries the op payload: an item `id` for add/remove, or the comma-joined
 * surviving ids for a reorder.
 */
export function ListOpButton({
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
 * and remove. The `ids` is the list's current id order so a move computes the
 * swapped permutation client-side.
 */
export function ItemControls({
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
  // Swap two positions to compute the reorder permutation, guarding the bounds so
  // the disabled edge buttons never index past the array; out of range, the order
  // is returned unchanged.
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
export function AddItemButton({
  listPath,
  label,
  newId,
}: {
  readonly listPath: string;
  readonly label: string;
  readonly newId: string;
}) {
  return (
    <ListOpButton
      listPath={listPath}
      kind="add"
      value={newId}
      label={label}
      variant="add"
    />
  );
}
