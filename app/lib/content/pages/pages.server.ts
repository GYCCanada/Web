import { Effect } from 'effect';

import { Content } from '../../content.server';
import { type NotFoundError, notFound } from '../../effect/errors';
import type { Locale } from '../../localization/localization';
import { projectPage, type PageViewById } from './project';
import type { PageId } from './registry';

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
