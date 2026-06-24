export * as DraftEditor from './draft-editor.server';

import { Context, Effect, Layer, Option, Schema, SchemaIssue } from 'effect';

import {
  Content,
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
  bustForm,
  bustPage,
  bustSite,
  type BustTarget,
} from '../content.server';
import {
  deepMerge,
  normalizeMergedSiteContent,
  pruneKeylessImageOverrides,
  setAtPath,
  type Json,
} from './admin-form';
import { defaultDraftContent } from './defaults';
import { backfillListItemIds } from './id-backfill';
import { applyListEdit, type ListOp } from './list-edit';
import {
  FORM_SPECS,
  PAGE_SPECS,
  formDraftKey,
  formObjectKey,
  pageDraftKey,
  pageObjectKey,
  type FormContent,
  type FormId,
  type ObjectSpec,
  type PageContent,
  type PageId,
} from './pages/registry';
import { DraftSiteContent, SiteContent, type AssetKey } from './schema';
import type { DraftSiteContent as DraftSiteContentType } from './schema';
import { Storage } from '../storage.server';
import type { ObjectHead } from '../storage.server';

/**
 * `DraftEditor` is the deep module the `/admin` editor write path talks to
 * (registration-launch plan, Branches 1 + 5). It absorbs the encode→merge→decode→
 * re-encode→store-draft pipeline that used to be inlined and *duplicated* across
 * the upload and save/publish branches of the route action — the route shrinks to
 * "auth → parse intent → call `DraftEditor` → map result to `Response`".
 *
 * Branch 5.2 WIDENS the `ContentScope` union from one inhabitant (`site`) to the
 * per-Page and per-Form objects (ADR 0008): `editDocument` / `applyImageUpload` /
 * `applyListOps` / `publish` / `load` now operate on ANY content object addressed
 * by its scope, each with its OWN draft/published key pair, decode boundary, and
 * default. The reconciliation algorithm did not fork — it routes through
 * `resolveScope(scope)`, which is the lone place a scope becomes a concrete
 * `{ draftKey, publishedKey, codec, default }` bundle (one site case + N
 * page/form cases). The bucket-key choreography never leaks back to the route.
 *
 * Principles (see `~/.brain/principles`):
 *   - `small-interface-deep-implementation`: `load`, `editDocument`,
 *     `applyImageUpload`, `applyListOps`, `publish` hide the whole per-object
 *     draft/published key-pair choreography, the double draft-read, and the
 *     merge/decode/re-encode dance — for every scope, the same five calls.
 *   - `make-impossible-states-unrepresentable`: every operation is addressed by a
 *     `ContentScope`, a *closed* union whose page/form members carry a closed
 *     `PageId` / `FormId`. `resolveScope` maps it to a real
 *     `{ draftKey, publishedKey }` pair — an editor cannot target a key that is
 *     not a known scope, and a scope cannot name a page/form that does not exist.
 *   - `derive-dont-sync`: the page/form key pairs, schemas, and defaults are NOT
 *     re-declared here — they resolve through the one `pages/registry` (the same
 *     registry Branch 5.3's read path reads), so the object set is enumerated once.
 *   - `boundary-discipline`: decode happens here, once, before a draft is stored;
 *     a rejected edit fails with an `IssueError` carrying the dotted field issues
 *     the editor surfaces.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** Address a single editable site-content object (conference / team / translations). */
export type SiteScope = { readonly kind: 'site' };

/**
 * Address one evergreen Page object (`content/pages/<page>.json`). Generic in the
 * `PageId` so a caller that names a concrete page (`pageScope('faq')`) gets the
 * precise page content type back from `load` / the writes, not a widened union.
 */
export type PageScope<P extends PageId = PageId> = {
  readonly kind: 'page';
  readonly page: P;
};

/** Address one Form definition object (`forms/<form>.json`). */
export type FormScope<F extends FormId = FormId> = {
  readonly kind: 'form';
  readonly form: F;
};

/**
 * What a `DraftEditor` operation targets. A closed union over the three object
 * families ADR 0008 splits storage into. Widened from a single inhabitant in
 * Branch 1; the page/form members carry the closed `PageId` / `FormId` so no scope
 * can name an object that does not exist.
 */
export type ContentScope = SiteScope | PageScope | FormScope;

