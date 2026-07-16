import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Data, Effect, Layer, Option } from 'effect';
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import type { ServerBuild } from 'react-router';

import { Env } from './app/lib/env.server.ts';
import {
  makeRequestRuntime,
  type RequestRuntime,
} from './app/lib/effect/runtime.ts';
import { imageKeyFromPath } from './app/lib/images.server.ts';
import { Storage } from './app/lib/storage.server.ts';
import { Submissions } from './app/lib/forms/submissions.server.ts';
import { Payment } from './app/lib/payment.server.ts';
import { Order } from './app/lib/order/runner.server.ts';
import { OrderSweep } from './app/lib/order/sweep.server.ts';

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

// Stream a managed image from the bucket with a short public cache (mirrors
// paulo-suzanne's `bucketResponse`). On a bucket miss (`NotFound`) the caller
// falls back to the bundled `public/<key>` file; a real `StorageError` (bucket
// unreachable) likewise falls back so a flaky bucket never blanks the site.
const bucketImageResponse = Effect.fn('bucketImageResponse')(function* (
  key: string,
) {
  const storage = yield* Storage.Service;
  const obj = yield* storage.get(key);
  return HttpServerResponse.raw(obj.stream, {
    status: 200,
    headers: {
      'content-type': obj.contentType,
      'content-length': String(obj.size),
      'cache-control': 'public, max-age=300',
    },
  });
});

