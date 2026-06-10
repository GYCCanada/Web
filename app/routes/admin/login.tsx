import { Effect, Schema } from 'effect';
import { Form, redirect, useActionData } from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';
import { AdminDisabled, Auth, BadPassword } from '~/lib/auth.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * Show the login form. When the admin is disabled (`ADMIN_PASSWORD` unset) the
 * login page 404s like the rest of the admin area. When a valid session cookie
 * is already present, skip the form and go straight to the dashboard.
 */
export const loader = routeHandler(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  return yield* auth.checkCookie(request.headers.get('cookie')).pipe(
    Effect.match({
      onSuccess: () => redirect('/admin'),
      onFailure: (error) =>
        Schema.is(AdminDisabled)(error)
          ? new Response('Not Found', { status: 404 })
          : null,
    }),
  );
});

/**
 * Verify the submitted password. On success mint + set the session cookie and
 * redirect to the dashboard; on a wrong password re-render with a 401 error; on
 * a disabled admin 404 (the form should never have rendered).
 */
export const action = routeAction(function* () {
  const { request } = yield* ReactRouterContext;
  const auth = yield* Auth.Service;
  const form = yield* Effect.promise(() => request.formData());
  const password = String(form.get('password') ?? '');

  return yield* auth.verifyPassword(password).pipe(
    Effect.match({
      onSuccess: (token) =>
        redirect('/admin', {
          headers: { 'Set-Cookie': auth.cookieHeader(token) },
        }),
      onFailure: (error) =>
        Schema.is(AdminDisabled)(error)
          ? new Response('Not Found', { status: 404 })
          : Schema.is(BadPassword)(error)
            ? Response.json({ error: 'Wrong password' }, { status: 401 })
            : Response.json({ error: 'Login failed' }, { status: 500 }),
    }),
  );
});

export default function Login() {
  const data = useActionData<typeof action>() as
    | { error?: string }
    | undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 text-neutral-900 sm:p-6">
      <Form
        method="post"
        className="w-full max-w-sm space-y-5 rounded-lg bg-white p-5 shadow sm:p-6"
      >
        <h1 className="text-xl font-semibold">GYC Canada Admin</h1>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            className="block w-full rounded-md border border-neutral-300 px-3 py-3 text-base focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
          />
        </label>
        {data?.error ? (
          <p
            role="alert"
            className="text-sm text-red-600"
          >
            {data.error}
          </p>
        ) : null}
        <button
          type="submit"
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Sign in
        </button>
      </Form>
    </main>
  );
}