/** The one site scope, named so callers never construct the literal inline. */
export const siteScope: SiteScope = { kind: 'site' };

/** The scope addressing one evergreen Page (keeps the concrete `PageId`). */
export const pageScope = <P extends PageId>(page: P): PageScope<P> => ({
  kind: 'page',
  page,
});

/** The scope addressing one Form definition (keeps the concrete `FormId`). */
export const formScope = <F extends FormId>(form: F): FormScope<F> => ({
  kind: 'form',
  form,
});

/** The draft/published bucket-key PAIR a scope addresses. */
export interface ScopeKeys {
  readonly draftKey: string;
  readonly publishedKey: string;
}

/**
 * Resolve a `ContentScope` to its draft/published key pair. The page/form keys
 * are derived from the id through `pages/registry` (`derive-dont-sync`); the site
 * pair is the historical `content/site(.draft).json`.
 */
export const scopeKeys = (scope: ContentScope): ScopeKeys => {
  switch (scope.kind) {
    case 'site':
      return {
        draftKey: SITE_CONTENT_DRAFT_KEY,
        publishedKey: SITE_CONTENT_KEY,
      };
    case 'page':
      return {
        draftKey: pageDraftKey(scope.page),
        publishedKey: pageObjectKey(scope.page),
      };
    case 'form':
      return {
        draftKey: formDraftKey(scope.form),
        publishedKey: formObjectKey(scope.form),
      };
  }
};

/**
 * Map a `ContentScope` (which carries the draft/published key PAIR) to the
 * `Content` read path's `BustTarget` (which names only the *published* cache to
 * invalidate). `publish` promotes a scope's draft to its published object, so the
 * cache it must bust is that scope's published read cache — site / page / form —
 * so the change is live on the next read with no redeploy, and ONLY that object's
 * cache is invalidated (ADR 0008's per-object isolation).
 */
const bustTargetOf = (scope: ContentScope): BustTarget => {
  switch (scope.kind) {
    case 'site':
      return bustSite;
    case 'page':
      return bustPage(scope.page);
    case 'form':
      return bustForm(scope.form);
  }
};

/**
 * The decoded DRAFT value a scope's `load` returns. Site is the laxer
 * `DraftSiteContent` (a freshly-added list item may carry only its `id`, ADR
 * 0006); a Page/Form is its own typed object. The conditional ties each scope
 * member to the concrete type its registry entry decodes to, so a caller that
 * narrows the scope statically gets the narrow content type (no widened union).
 */
export type ScopeContent<S extends ContentScope> = S extends SiteScope
  ? DraftSiteContentType
  : S extends { readonly kind: 'page'; readonly page: infer P extends PageId }
    ? PageContent<P>
    : S extends { readonly kind: 'form'; readonly form: infer F extends FormId }
      ? FormContent<F>
      : never;

/**
 * The encoded form of a scope's content, returned to the view by a write
 * (`editDocument` / `applyImageUpload` / `applyListOps`) so the route can
 * revalidate without a re-read. Site is the `DraftSiteContent` encoded shape; a
 * Page/Form is its schema's `Encoded`.
 */
export type ScopeEncoded<S extends ContentScope> = S extends SiteScope
  ? typeof DraftSiteContent.Encoded
  : Json;

/** Where the editor's content for a scope originated, for the admin banner. */
export type LoadedSource = 'draft' | 'published' | 'defaults';

/** What `load` returns: the decoded content for a scope plus its origin. */
export interface Loaded<S extends ContentScope> {
  readonly content: ScopeContent<S>;
  readonly source: LoadedSource;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * The single failure a `DraftEditor` write surfaces to the route. It carries a
 * human `message`, the dotted-path `issues` of a rejected decode (empty for a
 * storage failure), and the HTTP `status` the route maps to a `Response` (400
 * for a validation reject, 502 for a storage failure). Keeping the status here
 * means the route maps every outcome the same way regardless of which operation
 * produced it (`small-interface-deep-implementation`).
 */
export class IssueError extends Schema.TaggedErrorClass<IssueError>()(
  'DraftEditor.IssueError',
  {
    message: Schema.String,
    issues: Schema.Array(Schema.String),
    status: Schema.Number,
  },
) {}

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/** Flatten a schema `Issue` tree to dotted-path messages for the editor. */
const issueMessages = (issue: SchemaIssue.Issue): readonly string[] =>
  formatIssue(issue).issues.map((entry) => {
    const path = entry.path?.map((segment) => String(segment)).join('.');
    return path ? `${path}: ${entry.message}` : entry.message;
  });

// ---------------------------------------------------------------------------
// Per-scope codec bundle — the one place a scope's decode/encode lives
// ---------------------------------------------------------------------------

const parseJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown),
);

