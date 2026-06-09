import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Data, Effect, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import type { ServerBuild } from 'react-router';

import {
  buildAppRuntime,
  makeRequestRuntime,
  type RequestRuntime,
} from './app/lib/effect/runtime.ts';

declare module 'react-router' {
  interface RouterContextProvider {
    runtime: RequestRuntime;
  }
}

const isDev = Bun.env.NODE_ENV !== 'production';
const PORT = Number(Bun.env['PORT']) || 3000;
const BUILD_PATH = './build/server/index.js';
const CLIENT_PATH = './build/client';

const dev = isDev ? await import('./app/lib/dev/vite-middleware.ts') : null;
const vite = dev !== null ? await dev.createDevVite() : null;

const loadBuild = (): Promise<ServerBuild> =>
  vite !== null && dev !== null ?
    (vite.ssrLoadModule(dev.SERVER_BUILD_ID) as Promise<ServerBuild>)
  : (import(BUILD_PATH) as Promise<ServerBuild>);

class FileMissing extends Data.TaggedError('gycc/server/FileMissing')<{
  readonly path: string;
}> {}
class ViteUnhandled extends Data.TaggedError('gycc/server/ViteUnhandled')<{}> {}

const mimeFor = (pathname: string): string => {
  if (pathname.endsWith('.js')) return 'application/javascript';
  if (pathname.endsWith('.css')) return 'text/css';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  if (pathname.endsWith('.woff')) return 'font/woff';
  if (pathname.endsWith('.json')) return 'application/json';
  if (pathname.endsWith('.pdf')) return 'application/pdf';
  if (pathname.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (pathname.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
};

const fileResponse = Effect.fn('fileResponse')(function* (
  filePath: string,
  contentType: string,
  cacheControl: string,
) {
  const file = Bun.file(filePath);
  const exists = yield* Effect.promise(() => file.exists());
  if (!exists) return yield* new FileMissing({ path: filePath });
  const buf = yield* Effect.promise(() => file.arrayBuffer());
  return HttpServerResponse.uint8Array(new Uint8Array(buf), {
    contentType,
    headers: { 'cache-control': cacheControl },
  });
});

const reactRouterFallback = Effect.fn('reactRouterFallback')(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const build = yield* Effect.promise(() => loadBuild());
  const handler = createRequestHandler(build, isDev ? 'development' : 'production');
  const context = new RouterContextProvider();
  context.runtime = makeRequestRuntime();
  const webResponse = yield* Effect.promise(() => handler(webRequest, context));
  return HttpServerResponse.raw(webResponse.body, {
    status: webResponse.status,
    statusText: webResponse.statusText,
    headers: Object.fromEntries(webResponse.headers.entries()),
  });
});

const viteAssetResponse = Effect.fn('viteAsset')(function* () {
  if (vite === null || dev === null) return yield* new ViteUnhandled();
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const url = new URL(webRequest.url);
  if (url.pathname.startsWith('/.well-known/')) {
    return HttpServerResponse.empty({ status: 404 });
  }
  if (request.method !== 'GET' || !dev.looksLikeViteAsset(url.pathname)) {
    return yield* new ViteUnhandled();
  }
  const result = yield* Effect.promise(() => dev.runViteMiddleware(vite, webRequest));
  if (result === null) return yield* new ViteUnhandled();
  return HttpServerResponse.raw(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: Object.fromEntries(result.headers.entries()),
  });
});

const clientFilePath = (pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (
    !decoded.startsWith('/') ||
    decoded.includes('\0') ||
    decoded.split('/').includes('..') ||
    !/\.[A-Za-z0-9]+$/.test(decoded)
  ) {
    return null;
  }
  return `${CLIENT_PATH}${decoded}`;
};

const publicAssetFallback = Effect.fn('publicAssetFallback')(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const url = new URL(webRequest.url);
  const path = clientFilePath(url.pathname);
  if (request.method !== 'GET' || path === null) {
    return yield* new FileMissing({ path: url.pathname });
  }
  return yield* fileResponse(path, mimeFor(url.pathname), 'public, max-age=3600');
});

const stripQuery = (url: string): string => {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
};

const HashedAssetsRoute = HttpRouter.add('GET', '/assets/*', (request) => {
  const path = stripQuery(request.url);
  return fileResponse(
    `${CLIENT_PATH}${path}`,
    mimeFor(path),
    'public, max-age=31536000, immutable',
  ).pipe(
    Effect.catchTag('gycc/server/FileMissing', () =>
      Effect.succeed(HttpServerResponse.empty({ status: 404 })),
    ),
  );
});

const FallbackRoute = HttpRouter.add('*', '*', () =>
  isDev ?
    viteAssetResponse().pipe(
      Effect.catchTag('gycc/server/ViteUnhandled', () => reactRouterFallback()),
    )
  : publicAssetFallback().pipe(
      Effect.catchTag('gycc/server/FileMissing', () => reactRouterFallback()),
    ),
);

const ProdRoutes = Layer.mergeAll(HashedAssetsRoute, FallbackRoute);
const DevRoutes = FallbackRoute;

const RoutesLive = isDev ? DevRoutes : ProdRoutes;

const ServerLive = HttpRouter.serve(RoutesLive).pipe(
  Layer.provide(BunHttpServer.layer({ port: PORT })),
);

// Fail fast at boot: build the app layer graph now so `NODE_ENV=production`
// validates the required mail / mailchimp secrets immediately, instead of only
// on the first Effect-wrapped form action (ADR 0004:38-40, plan P2). In dev /
// test the env vars are optional, so this is a cheap no-op there.
await buildAppRuntime().catch((error: unknown) => {
  Bun.stderr.write(`[gycc] fatal: environment validation failed at startup\n${String(error)}\n`);
  process.exit(1);
});

BunRuntime.runMain(Layer.launch(ServerLive));
