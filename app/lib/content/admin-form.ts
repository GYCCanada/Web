/**
 * Pure helpers for the `/admin` content editor (CMS plan sub-commit C5).
 *
 * The editor edits the one `SiteContent` document. Rather than rebuild the whole
 * (deeply nested, array-bearing) document from scratch on every save — which
 * would make a single typo in one field able to drop an entire speaker bio — the
 * editor takes the **merge-onto-current-document** approach
 * (`make-impossible-states-unrepresentable`, no-bail-outs):
 *
 *   1. the form carries only the fields it renders, named by their dotted JSON
 *      path — list items and conferences keyed by their stable **identity**
 *      (`conferences./2026.themeName.en`, `team.<id>.name`, `translations.fr.…`),
 *      never by array position (ADR 0006);
 *   2. `assembleOverrides` parses those into a nested partial object tree;
 *   3. `deepMerge` overlays that partial onto the *encoded current document*,
 *      reconciling each array by item identity, so every unedited field (long
 *      bios, image keys, `Option` registration windows omitted from the encoded
 *      JSON) survives verbatim and an edit can never land on the wrong item after
 *      a list grew or shrank;
 *   4. the route then Schema-decodes the merged result — the single boundary
 *      where an edit can be rejected (`boundary-discipline`).
 *
 * Keeping this logic pure and separate from the route makes it unit-testable
 * without a runtime (`small-interface-deep-implementation`).
 */

import { AssetKey } from './schema';

/**
 * A JSON-shaped value the merge/assemble helpers move around. Arrays / objects
 * are `readonly` so an encoded Effect-Schema value (whose fields are deeply
 * `readonly`) is assignable without a cast; the helpers never mutate their
 * inputs (they build fresh values / clone).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

type MutableJsonObject = Record<string, Json>;

const isPlainObject = (value: Json): value is { readonly [k: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The form field-name prefix that marks an image-upload submit. The editor's
 * per-image "Upload" buttons submit `intent=upload:<dotted-key-path>` so the
 * action knows which `…photo.key` / `hero.<crop>.key.<locale>` field to rewrite
 * with the new bucket key once the bytes are stored.
 */
export const IMAGE_UPLOAD_INTENT_PREFIX = 'upload:';

/**
 * The accepted upload content-types. The resize/WebP pipeline is deferred (CMS
 * plan §"Non-goals"); for now we store the raw bytes under their original
 * content-type, so we only need to gate the obviously-image MIME types to keep
 * a stray PDF / script out of the image namespace.
 */
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const isAcceptedImageType = (type: string): boolean =>
  ACCEPTED_IMAGE_TYPES.has(type.toLowerCase());

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const extensionForType = (type: string): string =>
  EXTENSION_BY_TYPE[type.toLowerCase()] ?? 'bin';

/**
 * Recover the dotted key path an image-upload intent targets, or `null` if the
 * intent is not an upload. The path is identity-keyed (ADR 0006), e.g.
 * `upload:conferences./2024.speakers.<id>.photo.key` →
 * `conferences./2024.speakers.<id>.photo.key`.
 */
export const imageUploadTarget = (intent: string): string | null => {
  if (!intent.startsWith(IMAGE_UPLOAD_INTENT_PREFIX)) return null;
  const path = intent.slice(IMAGE_UPLOAD_INTENT_PREFIX.length);
  return path.length > 0 ? path : null;
};

/**
 * Build a fresh bucket object key for an uploaded image, namespaced under
 * `images/` so it never collides with the bundled `public/<year>/…` art and is
 * obviously an editor upload. `seed` (a millisecond timestamp) keeps successive
 * uploads to the same field distinct so a stale cached image is never served
 * for a new upload (`make-operations-idempotent` — each upload is its own key).
 *
 * Returns a branded `AssetKey`, not a raw `string`: the construction
 * (`images/uploads/` namespace + a `[a-zA-Z0-9-]` slug) is valid by
 * construction, and `AssetKey.make` *validates* that invariant at the producer
 * boundary (`boundary-discipline`, `make-impossible-states-unrepresentable`) so
 * a non-`AssetKey` can never reach `DraftEditor.applyImageUpload`. A failure
 * here would be a slug-construction bug, surfaced as a throw — not a silent
 * widening.
 */
export const uploadedImageKey = (
  targetPath: string,
  contentType: string,
  seed: number,
): AssetKey => {
  const slug = targetPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return AssetKey.make(
    `images/uploads/${slug}-${seed}.${extensionForType(contentType)}`,
  );
};