/**
 * Everything the reconciliation algorithm needs about ONE scope's object: the
 * key pair, the codecs that move it between bucket-JSON / decoded-DRAFT /
 * decoded-PUBLISH, and the bundled default. The reconciliation in `load` /
 * `editDocument` / `publish` is written ONCE against this bundle; only the bundle
 * varies per scope (`small-interface-deep-implementation`).
 *
 * The DRAFT path is laxer than the PUBLISH path for the SITE scope (ADR 0006,
 * Branch 2): a freshly-added list item may carry only its `id` until its
 * bilingual content is filled in, so the site draft decodes/encodes through
 * `DraftSiteContent` while publish promotes through the strict `SiteContent`. A
 * Page/Form has no id-only-add flow yet, so its draft and publish codecs are the
 * SAME strict schema — an honest current state, not a stub: when Branch 5.5 gives
 * pages the add-item flow it introduces the page draft variants and wires them
 * here, exactly as the site scope already is.
 *
 * `fromBucket` reads a draft (or published — also a valid draft) document FROM
 * the bucket: parse → (site only) id-backfill → decode-draft, so a site document
 * published before list-item ids existed still decodes. `decodeDraft` decodes an
 * already-merged/edited candidate at the single draft boundary — NO backfill, so
 * a genuinely missing id is rejected rather than masked. `decodePublish` is the
 * STRICT decode `publish` promotes through. `encodeDraft` yields the encoded
 * OBJECT (handed to the view); `encodeDraftJson` / `encodePublishJson` yield the
 * JSON STRING stored in the bucket (Effect Schema's JSON codec, per the lint
 * rule — not `JSON.stringify`).
 */
interface ScopeCodec {
  readonly keys: ScopeKeys;
  readonly default: unknown;
  /**
   * Read a draft (or published) document FROM the bucket: parse → (site only)
   * id-backfill → decode-draft. Fallible (the caller, `readDocument`, catches
   * every failure and logs it → `Option.none`, so a bad object never breaks the
   * editor open).
   */
  readonly fromBucket: (
    json: string,
  ) => Effect.Effect<unknown, Schema.SchemaError>;
  /**
   * Decode an already-merged/edited candidate at the single DRAFT boundary — NO
   * backfill, so a genuinely missing id is rejected rather than masked. Fallible:
   * the caller maps the failure to a 400 `IssueError`.
   */
  readonly decodeDraft: (
    candidate: unknown,
  ) => Effect.Effect<unknown, Schema.SchemaError>;
  /** The STRICT publish decode. Fallible: the caller maps the failure to a 400. */
  readonly decodePublish: (
    candidate: unknown,
  ) => Effect.Effect<unknown, Schema.SchemaError>;
  /** Encode a decoded value to its mergeable/view OBJECT. */
  readonly encodeObject: (
    value: unknown,
  ) => Effect.Effect<Json, Schema.SchemaError>;
  /** Encode a decoded DRAFT value to its canonical JSON string (bucket body). */
  readonly encodeDraftJson: (
    value: unknown,
  ) => Effect.Effect<string, Schema.SchemaError>;
  /** Encode a decoded PUBLISH value to its canonical JSON string (bucket body). */
  readonly encodePublishJson: (
    value: unknown,
  ) => Effect.Effect<string, Schema.SchemaError>;
}

/**
 * The SITE scope's codec bundle: laxer `DraftSiteContent` draft, strict
 * `SiteContent` publish, id-backfill on bucket read so a site document published
 * before list-item ids existed still decodes (ADR 0006).
 */
const decodeSiteDraft = Schema.decodeUnknownEffect(DraftSiteContent);
const decodeSitePublish = Schema.decodeUnknownEffect(SiteContent);
const encodeSiteObject = Schema.encodeUnknownEffect(DraftSiteContent);
const encodeSiteDraftJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(DraftSiteContent),
);
const encodeSitePublishJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(SiteContent),
);

