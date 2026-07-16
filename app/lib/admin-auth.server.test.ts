import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import {
  makeRequestRuntimeFromLayer,
  makeTestAppLayer,
  type RequestRuntime,
} from './effect/runtime';
import type { RouteArgs } from './effect/router-context';
import { Auth } from './auth.server';
import { requireAdminRequest } from './admin-auth.server';
import { layerTest } from './storage.test-helper';

const PASSWORD = 'correct-horse';
const SECRET = 'a-signing-secret-of-sufficient-length';
const runtimes: RequestRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

const makeLayer = (env: Record<string, string>) =>
  Layer.provide(
    makeTestAppLayer(layerTest({})),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
  );

const makeArgs = (
  layer: ReturnType<typeof makeLayer>,
  cookie?: string,
): RouteArgs => {
  const url = 'http://localhost/admin';
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(layer);
  runtimes.push(context.runtime);
  return {
    request: new Request(url, {
      headers: cookie === undefined ? undefined : { cookie },
    }),
    url: new URL(url),
    pattern: '/admin',
    params: {},
    context,
  };
};

const runGuard = (args: RouteArgs) =>
  args.context.runtime.run(args, requireAdminRequest());

describe('requireAdminRequest', () => {
  it('accepts a valid admin cookie', async () => {
    const layer = makeLayer({
      ADMIN_PASSWORD: PASSWORD,
      COOKIE_SECRET: SECRET,
    });
    const runtime = ManagedRuntime.make(layer);
    const cookie = await runtime.runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        return auth.cookieHeader(yield* auth.verifyPassword(PASSWORD));
      }),
    );
    await runtime.dispose();

    await expect(runGuard(makeArgs(layer, cookie))).resolves.toBeUndefined();
  });

  it('redirects an unauthorized request to login', async () => {
    const layer = makeLayer({
      ADMIN_PASSWORD: PASSWORD,
      COOKIE_SECRET: SECRET,
    });

    const response = await runGuard(makeArgs(layer)).catch((error) => error);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get('location')).toBe('/admin/login');
  });

  it('returns 404 when admin is disabled', async () => {
    const layer = makeLayer({});

    const response = await runGuard(makeArgs(layer)).catch((error) => error);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
  });
});
