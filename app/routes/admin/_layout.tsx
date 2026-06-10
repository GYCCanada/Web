import { Effect } from 'effect';
import { Form, Link, Outlet, redirect } from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';
import { Auth } from '~/lib/auth.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The `/admin` guard. Every authenticated admin page nests beneath this
 * layout, so a single cookie check gates the whole area:
 *   - admin disabled (`ADMIN_PASSWORD` unset) → 404 the whole area, so a
 *     prod-without-admin and dev both look like the admin does not exist;
 *   - admin enabled but no valid cookie → redirect to `/admin/login`.
 *
 * The error → Response mapping happens here (not centrally in the runtime) so
 * the runtime stays a thin error sink and the admin's redirect-vs-404 policy
 * lives with the admin routes. The runtime re-throws any `Response` we fail
 * with, so failing the effect with `redirect(...)` / a 404 `Response` is how a
 * loader short-circuits.
 */
export const loader = routeHandler(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.catchTags({
      'Auth.Disabled': () =>
        Effect.fail(new Response('Not Found', { status: 404 })),
      'Auth.Unauthorized': () => Effect.fail(redirect('/admin/login')),
    }),
  );
  return null;
});

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link
            to="/admin"
            className="text-lg font-semibold"
          >
            GYC Canada Admin
          </Link>
          <Form
            method="post"
            action="/admin/logout"
          >
            <button
              type="submit"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-neutral-300 px-4 text-sm font-medium transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Sign out
            </button>
          </Form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