const siteCodec: ScopeCodec = {
  keys: scopeKeys(siteScope),
  default: defaultDraftContent,
  fromBucket: (json) =>
    parseJson(json).pipe(
      Effect.map(backfillListItemIds),
      Effect.flatMap(decodeSiteDraft),
    ),
  decodeDraft: decodeSiteDraft,
  decodePublish: decodeSitePublish,
  encodeObject: (value) => encodeSiteObject(value) as Effect.Effect<Json, Schema.SchemaError>,
  encodeDraftJson: encodeSiteDraftJson,
  encodePublishJson: encodeSitePublishJson,
};

/**
 * Build a codec bundle for a Page/Form object from its registry `ObjectSpec`.
 *
 * Branch 5.5 gives the list-bearing pages (FAQ, give, about, archive) an add-item
 * flow, so their draft boundary is the LAXER `spec.draftSchema` (a freshly-added
 * id-only item is draft-valid) and the publish boundary the STRICT `spec.schema`
 * (re-enforcing the both-locales `Text` invariant) — exactly the site scope's
 * `DraftSiteContent`/`SiteContent` split. A page/form with no add-item flow wires
 * `draftSchema === schema` in the registry, so this same code path keeps draft and
 * publish identical for it without a special case (`derive-dont-sync`). There is
 * still no id-backfill: these objects are brand-new storage (ADR 0008), so no
 * pre-existing id-less document needs repairing.
 *
 * The DRAFT codecs (`fromBucket`, `decodeDraft`, `encodeObject`, `encodeDraftJson`)
 * move the object between bucket-JSON / decoded-draft / view-object through
 * `draftSchema`; the PUBLISH codecs (`decodePublish`, `encodePublishJson`) gate the
 * promotion through `schema`.
 */
const objectCodec = (
  spec: ObjectSpec<unknown, unknown>,
  keys: ScopeKeys,
): ScopeCodec => {
  const decodeDraft = Schema.decodeUnknownEffect(spec.draftSchema);
  const decodePublish = Schema.decodeUnknownEffect(spec.schema);
  const encodeObject = Schema.encodeUnknownEffect(spec.draftSchema);
  const encodeDraftJson = Schema.encodeUnknownEffect(
    Schema.fromJsonString(spec.draftSchema),
  );
  const encodePublishJson = Schema.encodeUnknownEffect(
    Schema.fromJsonString(spec.schema),
  );
  // The same read-boundary normalization the public `Content` read applies
  // (`spec.normalize`): a legacy bucket object missing a newly-added optional field
  // (home's `mission.photo`) must be backfilled BEFORE the draft decode too, or the
  // `/admin` editor opens the slot empty — and a plain save would then publish an
  // object that drops the seeded photo (the prune sees no key on the base). For
  // ABSENCE only, idempotent; a no-op for every scope without a `normalize` hook.
  const normalize = spec.normalize ?? ((parsed: unknown) => parsed);
  return {
    keys,
    default: spec.default,
    fromBucket: (json) =>
      parseJson(json).pipe(Effect.map(normalize), Effect.flatMap(decodeDraft)),
    decodeDraft,
    decodePublish,
    encodeObject: (value) =>
      encodeObject(value) as Effect.Effect<Json, Schema.SchemaError>,
    encodeDraftJson,
    encodePublishJson,
  };
};

/**
 * Resolve a scope to its codec bundle. One site case + N page/form cases, each
 * derived from `pages/registry`. The decoder/encoder value types differ per page,
 * so the bundle is type-erased (`unknown`) at this seam — each scope's methods are
 * internally consistent (the same schema decodes and encodes a scope's value) —
 * and the public methods restore the precise type via `ScopeContent<S>`.
 */
