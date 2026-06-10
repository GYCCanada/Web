import { Effect, Schema } from 'effect';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

export const SERVER_BUILD_ID = 'virtual:react-router/server-build';

export const createDevVite = (): Promise<ViteDevServer> =>
  createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

class ViteMiddlewareError extends Schema.TaggedErrorClass<ViteMiddlewareError>()(
  'gycc/lib/dev/vite-middleware/ViteMiddlewareError',
  { message: Schema.String },
) {}

const runViteMiddlewareEffect = (
  vite: ViteDevServer,
  req: Request,
): Effect.Effect<Response | null, ViteMiddlewareError> =>
  Effect.callback((resume) => {
    const url = new URL(req.url);
    const headers: Record<string, string | string[]> = {};
    req.headers.forEach((value, key) => {
      const existing = headers[key];
      headers[key] =
        existing === undefined ? value
        : Array.isArray(existing) ? [...existing, value]
        : [existing, value];
    });

    const nodeReq: any = {
      url: `${url.pathname}${url.search}`,
      method: req.method,
      headers,
      socket: { remoteAddress: '127.0.0.1' },
      on: () => nodeReq,
      once: () => nodeReq,
      off: () => nodeReq,
      removeListener: () => nodeReq,
      addListener: () => nodeReq,
    };

    let statusCode = 200;
    const resHeaders: Record<string, string | string[]> = {};
    const chunks: Uint8Array[] = [];
    let ended = false;

    const nodeRes: any = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(v: number) {
        statusCode = v;
      },
      headersSent: false,
      setHeader(k: string, v: string | string[]) {
        resHeaders[k.toLowerCase()] = v;
        return this;
      },
      getHeader(k: string) {
        return resHeaders[k.toLowerCase()];
      },
      hasHeader(k: string) {
        return k.toLowerCase() in resHeaders;
      },
      getHeaderNames() {
        return Object.keys(resHeaders);
      },
      removeHeader(k: string) {
        delete resHeaders[k.toLowerCase()];
      },
      appendHeader(k: string, v: string | string[]) {
        const lower = k.toLowerCase();
        const existing = resHeaders[lower];
        if (existing === undefined) {
          resHeaders[lower] = v;
        } else if (Array.isArray(existing)) {
          resHeaders[lower] = [...existing, ...(Array.isArray(v) ? v : [v])];
        } else {
          resHeaders[lower] = [existing, ...(Array.isArray(v) ? v : [v])];
        }
        return this;
      },
      flushHeaders() {},
      writeHead(code: number, maybeHeaders?: Record<string, string>) {
        statusCode = code;
        if (maybeHeaders) for (const k in maybeHeaders) resHeaders[k.toLowerCase()] = maybeHeaders[k]!;
      },
      write(chunk: Uint8Array | string) {
        chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        return true;
      },
      end(chunk?: Uint8Array | string) {
        if (ended) return;
        ended = true;
        if (chunk !== undefined) {
          chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const body = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          body.set(c, offset);
          offset += c.length;
        }
        const flatHeaders: HeadersInit = {};
        for (const [k, v] of Object.entries(resHeaders)) {
          flatHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resume(Effect.succeed(new Response(body, { status: statusCode, headers: flatHeaders })));
      },
      on: () => nodeRes,
      once: () => nodeRes,
      off: () => nodeRes,
      removeListener: () => nodeRes,
      addListener: () => nodeRes,
      emit: () => true,
    };

    vite.middlewares(nodeReq, nodeRes, (err?: unknown) => {
      if (err !== undefined) {
        resume(Effect.fail(new ViteMiddlewareError({ message: String(err) })));
        return;
      }
      resume(Effect.succeed(null));
    });
  });

export const runViteMiddleware = (
  vite: ViteDevServer,
  req: Request,
): Promise<Response | null> => Effect.runPromise(runViteMiddlewareEffect(vite, req));

export const looksLikeViteAsset = (pathname: string): boolean => {
  if (pathname.startsWith('/@') || pathname.startsWith('/node_modules/')) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return lastSegment.includes('.');
};
