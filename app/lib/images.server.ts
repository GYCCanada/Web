/**
 * The `/images/*` route boundary (CMS plan §"Image serving", C5).
 *
 * `imageKeyFromPath` is the *only* thing that decides which bucket object key a
 * public, unauthenticated `GET /images/<key>` request is allowed to reach. It is
 * a two-part boundary (`boundary-discipline`, least-exposure):
 *
 *   1. **Traversal guard** — mirrors `clientFilePath` and the `AssetKey` schema:
 *      no `..`, no leading `/`, no `\0`, no backslash, no empty / `.` / `..`
 *      segments, so a key can never escape the bucket.
 *   2. **Image allow-list** — the trailing extension must be a real image
 *      extension. This keeps the route an *image* proxy and nothing else: the
 *      CMS documents (`content/site.json` and, critically, the **private**
 *      unpublished `content/site.draft.json`) and every other non-image bucket
 *      object end in a non-image extension and are refused here. Without this,
 *      `GET /images/content/site.draft.json` would stream the private draft to
 *      an unauthenticated caller — a data leak.
 *
 * Lives in its own module (not inline in `server.ts`) so the security boundary
 * is unit-testable without booting the HTTP server (`prove-it-works`).
 */

// The only object extensions `/images/*` is ever allowed to serve. Mirrors the
// image entries in `server.ts`'s `mimeFor` and covers every extension the
// uploader emits (`EXTENSION_BY_TYPE` in `app/lib/content/image-types.ts`) plus
// the bundled `public/<year>/…` art (`.jpg`/`.jpeg`/`.png`/`.svg`).
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'svg',
  'avif',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'ico',
]);

/**
 * Decode an `/images/<key>` pathname back to a bucket object key, or `null` for
 * any key that is malformed, escapes the bucket, or is not a managed image (the
 * route maps `null` to a 404). See the module doc for the contract.
 */
export const imageKeyFromPath = (pathname: string): string | null => {
  const rest = pathname.replace(/^\/images\//, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (
    decoded === '' ||
    decoded.startsWith('/') ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    return null;
  }
  const dot = decoded.lastIndexOf('.');
  const ext = dot === -1 ? '' : decoded.slice(dot + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return null;
  }
  return decoded;
};