const resolveScope = (scope: ContentScope): ScopeCodec => {
  switch (scope.kind) {
    case 'site':
      return siteCodec;
    case 'page':
      // `objectCodec` is generic, so the precise per-page `ObjectSpec` (which
      // keeps `PageContent<P>` exact) builds the bundle directly: its decode /
      // encode close over the precise schema and widen to the bundle's `unknown`
      // surface on return — no spec erasure / cast needed at this seam.
      return objectCodec(PAGE_SPECS[scope.page], scopeKeys(scope));
    case 'form':
      return objectCodec(FORM_SPECS[scope.form], scopeKeys(scope));
  }
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class Service extends Context.Service<
  Service,
  {
    /**
     * Load the document the `/admin` editor edits for `scope`: the unpublished
     * draft when it is at least as new as the published document, else the
     * published document, else the bundled defaults. The reconciliation is by
     * bucket `lastModified`, not by mere draft *presence*, so a stale draft
     * written before the last publish still loses. A tie goes to the draft so a
     * list-op saved in the same second as the published object (common on
     * second-granular S3/MinIO) reopens with the edit. Never fails (a bad draft
     * is logged and ignored), so the editor always opens.
     */
    readonly load: <S extends ContentScope>(
      scope: S,
    ) => Effect.Effect<Loaded<S>>;
    /**
     * The whole encode→merge→decode→re-encode→store-draft pipeline as ONE call:
     * `override` (the route's parsed form override) is deep-merged onto the
     * encoded current document, decoded at the single boundary (rejecting with a
     * 400 `IssueError` carrying the dotted field issues), re-encoded to its
     * canonical JSON, and stored at the scope's draft key. Returns the encoded
     * document so the route can revalidate the view without a re-read.
     */
    readonly editDocument: <S extends ContentScope>(
      scope: S,
      override: Json,
    ) => Effect.Effect<ScopeEncoded<S>, IssueError>;
    /**
     * Point the `targetPath` `…key` field at a freshly-uploaded bucket object
     * `key` on the current draft and persist it, so the new image survives a
     * reload and a later publish. The raw-bytes upload + content-type gate stays
     * in the route; this rewrites the draft only.
     */
    readonly applyImageUpload: <S extends ContentScope>(
      scope: S,
      targetPath: string,
      key: AssetKey,
    ) => Effect.Effect<ScopeEncoded<S>, IssueError>;
    /**
     * Apply a sequence of id-keyed list ops (add / remove / reorder, ADR 0006)
     * to the current draft and persist it. The current document is encoded,
     * `applyListEdit` performs the structural edit by item id (NOT array index),
     * the result is decoded at the scope's DRAFT boundary, re-encoded, and stored
     * at the scope's draft key. The route owns FormData → `ListOp[]` parsing;
     * this owns the load → edit → decode → store pipeline, so the bucket-key
     * choreography never leaks back to the route.
     */
    readonly applyListOps: <S extends ContentScope>(
      scope: S,
      ops: readonly ListOp[],
    ) => Effect.Effect<ScopeEncoded<S>, IssueError>;
    /**
     * Promote the scope's pending edit to the published key, delete the draft
     * best-effort, and bust the public read cache so the change is live on the
     * next read with no redeploy. When a draft exists it is promoted *directly*
     * (it is the just-saved edit — never re-reconciled against the published
     * document, so a same-second `lastModified` cannot drop it); only when no
     * draft exists does publish re-publish the already-live document. A storage
     * failure on the published write rejects with a 502 `IssueError`; the
     * best-effort draft delete never fails the publish.
     */
    readonly publish: (scope: ContentScope) => Effect.Effect<void, IssueError>;
  }
>()('gycc/lib/content/draft-editor.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const content = yield* Content.Service;

    /**
     * Read + decode the document at `key` through the scope's `fromBucket` codec,
     * or `Option.none()` when it is absent / unreadable / malformed (logged,
     * never thrown — a bad draft must not break the editor open).
     */
    const readDocument = (
      codec: ScopeCodec,
      key: string,
    ): Effect.Effect<Option.Option<unknown>> =>
      Effect.gen(function* () {
        const object = yield* storage.get(key);
        const json = yield* Effect.promise(() =>
          new Response(object.stream).text(),
        );
        return Option.some(yield* codec.fromBucket(json));
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`DraftEditor: could not read ${key}`, cause).pipe(
            Effect.as(Option.none<unknown>()),
          ),
        ),
      );

    const loadInternal = (
      scope: ContentScope,
    ): Effect.Effect<{ content: unknown; source: LoadedSource }> =>
      Effect.gen(function* () {
        const codec = resolveScope(scope);
        const { draftKey, publishedKey } = codec.keys;
        const draft = yield* readDocument(codec, draftKey);
        const published = yield* readDocument(codec, publishedKey);

        if (Option.isSome(draft)) {
          if (Option.isNone(published)) {
            return { content: draft.value, source: 'draft' as const };
          }
          const draftHead = yield* storage
            .head(draftKey)
            .pipe(Effect.orElseSucceed(() => Option.none<ObjectHead>()));
          const publishedHead = yield* storage
            .head(publishedKey)
            .pipe(Effect.orElseSucceed(() => Option.none<ObjectHead>()));
          const draftIsAtLeastAsNew =
            Option.isSome(draftHead) &&
            Option.isSome(publishedHead) &&
            draftHead.value.lastModified.getTime() >=
              publishedHead.value.lastModified.getTime();
          if (draftIsAtLeastAsNew) {
            return { content: draft.value, source: 'draft' as const };
          }
          return { content: published.value, source: 'published' as const };
        }

        if (Option.isSome(published)) {
          return { content: published.value, source: 'published' as const };
        }
        return { content: codec.default, source: 'defaults' as const };
      });

    const load = Effect.fn('DraftEditor.load')(function* <
      S extends ContentScope,
    >(scope: S) {
      return (yield* loadInternal(scope)) as Loaded<S>;
    });

    /**
     * Decode a merged/edited candidate document at the scope's DRAFT boundary,
     * rejecting with a 400 `IssueError` carrying its dotted field issues. Shared
     * by `editDocument` (form merge), `applyImageUpload` (key rewrite), and
     * `applyListOps` (structural edit) — the single draft decode boundary.
     */
    const decodeOrReject = (
      codec: ScopeCodec,
      candidate: Json,
    ): Effect.Effect<unknown, IssueError> =>
      codec.decodeDraft(candidate).pipe(
        Effect.mapError(
          (error) =>
            new IssueError({
              message: 'Validation failed — fix the fields below and resubmit.',
              issues: issueMessages(error.issue),
              status: 400,
            }),
        ),
      );

    /**
     * Re-encode a decoded DRAFT document to its canonical JSON and store it at
     * `draftKey`, rejecting with a 502 `IssueError` on a storage failure.
     * Returns the encoded object so callers can hand it back to the view.
     */
    const storeDraft = (
      codec: ScopeCodec,
      decoded: unknown,
    ): Effect.Effect<Json, IssueError> =>
      Effect.gen(function* () {
        // A decoded value always re-encodes — a failure here is a bug, not a
        // user error, so it dies rather than masquerading as an `IssueError`.
        const json = yield* codec.encodeDraftJson(decoded).pipe(Effect.orDie);
        yield* storage.put(codec.keys.draftKey, json, 'application/json').pipe(
          Effect.mapError(
            (cause) =>
              new IssueError({
                message: `Saving the draft failed — is the bucket configured? ${String(cause)}`,
                issues: [],
                status: 502,
              }),
          ),
        );
        return yield* codec.encodeObject(decoded).pipe(Effect.orDie);
      });

    /** Encode the scope's current document to its canonical mergeable JSON. */
    const encodedCurrent = (
      codec: ScopeCodec,
      scope: ContentScope,
    ): Effect.Effect<Json> =>
      Effect.gen(function* () {
        const { content: current } = yield* loadInternal(scope);
        return yield* codec.encodeObject(current).pipe(Effect.orDie);
      });

    const editDocument = Effect.fn('DraftEditor.editDocument')(function* <
      S extends ContentScope,
    >(scope: S, override: Json) {
      const codec = resolveScope(scope);
      const base = yield* encodedCurrent(codec, scope);
      // Drop an alt-only image override (Team `groupPhoto` / `portrait` with no
      // uploaded key and no existing key on the draft) so a present-but-keyless
      // image object never lands — that object is draft-valid but PUBLISH-invalid
      // (`<slot>.key: Missing key`). A no-op for every scope without those slots.
      const pruned = pruneKeylessImageOverrides(base, override);
      const merged = normalizeMergedSiteContent(deepMerge(base, pruned));
      const decoded = yield* decodeOrReject(codec, merged);
      return (yield* storeDraft(codec, decoded)) as ScopeEncoded<S>;
    });

    const applyImageUpload = Effect.fn('DraftEditor.applyImageUpload')(
      function* <S extends ContentScope>(
        scope: S,
        targetPath: string,
        key: AssetKey,
      ) {
        const codec = resolveScope(scope);
        const encoded = yield* encodedCurrent(codec, scope);
        const next = setAtPath(encoded, targetPath, key);
        const decoded = yield* decodeOrReject(codec, next);
        return (yield* storeDraft(codec, decoded)) as ScopeEncoded<S>;
      },
    );

    const applyListOps = Effect.fn('DraftEditor.applyListOps')(function* <
      S extends ContentScope,
    >(scope: S, ops: readonly ListOp[]) {
      const codec = resolveScope(scope);
      const encoded = yield* encodedCurrent(codec, scope);
      // Structural edit by item id, NOT array index: an added item carries only
      // its `id` (draft-valid, publish-invalid per ADR 0006), a removed id drops,
      // a reorder permutes. The result decodes at the scope's draft boundary.
      const edited = applyListEdit(encoded, ops);
      const decoded = yield* decodeOrReject(codec, edited);
      return (yield* storeDraft(codec, decoded)) as ScopeEncoded<S>;
    });

    const publish = Effect.fn('DraftEditor.publish')(function* (
      scope: ContentScope,
    ) {
      const codec = resolveScope(scope);
      const { draftKey, publishedKey } = codec.keys;
      // Promote the just-saved edit. A pending draft is ALWAYS the publish
      // source — it is what the admin just edited and saved, so it is published
      // directly and never re-reconciled against the published document by
      // `lastModified`. This is the behaviour the old inline path had (it wrote
      // the freshly-merged document straight to the published key) and is the
      // reason `publish` must NOT route through `load`: `load`'s strict
      // `draftHead > publishedHead` reconciliation is for *editor-open* only, and
      // on a second-granular backend (S3/MinIO) a draft saved and published
      // within the same second compares EQUAL — routing publish through `load`
      // would silently re-publish the stale document and then delete the edit.
      // With no draft, the already-live document is re-published.
      const draft = yield* readDocument(codec, draftKey);
      const published = yield* readDocument(codec, publishedKey);
      const source = Option.isSome(draft)
        ? draft.value
        : Option.isSome(published)
          ? published.value
          : codec.default;
      // Enforce the STRICT publish invariant before the document goes live:
      // re-encode the draft to its JSON shape, then strict-decode it. For the
      // site scope a freshly-added (or half-filled) list item that is draft-valid
      // but publish-INVALID (an empty required `Text`) is rejected here with a
      // 400 `IssueError` carrying the offending field paths — section-skip is for
      // *absence* (an empty list), never a tolerance for half-filled content
      // (ADR 0006, CONTEXT §Section skip). Only after this gate passes does the
      // published object get written.
      const draftJson = yield* codec.encodeDraftJson(source).pipe(Effect.orDie);
      const strict = yield* parseJson(draftJson).pipe(
        Effect.map(normalizeMergedSiteContent),
        Effect.flatMap(codec.decodePublish),
        Effect.mapError(
          (error) =>
            new IssueError({
              message:
                'Cannot publish — finish the fields below (added or empty items must be complete) and resubmit.',
              issues: issueMessages(error.issue),
              status: 400,
            }),
        ),
      );
      const json = yield* codec.encodePublishJson(strict).pipe(Effect.orDie);
      yield* storage.put(publishedKey, json, 'application/json').pipe(
        Effect.mapError(
          (cause) =>
            new IssueError({
              message: `Publishing failed — is the bucket configured? ${String(cause)}`,
              issues: [],
              status: 502,
            }),
        ),
      );
      // Best-effort cleanup so the bucket stays tidy. Correctness does NOT
      // depend on it: the published document above already carries the promoted
      // draft, so a leftover draft (from a failed delete) only governs what the
      // *editor* reopens, where `load`'s strictly-newer reconciliation keeps it
      // from reopening as stale content. Hence it must not fail the publish —
      // the live document is already written.
      yield* storage.delete(draftKey).pipe(Effect.ignore);
      // Bust ONLY this scope's published read cache (ADR 0008): publishing a page
      // makes that page live on the next read without busting any other page,
      // form, or the conference (`site`) cache.
      yield* content.bust(bustTargetOf(scope));
    });

    return Service.of({
      load,
      editDocument,
      applyImageUpload,
      applyListOps,
      publish,
    });
  }),
);
