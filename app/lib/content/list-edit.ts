/**
 * Id-keyed list editing (ADR 0006, registration-launch Branch 2 sub-commit 2.2).
 *
 * The `/admin` editor used to grow/shrink lists by **array position** — it never
 * could, in fact: the index-aligned `deepMerge` (`admin-form.ts`) can only
 * overlay *existing* indices, so "add a speaker" / "remove a team member" was the
 * CMS's headline gap (ADR 0006 Context). Now every list item carries a stable
 * `id: ListItemId` (sub-commit 2.1), and structural edits address items **by
 * id**, never by position.
 *
 * `applyListEdit` is the one deep operation: given the encoded document and a
 * sequence of `ListOp`s, it navigates to each target list by its dotted path and
 * applies an id-keyed add / remove / reorder. Identity — not position — is the
 * key (`make-impossible-states-unrepresentable`): an id absent from a list is
 * appended, an id present but not named survives, and a reorder is an explicit
 * permutation of the surviving ids. The function is pure: it clones once and
 * never mutates its input (`boundary-discipline`).
 *
 * The op-constructor sugar (`addOp`/`removeOp`/`reorderOp`), the control-field
 * parser (`collectListOps`), and the id-keyed form field-name template
 * (`fieldName`) are thin helpers around that one capability — they are NOT the
 * interface's depth; `applyListEdit` is (`small-interface-deep-implementation`).
 */

import type { Json } from './admin-form';
import type { ListItemId } from './schema';

