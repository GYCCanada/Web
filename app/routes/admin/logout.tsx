import { Effect, Schema } from 'effect';
import { redirect } from 'react-router';

import { adminSecurityHeaders } from '~/lib/admin-headers';
import { AdminDisabled, Auth } from '~/lib/auth.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';

export const headers = adminSecurityHeaders;

/**
 * Sign out: clear the session cookie and bounce to the login page. POST-only
 * (the sign-out control is a form) so a stray link/prefetch can't log the user
 * out. When the admin is disabled (`ADMIN_PASSWORD` unset) this 404s like the
 * rest of the admin area, so logout never leaks that an admin exists — we don't
 * need a valid cookie to sign out, only that the admin is enabled, so a plain
 * `checkCookie` (whose `Unauthorized` we ignore) is the disabled-state probe.
 */
export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth;
  return yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.match({
      onSuccess: () =>
        redirect('/admin/login', {
          headers: { 'Set-Cookie': auth.clearCookieHeader() },
        }),
      onFailure: (error) =>
        Schema.is(AdminDisabled)(error)
          ? new Response('Not Found', { status: 404 })
          : redirect('/admin/login', {
              headers: { 'Set-Cookie': auth.clearCookieHeader() },
            }),
    }),
  );
});

/**
 * No GET sign-out (a stray link/prefetch must not log anyone out): bounce to
 * the dashboard. When the admin is disabled 404 like the rest of the area so
 * the route's existence is not leaked.
 */
export const loader = routeHandler(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth;
  return yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.match({
      onSuccess: () => redirect('/admin'),
      onFailure: (error) =>
        Schema.is(AdminDisabled)(error)
          ? new Response('Not Found', { status: 404 })
          : redirect('/admin'),
    }),
  );
});
