import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect';
import { RouterContextProvider } from 'react-router';

import { Schema } from 'effect';

import { Auth } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { getEnabledPageOr404 } from '~/lib/content/page-guard.server';
import { pageDraftKey } from '~/lib/content/pages/registry';
import { DraftTeamPage } from '~/lib/content/pages/schema';
import { makeAppLayer, makeRequestRuntimeFromLayer } from '~/lib/effect/runtime';
import type { RouteArgs } from '~/lib/effect/router-context';
import { NotFoundError } from '~/lib/effect/errors';
import { Storage } from '~/lib/storage.server';
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

/**
 * POST an `upload:groupPhoto.key` multipart request to the team page action,
 * returning the response AND the request `args` so a success test can inspect
 * the bytes the action actually stored — through the SAME `context.runtime`, so
 * the in-memory bucket is the one the action wrote to (a fresh `ManagedRuntime`
 * would build a fresh, empty store).
 */
const postUpload = async (
  file: File,
): Promise<{ res: Response; args: RouteArgs }> => {
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

describe('team page editor action — image-upload guards (A.5)', () => {
  it('an empty file is a 400 (no bytes stored)', async () => {
    const empty = new File([], 'photo.jpg', { type: 'image/jpeg' });
    const { res } = await postUpload(empty);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Choose an image');
  });

  it('a non-image MIME (PDF) is a 400', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
      type: 'application/pdf',
    });
    const { res } = await postUpload(pdf);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Upload a JPEG');
  });
});

/**
 * The per-page editor upload SUCCESS path through the REAL action (Feature B.2).
 * A wide JPEG must be resized + re-encoded to WebP at the shared `prepareImage`
 * boundary, so the action's redirect key ends `.webp` AND the byte the action
 * stored in the shared in-memory bucket carries an `image/webp` content-type —
 * proving the key + `storage.put` follow the RE-ENCODED type, not `file.type`.
 */
describe('team page editor action — image-upload resize-to-webp (B.2)', () => {
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

  it('a wide JPEG is stored as a .webp object with an image/webp content-type', async () => {
    const { res, args } = await postUpload(await wideJpeg());

    // Success is a redirect carrying the stored key in its status message.
    expect(res.status).toBe(302);
    const key = uploadedKeyFromRedirect(res);
    expect(key).toMatch(/^images\/uploads\/groupPhoto-key-\d+\.webp$/);

    // The action's put landed an image/webp object under that key — queried
    // through the SAME runtime the action used, so it is the same bucket.
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

/**
 * POST urlencoded fields to the team page editor action through the REAL action
 * (past the auth gate), returning the response + the request `args` so the test
 * can read the draft/published object back through the SAME in-memory bucket.
 */
const postTeamFields = async (
  fields: ReadonlyArray<readonly [string, string]>,
): Promise<{ res: Response; args: RouteArgs }> => {
  const { layer, context } = makeContext();
  const cookie = await mintCookie(layer);

  // URLSearchParams keeps duplicate keys in INSERTION order — exactly how the
  // browser submits the `Checkbox`'s hidden companion + checkbox pair.
  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  const url = 'http://localhost/admin/pages/team';
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  const args: RouteArgs = {
    request,
    url: new URL(url),
    pattern: '/admin/pages/:page',
    params: { page: 'team' },
    context,
  };
  const res = (await action(args)) as Response;
  return { res, args };
};

/**
 * The per-page editor's `enabled`-flag edit (Feature C, C.5). The `Checkbox`
 * posts a deterministic `enabled` value (hidden companion `false` + checkbox
 * `true`), `assembleOverrides` coerces it to a real boolean, and the value rides
 * the normal save/publish path. These drive the REAL action and read the result
 * back through the same in-memory bucket:
 *   - a CHECKED box (companion false + checkbox true) lands enabled:true;
 *   - an UNCHECKED box (companion false only) lands enabled:false;
 *   - publish enabled=false makes the published team page DISABLED, so the
 *     public route guard 404s (the page genuinely no longer exists).
 */
describe('team page editor action — enabled flag edit (C.5)', () => {
  /** Read + decode the stored team DRAFT through the action's own bucket. */
  const readTeamDraft = async (args: RouteArgs): Promise<DraftTeamPage> => {
    const draftJson = await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        const storage = yield* Storage.Service;
        const object = yield* storage.get(pageDraftKey('team'));
        return yield* Effect.promise(() => new Response(object.stream).text());
      }),
    );
    return Schema.decodeUnknownSync(DraftTeamPage)(JSON.parse(draftJson));
  };

  it('a CHECKED box (companion false + checkbox true) lands enabled:true on the draft', async () => {
    // The real Checkbox posts the hidden enabled=false FIRST, then the checkbox
    // enabled=true; last-wins gives true after the assembleOverrides coercion.
    const { res, args } = await postTeamFields([
      ['intent', 'save-draft'],
      ['enabled', 'false'],
      ['enabled', 'true'],
    ]);
    expect(res.status).toBe(302);
    const draft = await readTeamDraft(args);
    expect(draft.enabled).toBe(true);
  });

  it('an UNCHECKED box (companion false only) lands enabled:false on the draft', async () => {
    // "Uncheck + save" must be effective, not a no-op: the hidden companion makes
    // the override always carry a deterministic boolean.
    const { res, args } = await postTeamFields([
      ['intent', 'save-draft'],
      ['enabled', 'false'],
    ]);
    expect(res.status).toBe(302);
    const draft = await readTeamDraft(args);
    expect(draft.enabled).toBe(false);
  });

  it('publishing enabled=false disables the team page so the public route 404s', async () => {
    const { res, args } = await postTeamFields([
      ['intent', 'publish'],
      ['enabled', 'false'],
    ]);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('Published');

    // Read the now-published team page through the public guard: a disabled page
    // 404s (NotFoundError), and getPage reports enabled:false.
    const outcome = await args.context.runtime.run(
      args,
      Effect.gen(function* () {
        const content = yield* Content.Service;
        yield* content.bust({ kind: 'page', page: 'team' });
        const page = yield* content.getPage('team');
        const guardExit = yield* Effect.exit(getEnabledPageOr404('team'));
        return { enabled: page.enabled, guardExit };
      }),
    );
    expect(outcome.enabled).toBe(false);
    expect(outcome.guardExit._tag).toBe('Failure');
    if (outcome.guardExit._tag === 'Failure') {
      const failed = outcome.guardExit.cause.reasons.some(
        (reason) => reason._tag === 'Fail' && NotFoundError.is(reason.error),
      );
      expect(failed).toBe(true);
    }
  });
});