/**
 * The form-name prefix for a single translation value. Translation keys contain
 * dots (`main.newsletter.title`), which collide with the dotted-path convention,
 * so translation inputs are named `TRANSLATION_FIELD_PREFIX<locale>:<key>` and
 * collected by `collectTranslations` rather than parsed by `assembleOverrides`
 * (which skips them). The key is kept whole — never split on its dots.
 */
export const TRANSLATION_FIELD_PREFIX = 't:';

export const translationFieldName = (locale: 'en' | 'fr', key: string): string =>
  `${TRANSLATION_FIELD_PREFIX}${locale}:${key}`;

const isTranslationField = (name: string): boolean =>
  name.startsWith(TRANSLATION_FIELD_PREFIX);

/**
 * Collect every `t:<locale>:<key>` form field into the bilingual translations
 * override, e.g. `t:en:main.newsletter.title` → `{ en: { 'main.newsletter.title':
 * '…' } }`. The key keeps its dots verbatim (it is a single map key, not a path).
 */
export const collectTranslations = (
  entries: Iterable<readonly [string, FormDataEntryValue]>,
): { readonly en: Record<string, string>; readonly fr: Record<string, string> } => {
  const en: Record<string, string> = {};
  const fr: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string' || !isTranslationField(name)) continue;
    const rest = name.slice(TRANSLATION_FIELD_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep === -1) continue;
    const locale = rest.slice(0, sep);
    const key = rest.slice(sep + 1);
    if (key === '') continue;
    if (locale === 'en') en[key] = value;
    else if (locale === 'fr') fr[key] = value;
  }
  return { en, fr };
};

/**
 * The stable identity of a list / conference item the merge keys on (ADR 0006):
 * a list item's `id` (a nanoid), or a conference's `slug` (`/2024`). Both are
 * **content** that round-trips through the schema, so an edit addresses an item
 * by identity rather than by array position. Returns `undefined` for an item
 * that carries neither (the index-keyed merge is gone — an identity-less item is
 * never an override target).
 */
const itemIdentity = (item: Json): string | undefined => {
  if (!isPlainObject(item)) return undefined;
  if (typeof item['id'] === 'string') return item['id'];
  if (typeof item['slug'] === 'string') return item['slug'];
  return undefined;
};

/**
 * Set `value` at the dotted `path` inside the fresh override `root`, creating
 * intermediate **objects** as needed. The override is a pure nested object tree:
 * every array in the document is addressed by item **identity** (ADR 0006), so a
 * list-item / conference segment (`/2024`, a nanoid) is an object KEY here, never
 * an array index — `setPath` therefore never builds arrays, and the identity
 * reconciliation against the base's real arrays happens in `deepMerge`. (The
 * index-keyed array construction this used to do is gone — registration-launch
 * Branch 2 sub-commit 2.4.)
 */
const setPath = (root: MutableJsonObject, path: string[], value: Json): void => {
  if (path.length === 0) return;
  let cursor: MutableJsonObject = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    if (segment === undefined) return;
    const existing: Json | undefined = cursor[segment];
    if (existing !== undefined && isPlainObject(existing)) {
      cursor = existing as MutableJsonObject;
    } else {
      const container: MutableJsonObject = {};
      cursor[segment] = container;
      cursor = container;
    }
  }
  const leaf = path[path.length - 1];
  if (leaf === undefined) return;
  cursor[leaf] = value;
};

/**
 * Assemble the nested override object from the editor form. Only entries whose
 * name is a dotted path are taken; control fields (`intent`, anything starting
 * with `_`) and non-string values (files) are skipped. A leaf named `chapter` /
 * `verse` is coerced to a number so the `BibleRef` integer fields decode.
 *
 * List items and conferences are named by their **identity** segment
 * (`team.<id>.name`, `conferences./2024.themeName.en` — ADR 0006), so the
 * assembled override is a pure object tree keyed by identity; `deepMerge`
 * reconciles it against the base's arrays by matching that identity.
 */
export const assembleOverrides = (
  entries: Iterable<readonly [string, FormDataEntryValue]>,
): Json => {
  const root: MutableJsonObject = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue;
    if (name === 'intent' || name.startsWith('_')) continue;
    if (isTranslationField(name)) continue;
    const path = name.split('.');
    const leaf = path[path.length - 1];
    const coerced: Json =
      (leaf === 'chapter' || leaf === 'verse') && value.trim() !== ''
        ? Number(value)
        : value;
    setPath(root, path, coerced);
  }
  return root;
};

