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

import { extensionForType } from './image-types';
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
 * The accepted-image MIME gate + MIME↔extension table live in the leaf
 * `image-types` module so both this form-policy module and the pure
 * `image-optimize.server` resize boundary share one table without a cycle
 * (`derive-dont-sync`). Re-exported here so the route imports that already pull
 * `isAcceptedImageType` from `admin-form` keep working.
 */
export { isAcceptedImageType } from './image-types';
export { extensionForType };

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
    // Leaf-name coercion so the form's string FormData decodes at the typed schema
    // boundary: `chapter`/`verse` are numbers; `enabled` (the per-page visibility
    // checkbox, Feature C) is a real boolean — a bare `"true"`/`"false"` string
    // would NOT decode as `Schema.Boolean` (Codex #5/#12). The hidden-companion +
    // checkbox always post an `enabled` value, so this coercion is deterministic.
    const coerced: Json =
      (leaf === 'chapter' || leaf === 'verse') && value.trim() !== ''
        ? Number(value)
        : leaf === 'enabled'
          ? value === 'true'
          : value;
    setPath(root, path, coerced);
  }
  return root;
};

/**
 * Rewrite a FAQ-answer override leaf from the editor's plain-text bilingual input
 * shape (`{ en, fr }`) into the encoded single-`text`-token `RichText` shape
 * (`[{ _tag: 'text', value: { en, fr } }]`) the `FaqPage` schema decodes.
 *
 * Why this seam (registration-launch Branch 5.5, FAQ add→fill→publish loop): a
 * freshly-added FAQ item carries no `answer` (it is `optionalKey` in `DraftFaqPage`,
 * absent in `FaqPage` ⇒ publish-invalid). The admin route renders a plain bilingual
 * **answer** input for such an item so it CAN be filled, but the form posts it as a
 * dotted `items.<id>.answer.en/.fr` pair — a plain `{ en, fr }` object. The encoded
 * base `answer` is a `RichText` ARRAY, and `deepMerge`'s identity-keyed array merge
 * cannot address an array with an object override (it would silently drop the edit).
 * Converting the override leaf to a one-token `RichText` ARRAY makes `deepMerge` fall
 * to wholesale array-replacement, so the filled answer lands. The closed token model
 * is preserved — the route only edits answers as a single plain `text` run; rich
 * (link/bold/italic) answers stay read-only (`boundary-discipline`).
 *
 * An answer override is emitted ONLY when BOTH locales are non-empty: a single
 * `text` token's `value` is the strict both-locales `Text`, so a half-filled
 * `{ en: 'x', fr: '' }` would be rejected at DRAFT save — inconsistent with every
 * other field, whose empty half is draft-tolerated (ADR 0006). Dropping the
 * half-filled answer leaves it ABSENT instead: the draft saves, and publish stays
 * blocked until both halves are filled (ADR 0006: incomplete blocks publish, not
 * save). This is a pure rewrite of FAQ-answer leaves only; every other override
 * passes through untouched.
 */
export const normalizeFaqAnswers = (override: Json): Json => {
  if (!isPlainObject(override)) return override;
  const items = override['items'];
  if (items === undefined || !isPlainObject(items)) return override;
  const rewrittenItems: MutableJsonObject = {};
  for (const id of Object.keys(items)) {
    const item = items[id];
    if (item === undefined || !isPlainObject(item) || !('answer' in item)) {
      if (item !== undefined) rewrittenItems[id] = item;
      continue;
    }
    const answer = item['answer'];
    const { answer: _drop, ...rest } = item;
    if (isPlainObject(answer)) {
      const en = answer['en'];
      const fr = answer['fr'];
      // Emit the token only when both locales are present and non-empty; a
      // half-filled answer is dropped so the draft saves and publish stays
      // blocked (ADR 0006), never rejected at save by the strict `Text` token.
      if (
        typeof en === 'string' &&
        typeof fr === 'string' &&
        en.trim() !== '' &&
        fr.trim() !== ''
      ) {
        rewrittenItems[id] = {
          ...rest,
          answer: [{ _tag: 'text', value: { en, fr } }],
        };
        continue;
      }
    }
    rewrittenItems[id] = rest;
  }
  return { ...override, items: rewrittenItems };
};

/** A non-empty `key` string on an image-slot object (in a base or an override). */
const hasImageKey = (slot: Json | undefined): boolean =>
  slot !== undefined &&
  isPlainObject(slot) &&
  typeof slot['key'] === 'string' &&
  slot['key'].trim() !== '';