const isPlainObject = (value: Json): value is { readonly [k: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A dotted path to a list (array) inside the encoded document — e.g. `team`, or
 * `conferences./2024.speakers`. A segment that descends THROUGH an array selects
 * the item by its **identity** (a conference's `slug`, a list item's `id` — ADR
 * 0006), never by position; string segments key into an object. The path
 * addresses the **array**, not an item; the item to add / remove / reorder is
 * addressed by its `id` inside the `ListOp`.
 */
export type ListPath = string;

/**
 * A single structural list edit, addressed by item id (ADR 0006). Exactly one of
 * add / remove / reorder per op so an op can never be two things at once
 * (`make-impossible-states-unrepresentable`):
 *   - `add`    — append a fresh item `{ id }` (empty otherwise) to the list. Its
 *                required fields are absent, so it is publish-invalid until edited
 *                (ADR 0006 consequence) — the id exists server-side so a later
 *                photo upload / field edit has a target.
 *   - `remove` — drop the item whose `id` matches; a no-op if absent.
 *   - `reorder`— reorder the list to the given `ids` permutation; ids not present
 *                are ignored and present-but-unnamed ids keep their relative order
 *                after the named ones (so a partial order never drops an item).
 */
export type ListOp =
  | { readonly add: { readonly listPath: ListPath; readonly id: ListItemId } }
  | { readonly remove: { readonly listPath: ListPath; readonly id: ListItemId } }
  | {
      readonly reorder: {
        readonly listPath: ListPath;
        readonly ids: readonly ListItemId[];
      };
    };

export const addOp = (listPath: ListPath, id: ListItemId): ListOp => ({
  add: { listPath, id },
});

export const removeOp = (listPath: ListPath, id: ListItemId): ListOp => ({
  remove: { listPath, id },
});

export const reorderOp = (
  listPath: ListPath,
  ids: readonly ListItemId[],
): ListOp => ({ reorder: { listPath, ids } });

/** The `id` of a list item, or `undefined` when the item is not an id-bearing object. */
const itemId = (item: Json): string | undefined =>
  isPlainObject(item) && typeof item['id'] === 'string' ? item['id'] : undefined;

/**
 * The stable identity a *path segment* matches an array item by (ADR 0006): a
 * list item's `id`, or a conference's `slug`. Used to navigate THROUGH an array
 * (e.g. `conferences./2024.speakers`) to a nested list — positional indexing is
 * gone, so a reordered `conferences` array still resolves the right year.
 */
const navIdentity = (item: Json): string | undefined => {
  if (!isPlainObject(item)) return undefined;
  if (typeof item['id'] === 'string') return item['id'];
  if (typeof item['slug'] === 'string') return item['slug'];
  return undefined;
};

/**
 * Apply one op to the array `list`, returning a fresh array (never mutating). The
 * op kinds are exhaustive over the `ListOp` union, so adding a kind without
 * handling it is a type error (`make-impossible-states-unrepresentable`).
 */
const stubListItem = (listPath: ListPath, id: ListItemId): Json => {
  if (listPath.endsWith('.hotels')) {
    return { id, roomRates: [] };
  }
  return { id };
};

const applyOp = (list: readonly Json[], op: ListOp): readonly Json[] => {
  if ('add' in op) {
    // Appending a duplicate id would make two items share an identity, which the
    // id-keyed merge could no longer distinguish — guard it (the caller mints a
    // fresh id, so this only fires on a malformed resubmission).
    if (list.some((item) => itemId(item) === op.add.id)) return list;
    return [...list, stubListItem(op.add.listPath, op.add.id)];
  }
  if ('remove' in op) {
    return list.filter((item) => itemId(item) !== op.remove.id);
  }
  // reorder: place the named ids first in their given order, then append any
  // surviving item the order omitted (in its original relative order) so a
  // partial / stale order can never silently drop an item.
  const named = new Map(
    list.flatMap((item) => {
      const id = itemId(item);
      return id === undefined ? [] : ([[id, item]] as const);
    }),
  );
  const ordered: Json[] = [];
  const placed = new Set<string>();
  for (const id of op.reorder.ids) {
    const item = named.get(id);
    if (item !== undefined && !placed.has(id)) {
      ordered.push(item);
      placed.add(id);
    }
  }
  for (const item of list) {
    const id = itemId(item);
    if (id === undefined || !placed.has(id)) ordered.push(item);
  }
  return ordered;
};

/**
 * Navigate to the array at `path` inside `root`, replace it via `update`, and
 * return a fresh document. When the path descends THROUGH an array (e.g.
 * `conferences./2024.speakers`), the next segment selects the array item by its
 * **identity** (`slug` / `id`), never by position (ADR 0006, sub-commit 2.4) — so
 * a reordered `conferences` still resolves the right year. Intermediate
 * containers are cloned along the path so the input is never mutated; a path that
 * does not resolve to an array (an unknown identity, a malformed control field)
 * is left untouched — the strict decode downstream is the gate.
 */
const updateListAtPath = (
  root: Json,
  path: readonly string[],
  update: (list: readonly Json[]) => readonly Json[],
  depth = 0,
): Json => {
  if (path.length === 0) {
    return Array.isArray(root) ? update(root) : root;
  }
  const [head, ...rest] = path;
  if (head === undefined) return root;

  if (Array.isArray(root)) {
    const index = root.findIndex((item) => navIdentity(item) === head);
    if (index < 0) return root;
    const next = [...root];
    next[index] = updateListAtPath(root[index] as Json, rest, update, depth + 1);
    return next;
  }

  if (isPlainObject(root)) {
    if (!(head in root)) {
      if (rest.length > 0) {
        return {
          ...root,
          [head]: updateListAtPath({}, rest, update, depth + 1),
        };
      }
      // A missing top-level list path is a no-op; nested section lists may be
      // materialized on add (e.g. parking.options on a legacy section object).
      if (depth === 0) return root;
      return { ...root, [head]: update([]) };
    }
    return {
      ...root,
      [head]: updateListAtPath(root[head] as Json, rest, update, depth + 1),
    };
  }

  return root;
};

/**
 * Apply a sequence of id-keyed list ops to the encoded document, returning a new
 * document (the input is never mutated — `boundary-discipline`). Ops apply in
 * order, so a reorder naming a just-added id sees it. A `listPath` that does not
 * resolve to an array is skipped; the merged result is Schema-decoded downstream,
 * the single boundary where an invalid edit (an empty appended item on publish)
 * is rejected.
 */
export const applyListEdit = (base: Json, ops: readonly ListOp[]): Json =>
  ops.reduce((doc, op) => {
    const listPath =
      'add' in op
        ? op.add.listPath
        : 'remove' in op
          ? op.remove.listPath
          : op.reorder.listPath;
    return updateListAtPath(doc, listPath.split('.'), (list) => applyOp(list, op));
  }, base);

// ---------------------------------------------------------------------------
// Control-field convention (admin view ⇄ action)
// ---------------------------------------------------------------------------

/**
 * The form field-name prefix marking a list-op control field. The view's per-list
 * Add / Remove / reorder controls submit `list:<listPath>:<kind>` so the action
 * can recover the ops with `collectListOps`. The prefix keeps these control
 * fields out of `assembleOverrides`' dotted-path namespace (which never starts
 * with `list:`), so the two parsers can read the same `FormData` without overlap.
 */
const LIST_OP_PREFIX = 'list:';

export type ListOpKind = 'add' | 'remove' | 'reorder';

export const listOpFieldName = (
  listPath: ListPath,
  kind: ListOpKind,
): string => `${LIST_OP_PREFIX}${listPath}:${kind}`;

/**
 * Parse the `list:<listPath>:<kind>` control fields of a submitted form into the
 * ordered op list. `add`/`remove` carry the target id as the value; `reorder`
 * carries the surviving ids comma-joined. Ids are kept as raw strings here
 * (parsed from untrusted form input) and branded only where `applyListEdit`
 * threads them back into the document the decoder validates — this helper does
 * not invent a brand at a non-boundary (`boundary-discipline`). A control field
 * with an empty / malformed value is skipped rather than throwing.
 */
export const collectListOps = (
  entries: Iterable<readonly [string, FormDataEntryValue]>,
): readonly ListOp[] => {
  const ops: ListOp[] = [];
  for (const [name, value] of entries) {
    if (typeof value !== 'string' || !name.startsWith(LIST_OP_PREFIX)) continue;
    const rest = name.slice(LIST_OP_PREFIX.length);
    const sep = rest.lastIndexOf(':');
    if (sep === -1) continue;
    const listPath = rest.slice(0, sep);
    const kind = rest.slice(sep + 1);
    if (listPath === '') continue;
    if (kind === 'add') {
      if (value !== '') ops.push(addOp(listPath, value as ListItemId));
    } else if (kind === 'remove') {
      if (value !== '') ops.push(removeOp(listPath, value as ListItemId));
    } else if (kind === 'reorder') {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '') as ListItemId[];
      if (ids.length > 0) ops.push(reorderOp(listPath, ids));
    }
  }
  return ops;
};

/**
 * The id-keyed form field-name for a leaf of a list item — e.g.
 * `fieldName('conferences./2024.speakers', id, 'name.en')` →
 * `conferences./2024.speakers.<id>.name.en`. This replaces the positional
 * templates (`conferences.0.speakers.1.name.en`) the index merge relied on (ADR
 * 0006); the id segment is a validated `ListItemId`, so it can never smuggle a
 * `.`-bearing path that would re-split into the wrong shape
 * (`boundary-discipline`).
 */
export const fieldName = (
  listPath: ListPath,
  id: ListItemId,
  leaf: string,
): string => `${listPath}.${id}.${leaf}`;
