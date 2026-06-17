export * as DraftEditor from './draft-editor.server';

import { Context, Effect, Layer, Option, Schema, SchemaIssue } from 'effect';

import {
  Content,
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
  type AdminContent,
} from '../content.server';
import { deepMerge, setAtPath, type Json } from './admin-form';
import { defaultContent } from './defaults';
import { backfillListItemIds } from './id-backfill';
import { SiteContent, type AssetKey } from './schema';
import type { SiteContent as SiteContentType } from './schema';
import { Storage } from '../storage.server';
import type { ObjectHead } from '../storage.server';

/** The document encoded to its on-bucket object shape, returned to the view. */
export type EncodedDoc = typeof SiteContent.Encoded;

/**
 * `DraftEditor` is the deep module the `/admin` editor write path talks to
 * (registration-launch plan, Branch 1). It absorbs the encode→merge→decode→
 * re-encode→store-draft pipeline that used to be inlined and *duplicated*
 * across the upload and save/publish branches of the route action — the route
 * shrinks to "auth → parse intent → call `DraftEditor` → map result to
 * `Response`".
 *
 * Principles (see `~/.brain/principles`):
 *   - `small-interface-deep-implementation`: `load`, `editDocument`,
 *     `applyImageUpload`, `publish` hide the whole draft/published key-pair
 *     choreography, the double draft-read, and the merge/decode/re-encode dance.
 *   - `make-impossible-states-unrepresentable`: every operation is addressed by
 *     a `ContentScope`, a *closed* union that routes through `scopeKeys` to a
 *     real `{ draftKey, publishedKey }` pair. An editor cannot target a key that
 *     is not a known scope — the bucket-key constants stop leaking to the route.
 *   - `boundary-discipline`: decode happens here, once, before a draft is
 *     stored; a rejected edit fails with an `IssueError` carrying the dotted
 *     field issues the editor surfaces.
 *
 * `ContentScope` is a single-inhabitant union *today* (`{ kind: 'site' }`). The
 * scope dimension is real — it carries the draft/published key PAIR plus the
 * reconciliation — so Branch 5 *widens the union* (page/form scopes) rather than
 * retrofitting a parameter: `scopeKeys` already has one case now and N cases
 * later, and `load`/`editDocument`/`publish` all route through it.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * What a `DraftEditor` operation targets. A closed, single-inhabitant union
 * today; Branch 5 widens it (`| { kind: 'page'; … } | { kind: 'form'; … }`).
 */
export type ContentScope = { readonly kind: 'site' };

/** The one site scope, named so callers never construct the literal inline. */
export const siteScope: ContentScope = { kind: 'site' };

/** The draft/published bucket-key PAIR a scope addresses. */
export interface ScopeKeys {
  readonly draftKey: string;
  readonly publishedKey: string;
}

/**
 * Resolve a `ContentScope` to its draft/published key pair. One case now, N
 * cases when the union widens — the function the whole module routes through so
 * an editor can only ever target a known scope's keys.
 */
export const scopeKeys = (scope: ContentScope): ScopeKeys => {
  switch (scope.kind) {
    case 'site':
      return {
        draftKey: SITE_CONTENT_DRAFT_KEY,
        publishedKey: SITE_CONTENT_KEY,
      };
  }
};

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
// Codecs (the document's on-bucket JSON ↔ decoded value)
// ---------------------------------------------------------------------------

// `decodeDocumentJson` reads a document FROM the bucket: parse → id-backfill →
// decode, so a draft/published document published before list-item ids existed
// (ADR 0006) still decodes (every id-less item gets a fresh `nanoid` before the
// required `id` field is checked). `encodeDocument` yields the encoded OBJECT
// (handed back to the view); `encodeDocumentJson` yields the JSON STRING stored
// in the bucket (Effect Schema's JSON codec, not `JSON.stringify`, per the
// project lint rule); `decodeDocument` decodes an already-id-complete merged
// object (built from the loaded current document) at the single edit boundary —
// no backfill, so a genuinely missing id is rejected rather than masked.
const parseJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown),
);
const decodeDocument = Schema.decodeUnknownEffect(SiteContent);
const decodeDocumentJson = (json: string) =>
  parseJson(json).pipe(
    Effect.map(backfillListItemIds),
    Effect.flatMap(decodeDocument),
  );