/**
 * The dotted paths of every OPTIONAL image slot an `/admin` page editor renders an
 * alt-text input for: Team's two TOP-LEVEL slots (`groupPhoto` / `portrait`) and
 * Home's slot NESTED one level under `mission` (`mission.photo`, Feature A
 * remediation). Each is a `Schema.optionalKey(ImageRef)` whose editor always posts
 * `<path>.alt.en/.fr` — so a plain save with no upload produces a present-but-
 * keyless `{ alt }` object that must be pruned (see `pruneKeylessImageOverrides`).
 * Declared ONCE here (`derive-dont-sync`): adding a new optional image slot is one
 * entry, not a new branch in the prune walk.
 */
const OPTIONAL_IMAGE_SLOT_PATHS: readonly string[] = [
  'groupPhoto',
  'portrait',
  'mission.photo',
];

/** Read the value at a dotted `path` inside a JSON object, or `undefined`. */
const valueAtPath = (root: Json | undefined, path: string): Json | undefined => {
  let cursor: Json | undefined = root;
  for (const segment of path.split('.')) {
    if (cursor === undefined || !isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

/**
 * Drop an optional image-slot override (Team's `groupPhoto` / `portrait`, Home's
 * `mission.photo`) that carries ONLY alt text and no uploaded `key` — UNLESS the
 * current draft already has a `key` for that slot (then the alt edit must land onto
 * the existing image).
 *
 * Why this seam (mirrors `normalizeFaqAnswers`, registration-launch Branch 5.5):
 * an image-slot editor ALWAYS renders the slot's alt-text `Bilingual` inputs, which
 * always post `<slot>.alt.en/.fr`. On a plain save with no image uploaded,
 * `assembleOverrides` therefore produces a `<slot>: { alt: { en, fr } }` object with
 * NO `key`. That is DRAFT-valid (the lax `DraftImageRef` makes `key` optional) but
 * PUBLISH-INVALID: the strict `ImageRef` sees the slot as *present* and rejects it
 * with `<slot>.key: Missing key`. Section-skip is for *absence* of the whole slot
 * (ADR 0008), not a present-but-keyless object — so the keyless alt-only override is
 * pruned, leaving the slot absent and the save/publish path clean. Once an image IS
 * uploaded (the draft base carries `key`), the alt override is kept so the
 * upload-first / fill-alt-second flow completes (ADR 0006).
 *
 * Each slot is addressed by its dotted path (`OPTIONAL_IMAGE_SLOT_PATHS`), so a
 * NESTED slot (`mission.photo`) is pruned by walking into `mission` and dropping a
 * keyless `photo` — leaving `mission`'s other keys (`readStoryLabel`) untouched. A
 * scope with none of these paths passes through verbatim.
 */
export const pruneKeylessImageOverrides = (base: Json, override: Json): Json => {
  if (!isPlainObject(override)) return override;
  let result: Json = override;
  for (const path of OPTIONAL_IMAGE_SLOT_PATHS) {
    const slot = valueAtPath(result, path);
    if (
      slot !== undefined &&
      isPlainObject(slot) &&
      !hasImageKey(slot) &&
      !hasImageKey(valueAtPath(base, path))
    ) {
      // Keyless, no existing image — drop so the slot stays absent. Removing a
      // nested path rebuilds only the objects along it (the rest is shared).
      result = removeAtPath(result, path);
    }
  }
  return result;
};

/**
 * Return a copy of `root` with the value at the dotted `path` removed, rebuilding
 * only the objects along the path (every sibling and untouched subtree is shared by
 * reference — the override is never mutated). A path segment whose parent isn't a
 * plain object is a no-op (the slot wasn't there to begin with).
 */
const removeAtPath = (root: Json, path: string): Json => {
  const segments = path.split('.');
  const recur = (node: Json | undefined, depth: number): Json | undefined => {
    if (node === undefined || !isPlainObject(node)) return node;
    const segment = segments[depth];
    if (segment === undefined) return node;
    const next: MutableJsonObject = { ...node };
    if (depth === segments.length - 1) {
      delete next[segment];
      return next;
    }
    const child = recur(next[segment], depth + 1);
    if (child === undefined) delete next[segment];
    else next[segment] = child;
    return next;
  };
  return recur(root, 0) ?? root;
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
