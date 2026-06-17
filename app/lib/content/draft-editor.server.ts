export * as DraftEditor from './draft-editor.server';

import { Context, Effect, Layer, Option, Schema } from 'effect';

import {
  SITE_CONTENT_DRAFT_KEY,
  SITE_CONTENT_KEY,
  type AdminContent,
} from '../content.server';
import { defaultContent } from './defaults';
import { SiteContent } from './schema';
import type { SiteContent as SiteContentType } from './schema';
import { Storage } from '../storage.server';
import type { ObjectHead } from '../storage.server';

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
// Codecs (the document's on-bucket JSON ↔ decoded value)
// ---------------------------------------------------------------------------

const decodeDocumentJson = Schema.decodeUnknownEffect(
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
  }
>()('gycc/lib/content/draft-editor.server/Service') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service;

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

    return Service.of({ load });
  }),
);

/**
 * The admin write path's `DraftEditor`, with its `Storage` dependency
 * pre-provided as the never-fails-to-build `Storage.layerOptional` (mirroring
 * `Content.defaultLayer`). Only `Env` stays open, discharged by the surrounding
 * app-runtime merge.
 */
export const defaultLayer = layer.pipe(Layer.provide(Storage.layerOptional));