const encodeDocument = Schema.encodeUnknownEffect(SiteContent);
const encodeDocumentJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(SiteContent),
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class Service extends Context.Service<
  Service,
  {
    /**
     * Load the document the `/admin` editor edits for `scope`: the unpublished
     * draft when it is strictly newer than the published document, else the
     * published document, else the bundled defaults. The reconciliation is by
     * bucket `lastModified`, not by mere draft *presence*, so a stale or
     * failed-delete draft can never reopen as the edit source. Never fails (a
     * bad draft is logged and ignored), so the editor always opens.
     */
    readonly load: (scope: ContentScope) => Effect.Effect<AdminContent>;
    /**
     * The whole encode→merge→decode→re-encode→store-draft pipeline as ONE call:
     * `override` (the route's parsed form override) is deep-merged onto the
     * encoded current document, decoded at the single boundary (rejecting with a
     * 400 `IssueError` carrying the dotted field issues), re-encoded to its
     * canonical JSON, and stored at the scope's draft key. Returns the encoded
     * document so the route can revalidate the view without a re-read.
     */
    readonly editDocument: (
      scope: ContentScope,
      override: Json,
    ) => Effect.Effect<EncodedDoc, IssueError>;
    /**
     * Point the `targetPath` `…key` field at a freshly-uploaded bucket object
     * `key` on the current draft and persist it, so the new image survives a
     * reload and a later publish. The raw-bytes upload + content-type gate stays
     * in the route; this rewrites the draft only.
     */
    readonly applyImageUpload: (
      scope: ContentScope,
      targetPath: string,
      key: AssetKey,
    ) => Effect.Effect<EncodedDoc, IssueError>;
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
     * Read + decode the document at `key`, or `Option.none()` when it is absent
     * / unreadable / malformed (logged, never thrown — a bad draft must not
     * break the editor open).
     */
    const readDocument = Effect.fnUntraced(
      function* (key: string) {
        const object = yield* storage.get(key);
        const json = yield* Effect.promise(() =>
          new Response(object.stream).text(),
        );
        return Option.some(yield* decodeDocumentJson(json));
      },
      (effect, key) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `DraftEditor: could not read ${key}`,
              cause,
            ).pipe(Effect.as(Option.none<SiteContentType>())),
          ),
        ),
    );

    const load = Effect.fn('DraftEditor.load')(function* (
      scope: ContentScope,
    ) {
      const { draftKey, publishedKey } = scopeKeys(scope);
      const draft = yield* readDocument(draftKey);
      const published = yield* readDocument(publishedKey);

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
        const draftIsNewer =
          Option.isSome(draftHead) &&
          Option.isSome(publishedHead) &&
          draftHead.value.lastModified.getTime() >
            publishedHead.value.lastModified.getTime();
        if (draftIsNewer) {
          return { content: draft.value, source: 'draft' as const };
        }
        return { content: published.value, source: 'published' as const };
      }

      if (Option.isSome(published)) {
        return { content: published.value, source: 'published' as const };
      }
      return { content: defaultContent, source: 'defaults' as const };
    });

    /**
     * Decode a merged candidate document, rejecting with a 400 `IssueError`
     * carrying its dotted field issues. Shared by `editDocument` (form merge)
     * and `applyImageUpload` (key rewrite) — the single decode boundary.
     */
    const decodeOrReject = (
      candidate: Json,
    ): Effect.Effect<SiteContentType, IssueError> =>
      decodeDocument(candidate).pipe(
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
     * Re-encode a decoded document to its canonical JSON and store it at
     * `draftKey`, rejecting with a 502 `IssueError` on a storage failure.
     * Returns the encoded object so callers can hand it back to the view.
     */
    const storeDraft = (
      draftKey: string,
      decoded: SiteContentType,
    ): Effect.Effect<EncodedDoc, IssueError> =>
      Effect.gen(function* () {
        // A decoded `SiteContent` always re-encodes — a failure here is a bug,
        // not a user error, so it dies rather than masquerading as an
        // `IssueError`.
        const json = yield* encodeDocumentJson(decoded).pipe(Effect.orDie);
        yield* storage.put(draftKey, json, 'application/json').pipe(
          Effect.mapError(
            (cause) =>
              new IssueError({
                message: `Saving the draft failed — is the bucket configured? ${String(cause)}`,
                issues: [],
                status: 502,
              }),
          ),
        );
        return (yield* encodeDocument(decoded).pipe(Effect.orDie)) as EncodedDoc;
      });

    const editDocument = Effect.fn('DraftEditor.editDocument')(function* (
      scope: ContentScope,
      override: Json,
    ) {
      const { draftKey } = scopeKeys(scope);
      const { content: current } = yield* load(scope);
      const base = (yield* encodeDocument(current).pipe(Effect.orDie)) as Json;
      const merged = deepMerge(base, override);
      const decoded = yield* decodeOrReject(merged);
      return yield* storeDraft(draftKey, decoded);
    });

    const applyImageUpload = Effect.fn('DraftEditor.applyImageUpload')(
      function* (scope: ContentScope, targetPath: string, key: AssetKey) {
        const { draftKey } = scopeKeys(scope);
        const { content: current } = yield* load(scope);
        const encoded = (yield* encodeDocument(current).pipe(
          Effect.orDie,
        )) as Json;
        const next = setAtPath(encoded, targetPath, key);
        const decoded = yield* decodeOrReject(next);
        return yield* storeDraft(draftKey, decoded);
      },
    );

    const publish = Effect.fn('DraftEditor.publish')(function* (
      scope: ContentScope,
    ) {
      const { draftKey, publishedKey } = scopeKeys(scope);
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
      const draft = yield* readDocument(draftKey);
      const published = yield* readDocument(publishedKey);
      const source = Option.isSome(draft)
        ? draft.value
        : Option.isSome(published)
          ? published.value
          : defaultContent;
      const json = yield* encodeDocumentJson(source).pipe(Effect.orDie);
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
      yield* content.bust();
    });

    return Service.of({ load, editDocument, applyImageUpload, publish });
  }),
);
