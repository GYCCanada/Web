import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Auth } from '~/lib/auth.server';
import { makeAppLayer, makeRequestRuntimeFromLayer } from '~/lib/effect/runtime';
import type { RouteArgs } from '~/lib/effect/router-context';
import { layerTest } from '~/lib/storage.test-helper';

import { action } from './pages.$page';

/**
 * The per-page `/admin` editor action's image-upload GUARDS (A.5). The upload
 * branch reuses `content.tsx`'s validation verbatim: an empty file or a
 * non-image MIME is a 400 BEFORE any bytes are stored. These drive the REAL
 * route action (past the auth gate, with a freshly minted admin cookie) over an
 * in-memory `Storage`, and assert the 400 responses — proving the guards reject
 * at the route boundary, not merely that the helper predicates are correct.
 *
 * The admin secrets are injected through a scoped `ConfigProvider` layer
 * (`ConfigProvider.fromEnv`), NOT `process.env` (the project's Effect-config
 * discipline) — so this test never mutates global env and cannot leak the
 * enabled-admin state into other tests.
 */

const PASSWORD = 'correct-horse';
const SECRET = 'a-signing-secret-of-sufficient-length';

/** The admin-enabled config provider injected over the app layer. */
const adminConfig = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { ADMIN_PASSWORD: PASSWORD, COOKIE_SECRET: SECRET },
  }),
);

/** Build the app layer (in-memory storage) with the admin config provided. */
const makeLayer = () =>
  Layer.provide(makeAppLayer(layerTest({})), adminConfig);

/** Build a request runtime + router context over the admin-enabled app layer. */
const makeContext = () => {
  const layer = makeLayer();
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(layer);
  return { layer, context };
};

/** Mint a valid admin session cookie header by verifying the password. */
const mintCookie = async (
  layer: ReturnType<typeof makeLayer>,
): Promise<string> => {
  const runtime = ManagedRuntime.make(layer);
  const header = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(PASSWORD);
      return auth.cookieHeader(token);
    }),
  );
  await runtime.dispose();
  return header;
};

/** POST an `upload:groupPhoto.key` multipart request to the team page action. */
const postUpload = async (file: File): Promise<Response> => {
  const { layer, context } = makeContext();
  const cookie = await mintCookie(layer);

  const body = new FormData();
  body.set('intent', 'upload:groupPhoto.key');
  body.set('file', file);

  const url = 'http://localhost/admin/pages/team';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { cookie },
  });
  const args: RouteArgs = {
    request,
    url: new URL(url),
    pattern: '/admin/pages/:page',
    params: { page: 'team' },
    context,
  };
  return (await action(args)) as Response;
};

describe('team page editor action — image-upload guards (A.5)', () => {
  it('an empty file is a 400 (no bytes stored)', async () => {
    const empty = new File([], 'photo.jpg', { type: 'image/jpeg' });
    const res = await postUpload(empty);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Choose an image');
  });

  it('a non-image MIME (PDF) is a 400', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
      type: 'application/pdf',
    });
    const res = await postUpload(pdf);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Upload a JPEG');
  });
});
