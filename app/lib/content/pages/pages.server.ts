import { Effect, Schema } from 'effect';

import { Content } from '../../content.server';
import { handleAdminEditRequest } from '../admin-edit-request.server';
import {
  assembleOverrides,
  normalizeFaqAnswers,
  type Json,
} from '../admin-form';
import {
  DraftEditor,
  type IssueError,
  pageScope,
  type LoadedSource,
} from '../draft-editor.server';
import { type NotFoundError, notFound } from '../../effect/errors';
import type { Locale } from '../../localization/localization';
import { projectPage, type PageViewById } from './project';
import { PAGE_SPECS, type PageId } from './registry';

/**
 * Read one public Page through its complete boundary: published-object fallback,
 * enabled gating, and projection from bilingual content to one Locale. Routes do
 * not select matching schemas/projectors or risk rendering a disabled Page.
 */
export const readPageView = <P extends PageId>(
  page: P,
  locale: Locale,
): Effect.Effect<PageViewById[P], NotFoundError, Content.Service> =>
  Effect.gen(function* () {
    const content = yield* Content.Service;
    const document = yield* content.getPage(page);
    if (!document.enabled) {
      return yield* notFound();
    }
    return projectPage(page, document, locale);
  });

export interface PageAuthoringDocument<P extends PageId> {
  readonly page: P;
  readonly encoded: Json;
  readonly source: LoadedSource;
}

/** Open one Page at its lax draft boundary for the admin authoring adapter. */
export const openPageAuthoring = <P extends PageId>(
  page: P,
): Effect.Effect<PageAuthoringDocument<P>, IssueError, DraftEditor.Service> =>
  Effect.gen(function* () {
    const editor = yield* DraftEditor.Service;
    const { content, source } = yield* editor.load(pageScope(page));
    const encoded = yield* Schema.encodeUnknownEffect(
      PAGE_SPECS[page].draftSchema,
    )(content).pipe(Effect.orDie);
    return { page, encoded: encoded as Json, source };
  });

/** Apply the Page-specific form projection through the shared admin edit protocol. */
export const applyPageAuthoring = (page: PageId, form: FormData) =>
  handleAdminEditRequest({
    scope: pageScope(page),
    form,
    redirectTo: `/admin/pages/${page}`,
    buildOverride: (submitted) =>
      normalizeFaqAnswers(assembleOverrides(submitted.entries())),
  });
