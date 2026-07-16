import { Effect } from 'effect';
import { redirect } from 'react-router';

import { Auth } from './auth.server';
import { ReactRouterContext } from './effect/router-context';

/**
 * Authenticate the current admin request and own its HTTP policy in one seam.
 * Protected child loaders/actions still invoke this independently because React
 * Router may execute them alongside the layout loader; they share this mapping
 * instead of duplicating it.
 */
export const requireAdminRequest = Effect.fn(
  'AdminAuth.requireRequest',
)(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );
});
