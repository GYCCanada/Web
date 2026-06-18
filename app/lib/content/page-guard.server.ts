import { Effect } from 'effect';

import { Content } from '../content.server';
import type { PageContent, PageId } from './pages/registry';
import { type NotFoundError, notFound } from '../effect/errors';

/**
 * Read an evergreen Page object and 404 it when the page is DISABLED (Feature C).
 *
 * A page's `enabled` flag is the single source of its public visibility: a disabled
 * page genuinely does not exist for the public, so its route GET — AND any action it
 * owns — must 404, not soft-redirect a stale bookmark to home (Codex #6; mirrors the
 * admin area's own 404-when-disabled). The flag is read off the SAME cached page
 * object the route renders, so the guard and the nav (`getEnabledPages`) never
 * diverge (`derive-dont-sync`). The runtime maps the yielded `NotFoundError` to a
 * `404` response for both loaders and actions.
 *
 * Returns the decoded `PageContent<P>` on success, so a loader does
 * `const page = yield* getEnabledPageOr404('give')` and projects it — one read, one
 * gate, no second `getPage` call.
 */
export const getEnabledPageOr404 = <P extends PageId>(
  page: P,
): Effect.Effect<PageContent<P>, NotFoundError, Content.Service> =>
  Effect.gen(function* () {
    const content = yield* Content.Service;
    const pageContent = yield* content.getPage(page);
    if (!pageContent.enabled) {
      return yield* notFound();
    }
    return pageContent;
  });
