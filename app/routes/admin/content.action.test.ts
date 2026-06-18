import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Auth } from '~/lib/auth.server';
import { SITE_CONTENT_KEY } from '~/lib/content.server';
import { defaultContent } from '~/lib/content/defaults';
import { SiteContent } from '~/lib/content/schema';
import { makeAppLayer, makeRequestRuntimeFromLayer } from '~/lib/effect/runtime';
import type { RouteArgs } from '~/lib/effect/router-context';
import { Storage } from '~/lib/storage.server';
import { layerTest } from '~/lib/storage.test-helper';

import { action } from './content';

/**
 * The SITE editor action's image-upload resize path through the REAL action
 * (Feature B.2). B wires `prepareImage` into BOTH editors; the per-page editor
 * is pinned in `pages.$page.action.test.ts`. This pins the OTHER editor — the
 * site editor (`/admin/content`) — so a regression that re-encodes only on the
 * per-page path, or that keys the site upload off `file.type` instead of the
 * re-encoded `prepared.contentType`, is caught here. A wide JPEG uploaded to a
 * team member's `photo.key` must land as a `.webp` object with an `image/webp`
 * content-type in the SAME in-memory bucket the action wrote to.
 *
 * Harness mirrors the per-page action test: admin secrets ride a scoped
 * `ConfigProvider` (never `process.env`), and the success assertion queries the
 * store through the request's own `context.runtime` so it is the same bucket.
 */

const PASSWORD = 'correct-horse';
const SECRET = 'a-signing-secret-of-sufficient-length';

const adminConfig = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { ADMIN_PASSWORD: PASSWORD, COOKIE_SECRET: SECRET },
  }),
);

/** `content/site.json` seed bytes — the published doc the upload drafts from. */
const seedSite = (): Promise<string> =>
  Effect.runPromise(
    Schema.encodeUnknownEffect(Schema.fromJsonString(SiteContent))(defaultContent),
  );

/** Build the app layer (in-memory storage seeded with `site.json`) + admin config. */
const makeLayer = (seed: string) =>
  Layer.provide(
    makeAppLayer(layerTest({ [SITE_CONTENT_KEY]: { body: seed } })),
    adminConfig,
  );

const makeContext = (seed: string) => {
  const layer = makeLayer(seed);
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntimeFromLayer(layer);
  return { layer, context };
};

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

/**
 * POST an `upload:team.<id>.photo.key` multipart request to the site editor
 * action, returning the response AND the request `args` so the success test can
 * read back the stored bytes through the SAME `context.runtime`.
 */
const postUpload = async (
  target: string,
  file: File,
): Promise<{ res: Response; args: RouteArgs }> => {
  const seed = await seedSite();
  const { layer, context } = makeContext(seed);
  const cookie = await mintCookie(layer);

  const body = new FormData();
  body.set('intent', `upload:${target}`);
  body.set('file', file);

  const url = 'http://localhost/admin/content';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { cookie },
  });
  const args: RouteArgs = {
    request,
    url: new URL(url),
    pattern: '/admin/content',
    params: {},
    context,
  };
  const res = (await action(args)) as Response;
  return { res, args };
};

/** The `key` echoed in the action's success redirect `?status=Image uploaded: <key>`. */
const uploadedKeyFromRedirect = (res: Response): string => {
  const location = res.headers.get('location') ?? '';
  const status = new URL(location, 'http://localhost').searchParams.get('status') ?? '';
  const match = status.match(/Image uploaded: (.+)$/);
  if (match === null) throw new Error(`no uploaded key in redirect: ${location}`);
  return match[1]!;
};

describe('site editor action — image-upload resize-to-webp (B.2)', () => {
  // A 1×1 PNG seed grown to a wide JPEG via Bun.Image — a real >MAX_WIDTH image.
  const wideJpeg = async (): Promise<File> => {
    const seed = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const bytes = new Uint8Array(
      await new Bun.Image(seed).resize(2400, 800).jpeg({ quality: 90 }).toBuffer(),
    );
    return new File([bytes], 'wide.jpg', { type: 'image/jpeg' });
  };

  it('a wide JPEG uploaded to a team photo is stored as a .webp / image/webp object', async () => {
    // Address a real team member by its id (ADR 0006), exactly as the editor's
    // `upload:team.<id>.photo.key` intent does.
    const memberId = String(defaultContent.team[0]?.id);
    const target = `team.${memberId}.photo.key`;

    const { res, args } = await postUpload(target, await wideJpeg());

    expect(res.status).toBe(302);
    const key = uploadedKeyFromRedirect(res);
    expect(key).toMatch(/\.webp$/);

    // The action's put landed an image/webp object — read through the SAME
    // runtime the action used, so it is the same in-memory bucket.
    const head = await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        const storage = yield* Storage.Service;
        return yield* storage.head(key);
      }),
    );

    expect(head._tag).toBe('Some');
    if (head._tag === 'Some') {
      expect(head.value.contentType).toBe('image/webp');
    }
  });
});