/**
 * Deep-merge `overrides` onto `base`, returning a new value. `base` and
 * `overrides` are never mutated.
 *
 * Objects merge key-by-key. An **array** in `base` is merged by item
 * **identity** (ADR 0006), NOT by position: `overrides` for a list arrives as an
 * identity-map (`{ <id>: partial }` for `team`/`speakers`, `{ "/2024": partial }`
 * for `conferences`), and each override key is matched against the base item
 * whose `id` / `slug` equals it — so editing `conferences./2024.themeName.en`
 * overlays only that conference's leaf and leaves every other item (and every
 * unedited deep field) untouched, even if list positions shifted from an
 * add/remove. A base item no override names survives verbatim; an override key
 * that matches no base item is ignored (structural add/remove is `applyListEdit`'s
 * job, never a field merge's). Every scalar (string / number / boolean / null) is
 * replaced.
 *
 * The old index-aligned array branch is gone (registration-launch Branch 2
 * sub-commit 2.4): position is no longer an identity, so an edit can never land
 * on the wrong item after a list grew or shrank.
 */
export const deepMerge = (base: Json, overrides: Json): Json => {
  // Identity-keyed merge: an object override onto an array base addresses items
  // by `id` / `slug`, never by index.
  if (Array.isArray(base) && isPlainObject(overrides)) {
    return base.map((item) => {
      const identity = itemIdentity(item);
      if (identity === undefined) return item;
      const next = overrides[identity];
      return next === undefined ? item : deepMerge(item, next);
    });
  }
  if (isPlainObject(base) && isPlainObject(overrides)) {
    const result: MutableJsonObject = { ...base };
    for (const key of Object.keys(overrides)) {
      const next = overrides[key];
      result[key] =
        key in base && next !== undefined
          ? deepMerge(base[key] as Json, next)
          : (next as Json);
    }
    return result;
  }
  return overrides;
};

/**
 * Set the leaf at a dotted `path` on a structurally-cloned copy of `doc`,
 * resolving each segment by **identity** when it descends into an array (ADR
 * 0006): a `<slug>` / `<id>` segment selects the array item whose `slug` / `id`
 * equals it, never an array index. The image-upload rewrite (`applyImageUpload`)
 * targets a key this way (`team.<id>.photo.key`,
 * `conferences./2024.speakers.<id>.photo.key`), so a freshly-reordered list never
 * rewrites the wrong item's image. A segment that resolves to no array item (or a
 * non-container) leaves `doc` untouched — the strict decode downstream is the gate.
 */
export const setAtPath = (doc: Json, path: string, value: Json): Json => {
  const clone = structuredClone(doc) as Json;
  return setByIdentity(clone, path.split('.'), value);
};

/**
 * Return a fresh `node` with `value` set at `path`, navigating objects by key
 * and arrays by item **identity** (`id` / `slug`). Missing **object** keys along
 * the path are created (so an image upload to a freshly-added stub item — which
 * carries only its `id`, with no `photo` object yet — still lands its key, just
 * as the old positional `setPath` created intermediates). An **array** segment is
 * never fabricated: an identity that matches no item leaves `node` unchanged (a
 * structural add is `applyListEdit`'s job, never an upload's). Containers along
 * the path are cloned, so the input is never mutated.
 */
const setByIdentity = (
  node: Json,
  path: readonly string[],
  value: Json,
): Json => {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (Array.isArray(node)) {
    let hit = false;
    const next = node.map((item) => {
      if (hit || itemIdentity(item) !== head) return item;
      hit = true;
      return setByIdentity(item, rest, value);
    });
    return hit ? next : node;
  }
  if (isPlainObject(node)) {
    if (rest.length === 0) return { ...node, [head]: value };
    const existing: Json | undefined = node[head];
    // Descend into an existing container; otherwise create a fresh object so the
    // remaining path can be built (an absent or scalar slot is replaced, never
    // left to silently drop the write — mirrors the old `setPath`).
    const child: Json =
      existing !== undefined &&
      (isPlainObject(existing) || Array.isArray(existing))
        ? existing
        : {};
    return { ...node, [head]: setByIdentity(child, rest, value) };
  }
  return node;
};