const imageResponse = Effect.fn('imageResponse')(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const url = new URL(webRequest.url);
  const key = imageKeyFromPath(url.pathname);
  if (key === null) return HttpServerResponse.empty({ status: 404 });

  // Bucket first, then the bundled `public/<key>` file. A managed image
  // uploaded to the bucket overrides today's `public/` art at the same key,
  // while a bucket-less dev/prod still serves the defaults (D3).
  const publicPath = `${isDev ? 'public' : CLIENT_PATH}/${key}`;
  return yield* bucketImageResponse(key).pipe(
    Effect.catchTag('Storage.NotFound', () =>
      fileResponse(publicPath, mimeFor(key), 'public, max-age=300').pipe(
        Effect.catchTag('gycc/server/FileMissing', () =>
          Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        ),
      ),
    ),
    Effect.catchTag('Storage.Error', (e) =>
      Effect.logWarning('image bucket read failed, falling back to public', e).pipe(
        Effect.flatMap(() =>
          fileResponse(publicPath, mimeFor(key), 'public, max-age=300').pipe(
            Effect.catchTag('gycc/server/FileMissing', () =>
              Effect.succeed(HttpServerResponse.empty({ status: 404 })),
            ),
          ),
        ),
      ),
    ),
  );
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

// Readiness probe for Railway. Plain text, no app services — answering 200 here
// means the process is up and the env layer (below) validated at boot.
const HealthRoute = HttpRouter.add(
  'GET',
  '/healthz',
  HttpServerResponse.text('ok', { contentType: 'text/plain; charset=utf-8' }),
);

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

// Managed images (conference heroes, speaker / team photos) live in the bucket
// under their object key and are served here (CMS plan §"Image serving", C5).
// `Content` resolves every `ImageRef.key` to `/images/<key>`, so this one route
// backs every managed `<img src>` on the public site.
const ImagesRoute = HttpRouter.add('GET', '/images/*', () => imageResponse());

const FallbackRoute = HttpRouter.add('*', '*', () =>
  isDev ?
    viteAssetResponse().pipe(
      Effect.catchTag('gycc/server/ViteUnhandled', () => reactRouterFallback()),
    )
  : publicAssetFallback().pipe(
      Effect.catchTag('gycc/server/FileMissing', () => reactRouterFallback()),
    ),
);

const ProdRoutes = Layer.mergeAll(
  HealthRoute,
  HashedAssetsRoute,
  ImagesRoute,
  FallbackRoute,
);
const DevRoutes = Layer.mergeAll(HealthRoute, ImagesRoute, FallbackRoute);

const RoutesLive = isDev ? DevRoutes : ProdRoutes;

// Fail fast at boot: forcing `Env` here makes its layer validate the required
// mail secrets (in `NODE_ENV=production`) when the server layer is
// built, instead of lazily on the first Effect-wrapped form action
// (ADR 0004:38-40). Providing `Env.layer` discharges the requirement, so a
// missing secret fails `Layer.launch` and `BunRuntime.runMain` exits non-zero.
// In dev / test the env vars are optional, so this is a cheap no-op.
const StartupCheck = Layer.effectDiscard(Env.Service).pipe(
  Layer.provide(Env.layer),
);

// The `/images/*` route reads through `Storage`. `Storage.defaultLayer` never
// fails to build (bucket-less it serves `NotFound`, which the route recovers by
// falling back to the bundled `public/<key>` file), so providing it here keeps
// the server booting identically with or without a bucket (D3). It is
// `Storage.layerOptional` with its `Env` dependency pre-provided, so the
// storage layer is self-contained.
const StorageLive = Storage.defaultLayer;

// The durable Order workflow's CONSUMER side: the in-process Sharding runner +
// the `arm`/`settle`/… handlers, hosted in this long-lived `Layer.launch`-ed
// `ServerLive` graph (G6, order-workflow-plan §1) — NOT the request-handler
// `makeAppLayer` graph, which is consumed once into the `AppRuntime` singleton
// and never `Layer.launch`-ed, so it has no process-lifetime supervisor for the
// runner's mailbox-poll fiber. The runner consumes the SQL mailbox the
// registration action + Stripe webhook (SENDERS in `AppRuntime`) write to; the
// two graphs coordinate ONLY through the shared `DATABASE_URL` sqlite FILE.
//
// Gated on `Env.database` Some: a DB-less deploy composes `Layer.empty`, so the
// bucket-only registration/webhook path is byte-identically unaffected and
// `Layer.launch` still exits non-zero on a missing REQUIRED config (the
// `StartupCheck` contract). The runner's bucket-authority writes come from
// `Submissions.defaultLayer` (self-contained); `Env.layer` discharges the
// `MessageStorageLive` SqlClient gate and the `Env`-read in the gate itself.
const OrderRunnerLive = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* Env.Service;
    if (Option.isNone(env.database)) return Layer.empty;
    // In this branch `Env.database` IS Some, so `MessageStorageLive`'s
    // `DatabaseUnconfigured` gate cannot fire; `orDie` reflects the
    // impossibility (a build failure here is a real defect) and keeps the
    // runner's build-error channel clean.
    // The runner (consumer) AND the deadline-sweep fiber (a SENDER of
    // `Order.expire`), both in this long-lived `Layer.launch`-ed graph. The
    // sweep needs `Order.SenderServices` (`Client | ActorAddressResolver |
    // MessageStorage`) — which `fullRunnerLayer` already carries in its output
    // (the handlers' `toLayer` keeps the client/storage services) — so
    // `provideMerge` wires the sweep's sender requirement from the same runner
    // build, over the SAME shared sqlite FILE the runner polls. A `send` from
    // the sweep lands in the rows the runner consumes; the two never coordinate
    // through anything but the durable DB (the two-runtime topology).
    // `provideMerge` (not `merge`): the sweep fiber REQUIRES the runner's sender
    // output (`Client | ActorAddressResolver | MessageStorage`), so the runner
    // must PROVIDE it to the fiber — `merge` would leave the fiber's requirement
    // unsatisfied. `provideMerge` feeds `fullRunnerLayer`'s output into the
    // fiber AND keeps the runner's services in the result (so `Layer.launch`
    // builds the runner too). Both end up needing `Submissions` (the fiber's
    // `listOrders` + the handlers' bucket writes), discharged once below.
    return OrderSweep.fiberLayer().pipe(
      Layer.provideMerge(Order.fullRunnerLayer(Order.MessageStorageLive)),
      // The runner's bucket-authority writes come from `Submissions`; the sweep
      // ALSO reads orders through `Submissions` (`listOrders`). The `refund`
      // handler (G7) ALSO issues the Stripe refund, so `Payment` is provided
      // here too (self-contained `defaultLayer`s — both gate on their own `Env`
      // reads). When `Env.stripe` is None `Payment` is inert and a `refund` op
      // would die `PaymentDisabled`, but no sender reaches `refund` without a
      // configured Stripe, so the runner still builds cleanly.
      Layer.provide(Submissions.defaultLayer),
      Layer.provide(Payment.defaultLayer),
      Layer.orDie,
    );
  }),
).pipe(Layer.provide(Env.layer));

const ServerLive = HttpRouter.serve(RoutesLive).pipe(
  Layer.provide(StorageLive),
  Layer.provide(StartupCheck),
  Layer.provide(BunHttpServer.layer({ port: PORT })),
  // `merge` (not `provide`): nothing in the HTTP graph CONSUMES the runner's
  // output services, so `Layer.provide` would never build it (provide only
  // builds a dependency something requires). Merging makes the runner part of
  // `ServerLive`'s own composition, so `Layer.launch` builds it and supervises
  // its mailbox-poll fiber for the process lifetime.
  Layer.merge(OrderRunnerLive),
);

BunRuntime.runMain(Layer.launch(ServerLive));
