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
 *      path (`conferences.2.themeName.en`, `team.0.name`, `translations.fr.…`);
 *   2. `assembleOverrides` parses those into a nested partial object;
 *   3. `deepMerge` overlays that partial onto the *encoded current document*, so
 *      every unedited field (long bios, image keys, `Option` registration
 *      windows omitted from the encoded JSON) survives verbatim;
 *   4. the route then Schema-decodes the merged result — the single boundary
 *      where an edit can be rejected (`boundary-discipline`).
 *
 * Keeping this logic pure and separate from the route makes it unit-testable
 * without a runtime (`small-interface-deep-implementation`).
 */

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
 * intent is not an upload. E.g. `upload:conferences.0.speakers.1.photo.key` →
 * `conferences.0.speakers.1.photo.key`.
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
 */
export const uploadedImageKey = (
  targetPath: string,
  contentType: string,
  seed: number,
): string => {
  const slug = targetPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `images/uploads/${slug}-${seed}.${extensionForType(contentType)}`;
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

const isIndex = (segment: string): boolean => /^\d+$/.test(segment);

/**
 * Set `value` at the dotted `path` inside `root`, creating intermediate objects
 * (or arrays, when the next segment is numeric) as needed. Mirrors the
 * paulo-suzanne admin's `setPath` but typed to `Json`.
 */
const setPath = (root: MutableJsonObject, path: string[], value: Json): void => {
  if (path.length === 0) return;
  let cursor: MutableJsonObject | Json[] = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    const next = path[i + 1];
    if (segment === undefined || next === undefined) return;
    const key = Array.isArray(cursor) ? Number(segment) : segment;
    const existing = (cursor as MutableJsonObject)[key as keyof typeof cursor];
    if (isPlainObject(existing as Json) || Array.isArray(existing)) {
      cursor = existing as MutableJsonObject | Json[];
    } else {
      const container: MutableJsonObject | Json[] = isIndex(next) ? [] : {};
      (cursor as MutableJsonObject)[String(key)] = container;
      cursor = container;
    }
  }
  const leaf = path[path.length - 1];
  if (leaf === undefined) return;
  if (Array.isArray(cursor) && isIndex(leaf)) {
    cursor[Number(leaf)] = value;
  } else {
    (cursor as MutableJsonObject)[leaf] = value;
  }
};

/**
 * Assemble the nested override object from the editor form. Only entries whose
 * name is a dotted path are taken; control fields (`intent`, anything starting
 * with `_`) and non-string values (files) are skipped. A leaf named `chapter` /
 * `verse` is coerced to a number so the `BibleRef` integer fields decode.
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
 * Deep-merge `overrides` onto `base`, returning a new value. Objects merge
 * key-by-key; arrays merge element-by-element by index (so editing
 * `conferences.0.themeName.en` overlays only that leaf and leaves
 * `conferences.0.speakers` untouched); every other value (string / number /
 * boolean / null) is replaced. `base` and `overrides` are never mutated.
 */
export const deepMerge = (base: Json, overrides: Json): Json => {
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
  if (Array.isArray(base) && Array.isArray(overrides)) {
    const result: Json[] = [...base];
    for (let i = 0; i < overrides.length; i += 1) {
      const next = overrides[i];
      if (next === undefined) continue;
      result[i] = i < base.length ? deepMerge(base[i] as Json, next) : next;
    }
    return result;
  }
  return overrides;
};

/** Set the leaf at a dotted `path` on a structurally-cloned copy of `doc`. */
export const setAtPath = (doc: Json, path: string, value: Json): Json => {
  const clone = structuredClone(doc) as MutableJsonObject;
  setPath(clone, path.split('.'), value);
  return clone;
};
