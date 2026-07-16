import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Auth } from '~/lib/auth.server';
import {
  makeRequestRuntimeFromLayer,
  makeTestAppLayer,
} from '~/lib/effect/runtime';
import type { RouteArgs } from '~/lib/effect/router-context';
import { Forms } from '~/lib/forms/forms.server';
import { layerTest } from '~/lib/storage.test-helper';

import { action, loader } from './forms.$form';

const PASSWORD = 'correct-horse';
const SECRET = 'a-signing-secret-of-sufficient-length';
const adminConfig = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { ADMIN_PASSWORD: PASSWORD, COOKIE_SECRET: SECRET },
  }),
);

const makeHarness = async () => {
  const layer = Layer.provide(
    makeTestAppLayer(layerTest({})),
    adminConfig,
  );
  const authRuntime = ManagedRuntime.make(layer);
  const cookie = await authRuntime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      return auth.cookieHeader(yield* auth.verifyPassword(PASSWORD));
    }),
  );
  await authRuntime.dispose();

  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(layer);
  return { context, cookie };
};

const argsFor = (
  context: RouterContextProvider,
  cookie: string | undefined,
  body?: URLSearchParams,
): RouteArgs => {
  const url = 'http://localhost/admin/forms/contact';
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  if (body !== undefined) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return {
    request: new Request(url, { method: body === undefined ? 'GET' : 'POST', body, headers }),
    url: new URL(url),
    pattern: '/admin/forms/:form',
    params: { form: 'contact' },
    context,
  };
};

const publishBody = (
  version: string,
  definition: unknown,
): URLSearchParams =>
  new URLSearchParams({
    expectedCurrentVersion: version,
    definition: JSON.stringify(definition),
  });

describe('admin Form editor', () => {
  it('requires an authenticated admin session', async () => {
    const { context } = await makeHarness();

    await expect(loader(argsFor(context, undefined))).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
  });

  it('publishes a validated immutable definition through the route adapter', async () => {
    const { context, cookie } = await makeHarness();
    const loaded = await loader(argsFor(context, cookie));
    const edited = {
      ...(JSON.parse(loaded.definitionJson) as Record<string, unknown>),
      title: { en: 'Write to us', fr: 'Écrivez-nous' },
    };
    const actionArgs = argsFor(
      context,
      cookie,
      publishBody(loaded.version, edited),
    );

    const response = (await action(actionArgs)) as Response;
    const current = await context.runtime.run(
      actionArgs,
      Effect.gen(function* () {
        return yield* (yield* Forms.Service).current('contact');
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/admin/forms/contact?status=');
    expect(current.version).not.toBe(loaded.version);
    expect(current.definition.title.en).toBe('Write to us');
  });

  it('reports schema rejection and stale compare-and-set publication', async () => {
    const { context, cookie } = await makeHarness();
    const loaded = await loader(argsFor(context, cookie));
    const definition = JSON.parse(loaded.definitionJson) as Record<string, unknown>;

    const invalid = (await action(
      argsFor(context, cookie, publishBody(loaded.version, {})),
    )) as Response;
    const first = (await action(
      argsFor(
        context,
        cookie,
        publishBody(loaded.version, {
          ...definition,
          title: { en: 'First edit', fr: 'Premier changement' },
        }),
      ),
    )) as Response;
    const stale = (await action(
      argsFor(
        context,
        cookie,
        publishBody(loaded.version, {
          ...definition,
          title: { en: 'Stale edit', fr: 'Changement périmé' },
        }),
      ),
    )) as Response;

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      ok: false,
      error: 'The Form definition is not publishable.',
    });
    expect(first.status).toBe(302);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining('changed after you opened it'),
    });
  });
});
