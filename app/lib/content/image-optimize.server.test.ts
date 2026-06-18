import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import {
  MAX_WIDTH,
  prepareImage,
  WEBP_QUALITY,
} from './image-optimize.server';

/**
 * `prepareImage` is the ONE shared upload boundary (Feature B): cap width at
 * `MAX_WIDTH`, re-encode to WebP, pass GIFs through verbatim, and never fail an
 * upload when the optimizer chokes. These pin each branch with REAL bytes —
 * fixtures are encoded by `Bun.Image` here and decoded back through
 * `Bun.Image().metadata()` to assert the stored width, so the width-cap is
 * proven on the actual output, not a mock.
 */

// A 1×1 PNG seed; every fixture below is derived from it via `Bun.Image` so the
// test carries no large binary literal and the width assertions are first-hand.
const PNG_1X1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

// A 1×1 transparent GIF (animated GIFs would lose all but frame 1 under a
// decode/re-encode; this fixture stands in for "any GIF" — passthrough is keyed
// on the MIME type, not the frame count).
const GIF_1X1 = new Uint8Array(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
);

/** Encode a solid JPEG of the given dimensions from the PNG seed. */
const jpegOf = async (width: number, height: number): Promise<Uint8Array> =>
  new Uint8Array(
    await new Bun.Image(PNG_1X1).resize(width, height).jpeg({ quality: 90 }).toBuffer(),
  );

/** Decoded width of an encoded image (proves the actual stored geometry). */
const widthOf = async (bytes: Uint8Array): Promise<number> =>
  (await new Bun.Image(bytes).metadata()).width;

const formatOf = async (bytes: Uint8Array): Promise<string> =>
  (await new Bun.Image(bytes).metadata()).format;

describe('prepareImage', () => {
  it('downscales a wider-than-MAX_WIDTH image to MAX_WIDTH and re-encodes to WebP', async () => {
    const wide = await jpegOf(2400, 800);
    expect(await widthOf(wide)).toBe(2400);

    const prepared = await Effect.runPromise(prepareImage(wide, 'image/jpeg'));

    expect(prepared.contentType).toBe('image/webp');
    expect(prepared.extension).toBe('webp');
    expect(await formatOf(prepared.bytes)).toBe('webp');
    // The width cap is applied to the ACTUAL output bytes.
    expect(await widthOf(prepared.bytes)).toBe(MAX_WIDTH);
    // Aspect ratio is preserved (2400×800 → 1600×533).
    expect(await new Bun.Image(prepared.bytes).metadata().then((m) => m.height)).toBe(
      533,
    );
  });

  it('does NOT upscale a narrower image but still re-encodes it to WebP', async () => {
    const narrow = await jpegOf(800, 600);
    expect(await widthOf(narrow)).toBe(800);

    const prepared = await Effect.runPromise(prepareImage(narrow, 'image/jpeg'));

    expect(prepared.contentType).toBe('image/webp');
    expect(await formatOf(prepared.bytes)).toBe('webp');
    // Width is unchanged (no upscale), not bumped to MAX_WIDTH.
    expect(await widthOf(prepared.bytes)).toBe(800);
  });

  it('re-encodes a WebP source through the same single path (recompress + cap)', async () => {
    const wideWebp = new Uint8Array(
      await new Bun.Image(PNG_1X1).resize(2000, 1000).webp({ quality: 90 }).toBuffer(),
    );
    expect(await widthOf(wideWebp)).toBe(2000);

    const prepared = await Effect.runPromise(prepareImage(wideWebp, 'image/webp'));

    expect(prepared.contentType).toBe('image/webp');
    expect(await formatOf(prepared.bytes)).toBe('webp');
    expect(await widthOf(prepared.bytes)).toBe(MAX_WIDTH);
  });

  it('passes a GIF through byte-identical, never decoding it', async () => {
    const prepared = await Effect.runPromise(prepareImage(GIF_1X1, 'image/gif'));

    expect(prepared.contentType).toBe('image/gif');
    expect(prepared.extension).toBe('gif');
    // The exact same buffer is stored — no decode, no frame loss.
    expect(prepared.bytes).toBe(GIF_1X1);
  });

  it('passes a GIF through regardless of MIME-type casing', async () => {
    const prepared = await Effect.runPromise(prepareImage(GIF_1X1, 'IMAGE/GIF'));
    expect(prepared.contentType).toBe('image/gif');
    expect(prepared.bytes).toBe(GIF_1X1);
  });

  it('falls back to the original bytes + type when the optimizer throws (never fails the upload)', async () => {
    const corrupt = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

    // Must SUCCEED (the upload is never failed by a decode throw).
    const prepared = await Effect.runPromise(prepareImage(corrupt, 'image/png'));

    expect(prepared.bytes).toBe(corrupt);
    expect(prepared.contentType).toBe('image/png');
    expect(prepared.extension).toBe('png');
  });

  it('exposes the cap + quality as the single source of truth', () => {
    expect(MAX_WIDTH).toBe(1600);
    expect(WEBP_QUALITY).toBe(80);
  });
});
