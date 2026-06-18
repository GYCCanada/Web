/**
 * The ONE shared image-upload optimization boundary (CMS plan Feature B).
 *
 * Both content editors — the site editor (`admin/content.tsx`) and the per-page
 * editor (`admin/pages.$page.tsx`) — read an uploaded `File`'s bytes and then
 * `storage.put` them. `prepareImage` is the single point between those two steps
 * where an upload is shrunk and re-encoded, so the resize is applied EXACTLY
 * ONCE regardless of which editor performed the upload (`subtract-before-you-add`,
 * `derive-dont-sync`: one optimization rule, not a copy per route).
 *
 * Policy:
 *   - cap width at `MAX_WIDTH` (never upscale a narrower image);
 *   - re-encode to WebP at `WEBP_QUALITY`;
 *   - GIF is stored verbatim (animated GIFs would lose every frame but the first
 *     under a decode/re-encode — unrequested data loss);
 *   - if `Bun.Image` throws on a corrupt/exotic input, fall back to the ORIGINAL
 *     bytes + original content-type so a decode failure NEVER fails an upload
 *     (`boundary-discipline`: the optimizer choking is recoverable, the upload is
 *     not the place to surface it).
 *
 * The returned `contentType` / `extension` describe the bytes ACTUALLY stored
 * (`image/webp` after a re-encode, the source type on passthrough/fallback), so
 * the caller keys + `storage.put`s off `prepared.contentType` — never the source
 * `file.type`, which would make the served object's extension/type lie.
 */

import { Effect } from 'effect';

import { extensionForType } from './admin-form';

/** Upload width cap (px). A wider image is downscaled to this; a narrower one is left as-is. */
export const MAX_WIDTH = 1600;

/** WebP re-encode quality (0–100). */
export const WEBP_QUALITY = 80;

export interface PreparedImage {
  /** The bytes to store (re-encoded WebP, or the original on passthrough/fallback). */
  readonly bytes: Uint8Array;
  /** The content-type of `bytes`: `'image/webp'` after re-encode, else the original. */
  readonly contentType: string;
  /** The file extension for `bytes`: `'webp'` after re-encode, else `extensionForType(original)`. */
  readonly extension: string;
}

/**
 * Shrink-to-`MAX_WIDTH` + re-encode-to-WebP an uploaded image, with a GIF
 * passthrough and a never-fail fallback. Pure w.r.t. storage — the caller stores
 * the result. Always succeeds (the error channel is `never`): a `Bun.Image`
 * throw is caught and folded into an original-bytes `PreparedImage`.
 */
export const prepareImage = (
  bytes: Uint8Array,
  sourceType: string,
): Effect.Effect<PreparedImage> =>
  Effect.gen(function* () {
    // GIF passthrough: a `Bun.Image` decode/re-encode keeps only frame 1, so an
    // animated GIF would silently flatten. Store it verbatim instead.
    if (sourceType.toLowerCase() === 'image/gif') {
      return { bytes, contentType: 'image/gif', extension: 'gif' };
    }

    return yield* Effect.tryPromise(async () => {
      const img = new Bun.Image(bytes);
      // CRITICAL: `img.width` is -1 until `metadata()` resolves in Bun 1.3.14, so
      // the no-upscale decision MUST read `(await img.metadata()).width`. Reading
      // `img.width` here would make `width > MAX_WIDTH` always false → nothing
      // would ever resize and every upload would re-encode at full resolution.
      const meta = await img.metadata();
      const chain = meta.width > MAX_WIDTH ? img.resize(MAX_WIDTH) : img;
      const out = new Uint8Array(await chain.webp({ quality: WEBP_QUALITY }).toBuffer());
      return {
        bytes: out,
        contentType: 'image/webp',
        extension: 'webp',
      } satisfies PreparedImage;
    }).pipe(
      // The optimizer choking (corrupt/exotic upload) must not fail the upload:
      // store the ORIGINAL bytes under their original type/extension.
      Effect.catch(() =>
        Effect.succeed<PreparedImage>({
          bytes,
          contentType: sourceType,
          extension: extensionForType(sourceType),
        }),
      ),
    );
  });
